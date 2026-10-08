const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('RBAC & Scoped Security - Strict Server Enforcement (Deny by Default & SoD)', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const secret = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';

  // Seed sample projects for scope testing if not present
  await db.run(`INSERT OR IGNORE INTO projects (id, code, name, client_id, status, contract_value, actual_cost)
    VALUES (901, 'PRJ-TEST-01', 'مشروع برج الأمانة 1', 1, 'active', 5000000, 100000)`);
  await db.run(`INSERT OR IGNORE INTO projects (id, code, name, client_id, status, contract_value, actual_cost)
    VALUES (902, 'PRJ-TEST-02', 'مشروع مجمع الساحل 2', 1, 'active', 8000000, 200000)`);

  // Helper to generate auth headers
  function getAuthHeaders(userObj) {
    const token = jwt.sign(userObj, secret, { expiresIn: '1h' });
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-CSRF-Token': 'test-csrf-token-12345678901234567890123456789012',
      'X-Requested-With': 'XMLHttpRequest'
    };
  }

  // 1. اختبار Deny by Default: مستخدم بدون أي صلاحيات (permissions: [])
  await t.test('1. Deny by Default - Blocks unauthorized user with 403 Forbidden', async () => {
    const noPermHeaders = getAuthHeaders({
      id: 8001,
      username: 'guest_user',
      role: 'custom',
      permissions: []
    });

    const res = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: noPermHeaders,
      body: JSON.stringify({
        project_id: 901,
        expense_type: 'مواد بناء',
        amount: 5000,
        recipient: 'عامل اختبار'
      })
    });

    assert.strictEqual(res.status, 403, 'Should reject with 403 Forbidden');
    const json = await res.json();
    assert.strictEqual(json.permissionDenied, true, 'Response must have permissionDenied: true');
    assert.ok(json.message.includes('لا يملك الصلاحية اللازمة'), 'Message should indicate missing permission');
  });

  // 2. اختبار فصل المهام (Separation of Duties): المحاسب لا يمكنه إغلاق/اعتماد الفترات المالية
  await t.test('2. SoD - Accountant can create expense but CANNOT approve period closing', async () => {
    const accountantHeaders = getAuthHeaders({
      id: 8002,
      username: 'test_accountant',
      role: 'accountant',
      permissions: [
        'expenses:view', 'expenses:create',
        'accounting:view', 'accounting:create'
      ]
    });

    // المحاسب يسجل مصروف بنجاح
    const resExp = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: accountantHeaders,
      body: JSON.stringify({
        project_id: 901,
        expense_type: 'نثريات موقع',
        amount: 1200,
        recipient: 'مهندس الموقع'
      })
    });
    assert.strictEqual(resExp.status, 200, 'Accountant should be able to create expenses');

    // المحاسب يحاول إغلاق فترة مالية -> مرفوض فوراً (403)
    const resClose = await fetch(`${baseUrl}/api/accounting/periods/1/close`, {
      method: 'PUT',
      headers: accountantHeaders,
      body: JSON.stringify({ manager_password: 'any_password' })
    });
    assert.strictEqual(resClose.status, 403, 'Accountant must be blocked from period closing (approve)');
    const closeJson = await resClose.json();
    assert.strictEqual(closeJson.permissionDenied, true);
  });

  // 3. اختبار فصل المهام (Separation of Duties): المراجع المالي (Auditor) يراجع ويعتمد لكن لا يصرف
  await t.test('3. SoD - Auditor can view & audit but CANNOT create direct vouchers', async () => {
    const auditorHeaders = getAuthHeaders({
      id: 8003,
      username: 'test_auditor',
      role: 'auditor',
      permissions: [
        'accounting:view', 'accounting:approve', 'accounting:post',
        'expenses:view', 'expenses:approve',
        'reports:view'
      ]
    });

    // المراجع يستعرض التقارير المحاسبية وسجلات المراجعة بنجاح
    const resRep = await fetch(`${baseUrl}/api/accounting/accounts`, {
      method: 'GET',
      headers: auditorHeaders
    });
    assert.strictEqual(resRep.status, 200, 'Auditor can view accounting accounts');

    // المراجع يحاول تسجيل سند صرف مباشر -> مرفوض منعاً لتعارض المصالح (403)
    const resExp = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: auditorHeaders,
      body: JSON.stringify({
        project_id: 901,
        expense_type: 'مصروف غير مشروع',
        amount: 9000,
        recipient: 'جهة ما'
      })
    });
    assert.strictEqual(resExp.status, 403, 'Auditor must be blocked from creating expenses (No expenses:create)');
    const jsonExp = await resExp.json();
    assert.strictEqual(jsonExp.permissionDenied, true);
  });

  // 4. اختبار نطاق المشاريع (Project Scope Enforcement): مدير المشاريع مقيد بمشروعه فقط
  await t.test('4. Scoped Permissions - Project Manager blocked from unauthorized projects', async () => {
    // مدير المشروع مسموح له فقط بالمشروع 901
    const pmHeaders = getAuthHeaders({
      id: 8004,
      username: 'test_pm_aden',
      role: 'project_manager',
      permissions: ['projects:view', 'projects:edit', 'expenses:view', 'expenses:create'],
      scope: {
        allowed_projects: [901],
        allowed_branches: ['all'],
        allowed_departments: ['all']
      }
    });

    // الوصول للمشروع المصرح به (901) -> ينجح
    const resAllowed = await fetch(`${baseUrl}/api/projects/901`, {
      method: 'GET',
      headers: pmHeaders
    });
    assert.strictEqual(resAllowed.status, 200, 'PM must access their assigned project 901');

    // محاولة الوصول للمشروع غير المصرح به (902) -> يرفض بنطاق غير مسموح (403)
    const resBlocked = await fetch(`${baseUrl}/api/projects/902`, {
      method: 'GET',
      headers: pmHeaders
    });
    assert.strictEqual(resBlocked.status, 403, 'PM must be blocked from project 902');
    const blockedJson = await resBlocked.json();
    assert.strictEqual(blockedJson.scopeDenied, true, 'Must indicate scopeDenied: true');
    assert.ok(blockedJson.message.includes('خارج نطاق عملك') || blockedJson.message.includes('غير مصرح'), 'Message explains scope restriction');

    // محاولة تسجيل مصروف في مشروع خارج نطاقه (902) -> يرفض فوراً (403)
    const resExpBlocked = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        project_id: 902,
        expense_type: 'شراء حديد',
        amount: 15000,
        recipient: 'المقاول'
      })
    });
    assert.strictEqual(resExpBlocked.status, 403, 'Expense on unassigned project must be blocked');
    const expBlockedJson = await resExpBlocked.json();
    assert.strictEqual(expBlockedJson.scopeDenied, true);
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('SOX Financial Control & True Document Lifecycle Backend Verification Suite', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'test-csrf-token-sox-financial-controls-1234567890';

  const hashedPass = bcrypt.hashSync('Pass@123456', 10);
  const makerId = 8801;
  const checkerId = 8802;
  const testProjectId = 880;
  const testClientId = 880;

  const cleanup = async () => {
    try {
      await db.run("DELETE FROM journal_entry_lines WHERE project_id = ? OR entry_id IN (SELECT id FROM journal_entries WHERE created_by IN (?, ?) OR created_by_name IN ('maker_ctrl', 'checker_ctrl'))", [testProjectId, makerId, checkerId]);
      await db.run("DELETE FROM journal_entries WHERE created_by IN (?, ?) OR created_by_name IN ('maker_ctrl', 'checker_ctrl')", [makerId, checkerId]);
      await db.run("DELETE FROM bills WHERE project_id = ? OR created_by IN (?, ?)", [testProjectId, makerId, checkerId]);
      await db.run("DELETE FROM expenses WHERE project_id = ? OR created_by IN (?, ?)", [testProjectId, makerId, checkerId]);
      await db.run("DELETE FROM purchases WHERE project_id = ? OR created_by IN (?, ?)", [testProjectId, makerId, checkerId]);
      await db.run("DELETE FROM projects WHERE id = ?", [testProjectId]);
      await db.run("DELETE FROM clients WHERE id = ?", [testClientId]);
      await db.run("DELETE FROM users WHERE id IN (?, ?) OR username IN ('maker_ctrl', 'checker_ctrl')", [makerId, checkerId]);
      await db.run("DELETE FROM accounting_periods WHERE period_name = 'فترة رقابية اختبارية'");
    } catch {}
  };

  await cleanup();

  // إنشاء مستخدمين للاختبار: صانع (Maker) ومدقق/معتمد (Checker)
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'maker_ctrl', ?, 'accountant', 'المحاسب منشئ المعاملة', 'active', '["expenses:view","expenses:create","expenses:edit","expenses:approve","billing:view","billing:create","billing:edit","billing:approve","accounting:view","accounting:create","accounting:edit","accounting:approve","purchases:view","purchases:create","purchases:edit","purchases:approve"]')`,
    [makerId, hashedPass]
  );
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'checker_ctrl', ?, 'auditor', 'المراجع والمدقق المالي', 'active', '["expenses:view","expenses:approve","expenses:post","expenses:cancel","billing:view","billing:approve","billing:post","billing:cancel","accounting:view","accounting:approve","accounting:post","purchases:view","purchases:approve","purchases:post","purchases:cancel"]')`,
    [checkerId, hashedPass]
  );

  await db.run(`
    INSERT OR REPLACE INTO clients (id, name, phone, total_due, total_paid, current_balance)
    VALUES (?, 'شركة التطوير العقاري الاستثماري', '777888999', 0, 0, 0)
  `, [testClientId]);

  await db.run(`
    INSERT OR REPLACE INTO projects (id, name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status)
    VALUES (?, 'مشروع برج الأمان المالي', ?, 1000000, 800000, 0, 0, 'in_progress')
  `, [testProjectId, testClientId]);

  const getHeaders = (user, extraClaims = {}) => {
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, permissions: user.permissions, ...extraClaims },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Connection': 'close'
    };
  };

  const makerHeaders = getHeaders({
    id: makerId,
    username: 'maker_ctrl',
    role: 'accountant',
    permissions: ['expenses:view', 'expenses:create', 'expenses:edit', 'expenses:approve', 'billing:view', 'billing:create', 'billing:edit', 'billing:approve', 'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:approve', 'purchases:view', 'purchases:create', 'purchases:edit']
  });

  const checkerHeaders = getHeaders({
    id: checkerId,
    username: 'checker_ctrl',
    role: 'auditor',
    permissions: ['expenses:view', 'expenses:approve', 'expenses:post', 'expenses:cancel', 'billing:view', 'billing:approve', 'billing:post', 'billing:cancel', 'accounting:view', 'accounting:approve', 'accounting:post', 'purchases:view', 'purchases:approve', 'purchases:post', 'purchases:cancel']
  });

  t.after(async () => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
    await cleanup();
  });

  // =========================================================================
  // 1. فحص حماية التحقق بخطوتين (2FA Guard): منع استخدام التوكن المؤقت
  // =========================================================================
  await t.test('1. 2FA Security Guard - Blocks tempToken with isPending2FA from protected APIs', async () => {
    const tempTokenHeaders = getHeaders(
      { id: 1, username: 'admin', role: 'admin', permissions: ['*'] },
      { isPending2FA: true }
    );

    const res = await fetch(`${baseUrl}/api/accounting/accounts`, {
      method: 'GET',
      headers: tempTokenHeaders
    });

    assert.strictEqual(res.status, 403, 'Must reject pending 2FA token with 403 Forbidden');
    const json = await res.json();
    assert.strictEqual(json.requires2FA, true, 'Flag requires2FA must be true');
    assert.ok(json.message.includes('التحقق بخطوتين'), 'Message should indicate 2FA requirement');
  });

  // =========================================================================
  // 2. فحص مشغل قاعدة البيانات الصارم لتوازن القيد (Zero-Sum Invariant Trigger)
  // =========================================================================
  await t.test('2. Database Trigger Invariant - Aborts unbalanced journal entries at DB engine level', async () => {
    let triggerFired = false;
    try {
      await db.run(`
        INSERT INTO journal_entries (entry_no, date, description, total_debit, total_credit, status)
        VALUES ('TEST-UNBALANCED-TRG', '2026-09-24', 'محاولة كسر توازن القيد', 100000, 90000, 'posted')
      `);
    } catch (dbErr) {
      triggerFired = true;
      assert.ok(dbErr.message.includes('خطأ محاسبي') || dbErr.message.includes('غير متزن'), `Trigger message expected, got: ${dbErr.message}`);
    }
    assert.strictEqual(triggerFired, true, 'Database trigger MUST abort unbalanced journal entry');
  });

  // =========================================================================
  // 3. دورة حياة المستخلص (IPC Document Lifecycle) ومبدأ العيون الأربع
  // =========================================================================
  await t.test('3. IPC Bill Lifecycle - Draft -> Review -> Maker-Checker -> Post -> Immutability -> Reversal', async () => {
    // 3.1 إنشاء مسودة مستخلص
    const resDraft = await fetch(`${baseUrl}/api/billing`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({
        bill_type: 'مستخلص جاري رقم 1',
        project_id: testProjectId,
        client_id: testClientId,
        amount: 200000, // إجمالي الأعمال المنجزة
        advance_deduction: 20000, // استهلاك 10% دفعة مقدمة
        retention_deduction: 20000, // استقطاع 10% محتجز ضمان
        status: 'draft',
        date: '2026-09-24',
        notes: 'مستخلص أعمال الحفر والأساسات'
      })
    });

    assert.strictEqual(resDraft.status, 200);
    const draftJson = await resDraft.json();
    assert.strictEqual(draftJson.success, true);
    assert.strictEqual(draftJson.status, 'draft');
    assert.strictEqual(draftJson.gross_amount, 200000);
    assert.strictEqual(draftJson.net_amount, 160000);
    const billId = draftJson.id;
    const billNo = draftJson.bill_no;

    // التحقق من أن المسودة لا تؤثر على حساب العميل
    const clientBefore = await db.get('SELECT total_due, current_balance FROM clients WHERE id = ?', [testClientId]);
    assert.strictEqual(Number(clientBefore.total_due), 0, 'Draft bill must not increase client due');

    // 3.2 إرسال المستخلص للمراجعة
    const resRev = await fetch(`${baseUrl}/api/billing/${billId}/submit-review`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({ notes: 'تمت مطابقة شيتات الكميات الموقعية' })
    });
    assert.strictEqual(resRev.status, 200);
    const revJson = await resRev.json();
    assert.strictEqual(revJson.status, 'under_review');

    // 3.3 مبدأ العيون الأربع: منع منشئ المستخلص من اعتماده بنفسه
    const resSelfApprove = await fetch(`${baseUrl}/api/billing/${billId}/approve`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({ notes: 'محاولة اعتماد ذاتي للمستخلص' })
    });
    assert.strictEqual(resSelfApprove.status, 403, 'Maker cannot approve their own bill');
    const selfJson = await resSelfApprove.json();
    assert.strictEqual(selfJson.fourEyesViolation, true);

    // 3.4 اعتماد المستخلص بواسطة مدقق مستقل ومفوض
    const resAuditorApprove = await fetch(`${baseUrl}/api/billing/${billId}/approve`, {
      method: 'POST',
      headers: checkerHeaders,
      body: JSON.stringify({ notes: 'تم التدقيق الفني والمالي واعتماد المستخلص' })
    });
    assert.strictEqual(resAuditorApprove.status, 200);
    const appJson = await resAuditorApprove.json();
    assert.strictEqual(appJson.status, 'approved');

    // 3.5 ترحيل المستخلص المعتمد (Post to GL)
    const resPost = await fetch(`${baseUrl}/api/billing/${billId}/post`, {
      method: 'POST',
      headers: checkerHeaders
    });
    assert.strictEqual(resPost.status, 200);
    const postJson = await resPost.json();
    assert.strictEqual(postJson.status, 'posted');
    assert.ok(postJson.journal_entry_no, 'Posting bill must generate journal entry');

    // التحقق من ذمة العميل وتوليد القيد المركب المتزن
    const clientAfter = await db.get('SELECT total_due, current_balance FROM clients WHERE id = ?', [testClientId]);
    assert.strictEqual(Number(clientAfter.total_due), 160000, 'Client total due must increase by net_amount');

    const ipcJe = await db.get('SELECT * FROM journal_entries WHERE entry_no = ?', [postJson.journal_entry_no]);
    assert.ok(ipcJe, 'IPC Journal entry must exist in GL');
    assert.strictEqual(Number(ipcJe.total_debit), 200000, 'Total debit must match gross amount');
    assert.strictEqual(Number(ipcJe.total_credit), 200000, 'Total credit must match gross amount');

    // 3.6 حصانة السجلات: منع الحذف والتعديل المباشر
    const resDel = await fetch(`${baseUrl}/api/billing/${billId}`, {
      method: 'DELETE',
      headers: checkerHeaders
    });
    assert.strictEqual(resDel.status, 400, 'Cannot delete posted bill');
    const delJson = await resDel.json();
    assert.strictEqual(delJson.financialControlProtected, true);

    const resEdit = await fetch(`${baseUrl}/api/billing/${billId}`, {
      method: 'PUT',
      headers: makerHeaders,
      body: JSON.stringify({ amount: 999999 })
    });
    assert.strictEqual(resEdit.status, 400, 'Cannot directly edit posted bill');
    const editJson = await resEdit.json();
    assert.strictEqual(editJson.immutable, true);

    // 3.7 القيد العكسي الذري للمستخلص (IPC Storno Reversal)
    const resRevBill = await fetch(`${baseUrl}/api/billing/${billId}/reverse`, {
      method: 'POST',
      headers: checkerHeaders,
      body: JSON.stringify({
        reason: 'إلغاء المستخلص بموجب تقرير استشاري لوجود ملاحظات هندسية على خرسانة القواعد',
        reversal_date: '2026-09-24'
      })
    });
    assert.strictEqual(resRevBill.status, 200);
    const revBillJson = await resRevBill.json();
    assert.strictEqual(revBillJson.success, true);
    assert.ok(revBillJson.reversing_entry_no, 'Should return reversing journal entry number');

    // التأكد من استرجاع رصيد العميل بالكامل
    const clientReversed = await db.get('SELECT total_due, current_balance FROM clients WHERE id = ?', [testClientId]);
    assert.strictEqual(Number(clientReversed.total_due), 0, 'Reversing bill must reduce client total due back to 0');

    // التحقق من القيد العكسي لسند المستخلص
    const revJe = await db.get('SELECT * FROM journal_entries WHERE entry_no = ?', [revBillJson.reversing_entry_no]);
    assert.ok(revJe);
    assert.strictEqual(Number(revJe.total_debit), 200000);
    assert.strictEqual(Number(revJe.total_credit), 200000);

    // فحص سجل التدقيق للأثر القديم والجديد والسبب
    const auditRow = await db.get(
      "SELECT * FROM audit_logs WHERE action = 'REVERSE' AND entity_type = 'bill' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [billNo]
    );
    assert.ok(auditRow, 'Audit log must record bill reversal');
    assert.strictEqual(auditRow.username, 'checker_ctrl');
    assert.ok(auditRow.reason.includes('ملاحظات هندسية على خرسانة'));
  });

  // =========================================================================
  // 4. دورة حياة قيود اليومية (Journal Entries Lifecycle & Maker-Checker)
  // =========================================================================
  await t.test('4. Journal Entries Lifecycle - Draft -> Maker-Checker -> Post -> Delta Audit', async () => {
    // 4.1 إنشاء مسودة قيد يومي متزن
    const resDraftJe = await fetch(`${baseUrl}/api/accounting/journal-entries`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({
        date: '2026-09-24',
        description: 'مسودة قيد تسوية مخصصات الصيانة',
        status: 'draft',
        lines: [
          { account_id: 10, cost_center_id: 1, debit: 75000, credit: 0, description: 'مصروفات صيانة' },
          { account_id: 3, cost_center_id: 1, debit: 0, credit: 75000, description: 'البنك / الصندوق' }
        ]
      })
    });

    assert.strictEqual(resDraftJe.status, 200);
    const draftJeJson = await resDraftJe.json();
    assert.strictEqual(draftJeJson.success, true);
    assert.strictEqual(draftJeJson.status, 'draft');
    const jeId = draftJeJson.id;
    const jeNo = draftJeJson.entry_no;

    // 4.2 إرسال مسودة القيد للمراجعة
    const resJeRev = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}/submit-review`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({ notes: 'يرجى مراجعة وتدقيق حسابات التسوية' })
    });
    assert.strictEqual(resJeRev.status, 200);

    // 4.3 فحص مبدأ العيون الأربع على قيد اليومية
    const resSelfJeApprove = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}/approve`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({ notes: 'محاولة اعتماد ذاتي للقيد' })
    });
    assert.strictEqual(resSelfJeApprove.status, 403, 'Maker cannot approve their own journal entry');

    // 4.4 اعتماد القيد بواسطة مدقق مالي مستقل
    const resAuditorJeApprove = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}/approve`, {
      method: 'POST',
      headers: checkerHeaders,
      body: JSON.stringify({ notes: 'تمت مطابقة المستندات واعتماد القيد' })
    });
    assert.strictEqual(resAuditorJeApprove.status, 200);

    // 4.5 ترحيل القيد اليومي لدفتر الأستاذ
    const resJePost = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}/post`, {
      method: 'POST',
      headers: checkerHeaders
    });
    assert.strictEqual(resJePost.status, 200);
    const jePostJson = await resJePost.json();
    assert.strictEqual(jePostJson.status, 'posted');

    // 4.6 منع حذف أو تعديل القيد المرحل
    const resDelJe = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}`, {
      method: 'DELETE',
      headers: checkerHeaders
    });
    assert.strictEqual(resDelJe.status, 400);

    const resEditJe = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}`, {
      method: 'PUT',
      headers: makerHeaders,
      body: JSON.stringify({ description: 'تعديل ممنوع' })
    });
    assert.strictEqual(resEditJe.status, 400);
    const editJeJson = await resEditJe.json();
    assert.strictEqual(editJeJson.immutable, true);

    // 4.7 القيد العكسي لقيد اليومية العام
    const resRevJe = await fetch(`${baseUrl}/api/accounting/journal-entries/${jeId}/reverse`, {
      method: 'POST',
      headers: checkerHeaders,
      body: JSON.stringify({
        reason: 'عكس قيد التسوية لصدور فاتورة الصيانة الأصلية برقم منفصل',
        reversal_date: '2026-09-24'
      })
    });
    assert.strictEqual(resRevJe.status, 200);
    const revJeResult = await resRevJe.json();
    assert.ok(revJeResult.reversing_entry_no);

    const reversedJeRecord = await db.get('SELECT status, reversal_ref_id FROM journal_entries WHERE id = ?', [jeId]);
    assert.strictEqual(reversedJeRecord.status, 'reversed');
  });

  // =========================================================================
  // 5. فحص إغلاق وحماية الفترة المحاسبية (Period Locking Control)
  // =========================================================================
  await t.test('5. Period Locking Control - Blocks any transaction inside closed fiscal period', async () => {
    // 5.1 إنشاء فترة محاسبية تاريخية مغلقة
    const pRes = await db.run(`
      INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes)
      VALUES ('فترة رقابية اختبارية', 2025, '2025-01-01', '2025-01-31', 'closed', 'فترة مغلقة للاختبار')
    `);
    const periodId = pRes.lastInsertRowid || pRes.insertId;

    // 5.2 محاولة تسجيل سند صرف داخل الفترة المغلقة
    const resBlockedExp = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({
        expense_type: 'مصروفات سابقة',
        amount: 35000,
        date: '2025-01-15', // تاريخ داخل الفترة المغلقة
        notes: 'محاولة إدخال تاريخ مغلق'
      })
    });

    assert.strictEqual(resBlockedExp.status, 400, 'Must block expense in closed period');
    const blockedJson = await resBlockedExp.json();
    assert.ok(blockedJson.message.includes('مغلقة رسمياً'), 'Message should explain period is closed');

    // 5.3 محاولة تسجيل مستخلص في فترة مغلقة
    const resBlockedBill = await fetch(`${baseUrl}/api/billing`, {
      method: 'POST',
      headers: makerHeaders,
      body: JSON.stringify({
        project_id: testProjectId,
        amount: 100000,
        date: '2025-01-20'
      })
    });
    assert.strictEqual(resBlockedBill.status, 403, 'Must block bill in closed period');

    // 5.4 إعادة فتح الفترة رسمياً بطلب موثق في سجل التدقيق
    const resReopen = await fetch(`${baseUrl}/api/accounting/periods/${periodId}/reopen`, {
      method: 'PUT',
      headers: checkerHeaders,
      body: JSON.stringify({ reason: 'إعادة فتح استثنائية لتدقيق تسوية جردية معتمدة' })
    });
    assert.strictEqual(resReopen.status, 200);

    const reopenedPeriod = await db.get('SELECT status, reopen_reason FROM accounting_periods WHERE id = ?', [periodId]);
    assert.strictEqual(reopenedPeriod.status, 'open');
    assert.strictEqual(reopenedPeriod.reopen_reason, 'إعادة فتح استثنائية لتدقيق تسوية جردية معتمدة');
  });
});

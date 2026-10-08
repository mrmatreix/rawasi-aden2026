const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Period Closing - Enforces Manager Password and Audit Logging', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  // 1. إنشاء مستخدم مدير ومستخدم فترة اختبارية في قاعدة البيانات وتوليد توكن صالح
  const jwt = require('jsonwebtoken');
  const testAdminPassword = 'TestAdminPass@2026';
  const hashedPassword = bcrypt.hashSync(testAdminPassword, 10);
  
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status)
     VALUES (9999, 'temp_test_admin', ?, 'admin', 'المدير المالي التجريبي', 'active')`,
    [hashedPassword]
  );

  const token = jwt.sign(
    { id: 9999, username: 'temp_test_admin', role: 'admin' },
    process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024',
    { expiresIn: '1h' }
  );
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': 'test-csrf-token-12345678901234567890123456789012',
    'X-Requested-With': 'XMLHttpRequest'
  };

  const resPeriod = await db.run(
    `INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes)
     VALUES ('فترة تجربة الإقفال', 2024, '2024-04-01', '2024-06-30', 'open', 'فترة للاختبار')`
  );
  const periodId = resPeriod.lastInsertRowid || resPeriod.insertId;

  // 2. محاولة إقفال الفترة بدون كلمة مرور -> يجب أن ترفض (400)
  const resNoPass = await fetch(`${baseUrl}/api/accounting/periods/${periodId}/close`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ notes: 'محاولة إقفال بدون كلمة مرور' })
  });
  assert.strictEqual(resNoPass.status, 400, 'Should reject with 400 when manager password missing');

  // 3. محاولة إقفال الفترة بكلمة مرور خاطئة -> يجب أن ترفض بتفويض غير صالح (401)
  const resWrongPass = await fetch(`${baseUrl}/api/accounting/periods/${periodId}/close`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ manager_password: 'wrong_password_123', notes: 'محاولة إقفال بكلمة مرور خاطئة' })
  });
  assert.strictEqual(resWrongPass.status, 401, 'Should reject with 401 Unauthorized for incorrect password');
  const wrongJson = await resWrongPass.json();
  assert.ok(wrongJson.message.includes('غير صحيحة'), 'Error message should indicate invalid password');

  // 4. إقفال الفترة بكلمة مرور المدير الصحيحة -> يجب أن تنجح (200)
  const resValid = await fetch(`${baseUrl}/api/accounting/periods/${periodId}/close`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ manager_password: testAdminPassword, notes: 'إقفال معتمد وناجح' })
  });
  assert.strictEqual(resValid.status, 200, 'Should succeed with 200 for valid manager password');
  const validJson = await resValid.json();
  assert.strictEqual(validJson.success, true);
  assert.ok(validJson.message.includes('تم إغلاق وتأمين الفترة المحاسبية'));

  // 5. التحقق من تحول حالة الفترة في قاعدة البيانات إلى 'closed'
  const updatedPeriod = await db.get('SELECT * FROM accounting_periods WHERE id = ?', [periodId]);
  assert.strictEqual(updatedPeriod.status, 'closed', 'Period status in database must be closed');
  assert.ok(updatedPeriod.closed_at, 'Closed timestamp must be recorded');

  // 6. التحقق من تسجيل الحركة في جدول audit_logs
  const auditEntry = await db.get(
    "SELECT * FROM audit_logs WHERE action = 'CLOSE_PERIOD' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [String(periodId)]
  );
  assert.ok(auditEntry, 'Audit log entry must be created for period closure');

  // تنظيف السجلات الاختبارية
  await db.run('DELETE FROM users WHERE id = 9999');
  await db.run('DELETE FROM accounting_periods WHERE id = ?', [periodId]);
  await db.run("DELETE FROM audit_logs WHERE action = 'CLOSE_PERIOD' AND entity_id = ?", [String(periodId)]);
});

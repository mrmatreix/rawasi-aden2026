const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('2FA PIN - General Manager can configure and change 6-digit PIN anytime', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    try {
      await db.run('DELETE FROM users WHERE id = ? OR username = ?', [testAdminId, 'tfa_test_admin']);
    } catch {}
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';

  // 1. إعداد مستخدم مدير تجريبي وتنظيف أي بيانات سابقة
  const testAdminPassword = 'AdminPassword@2026';
  const hashedPassword = bcrypt.hashSync(testAdminPassword, 10);
  const testAdminId = 8888;

  await db.run('DELETE FROM users WHERE id = ? OR username = ?', [testAdminId, 'tfa_test_admin']);

  await db.run(
    `INSERT INTO users (id, username, password_hash, role, full_name, status, two_factor_pin, two_factor_enabled)
     VALUES (?, 'tfa_test_admin', ?, 'admin', 'المدير العام التجريبي', 'active', '123456', 1)`,
    [testAdminId, hashedPassword]
  );

  const adminToken = jwt.sign(
    { id: testAdminId, username: 'tfa_test_admin', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`,
    'X-CSRF-Token': 'test-csrf-token-12345678901234567890123456789012',
    'X-Requested-With': 'XMLHttpRequest'
  };

  // 2. التحقق من مسار GET /api/users لإرجاع two_factor_pin
  const resUsers = await fetch(`${baseUrl}/api/users`, {
    headers: authHeaders
  });
  assert.strictEqual(resUsers.status, 200);
  const usersData = await resUsers.json();
  assert.strictEqual(usersData.success, true);
  const foundUser = usersData.data.find(u => u.id === testAdminId);
  assert.ok(foundUser, 'Test admin user should be found in users list');
  assert.strictEqual(foundUser.two_factor_pin, '123456', 'Initial PIN should be 123456');

  // 3. تعديل رمز التحقق بخطوتين (PIN) إلى رمز جديد (654321)
  const newPin = '654321';
  const resUpdate = await fetch(`${baseUrl}/api/users/${testAdminId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      full_name: 'المدير العام التجريبي المحدث',
      username: 'tfa_test_admin',
      role: 'admin',
      two_factor_pin: newPin,
      two_factor_enabled: 1
    })
  });
  assert.strictEqual(resUpdate.status, 200);
  const updateData = await resUpdate.json();
  assert.strictEqual(updateData.success, true);
  assert.strictEqual(updateData.data.two_factor_pin, newPin, 'Updated user should have new PIN');

  // 4. محاكاة تسجيل الدخول والتحقق بخطوتين
  const tempToken = jwt.sign(
    { id: testAdminId, username: 'tfa_test_admin', role: 'admin', isPending2FA: true },
    JWT_SECRET,
    { expiresIn: '5m' }
  );

  // أ. محاولة إدخال رمز قديم أو خاطئ -> يجب أن يرفض
  const resWrongPin = await fetch(`${baseUrl}/api/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken, code: '000000' })
  });
  assert.strictEqual(resWrongPin.status, 401, 'Should reject invalid 2FA PIN');

  // ب. التحقق بالرمز الجديد المحدث (654321) -> يجب أن ينجح
  const resSuccessPin = await fetch(`${baseUrl}/api/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken, code: newPin })
  });
  assert.strictEqual(resSuccessPin.status, 200, 'Should accept valid updated 2FA PIN');
  const successData = await resSuccessPin.json();
  assert.strictEqual(successData.success, true);
  assert.ok(successData.token, 'Should issue valid login token');

  // ج. التحقق بكود الطوارئ الاحتياطي الدائم (889900) -> يجب أن ينجح
  const resEmergency = await fetch(`${baseUrl}/api/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken, code: '889900' })
  });
  assert.strictEqual(resEmergency.status, 200, 'Should accept emergency backup code 889900');
});

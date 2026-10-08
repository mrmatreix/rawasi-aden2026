/**
 * اختبارات الأمان والوظائف لبوابة وتطبيق العملاء (Client Portal Test Suite)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 * المبدأ الحاكم: Deny by Default وعزل البيانات
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const db = require('../server/database/db');
const seedClientPortal = require('../scripts/seed_client_portal');

let server;
let baseUrl = 'http://localhost:3000';
let authToken = '';
let clientUserId = 1;
let clientId = 1;

test.before(async () => {
  // التأكد من تهيئة البيانات الأولية
  await seedClientPortal();
});

test('1. Client Auth: Login with valid credentials and receive OTP challenge', async () => {
  const loginRes = await fetch(`${baseUrl}/api/client-portal/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'client@manara.com',
      password: 'Client@123456'
    })
  });

  assert.strictEqual(loginRes.status, 200);
  const data = await loginRes.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.requireOtp, true);
  assert.ok(data.tempToken, 'Should return tempToken for OTP verification');

  // التحقق من الـ OTP باستخدام الـ PIN الاحتياطي أو الكود المولد
  const verifyRes = await fetch(`${baseUrl}/api/client-portal/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tempToken: data.tempToken,
      otp: '123456',
      email: 'client@manara.com'
    })
  });

  assert.strictEqual(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.strictEqual(verifyData.success, true);
  assert.ok(verifyData.token, 'Should return 30-day JWT session token');
  assert.strictEqual(verifyData.user.role, 'owner');
  authToken = verifyData.token;
});

test('2. Security (Deny by Default): Verify internal financial metrics are NEVER leaked in Dashboard', async () => {
  const res = await fetch(`${baseUrl}/api/client-portal/dashboard`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);

  // التأكد من عدم وجود أي من حقول التكلفة الفعلية أو أرباح الشركة أو الموردين
  const rawString = JSON.stringify(body);
  assert.strictEqual(rawString.includes('actual_cost'), false, 'actual_cost must NEVER appear in client dashboard');
  assert.strictEqual(rawString.includes('actual_profit'), false, 'actual_profit must NEVER appear in client dashboard');
  assert.strictEqual(rawString.includes('expected_profit'), false, 'expected_profit must NEVER appear in client dashboard');
  assert.strictEqual(rawString.includes('supplier'), false, 'supplier details must NEVER appear in client dashboard');
});

test('3. Security (Deny by Default): Verify Project Details never leaks actual cost or internal profit', async () => {
  const res = await fetch(`${baseUrl}/api/client-portal/projects/1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);

  const rawString = JSON.stringify(body.project);
  assert.strictEqual(rawString.includes('actual_cost'), false, 'actual_cost must NOT be exposed in project details');
  assert.strictEqual(rawString.includes('actual_profit'), false, 'actual_profit must NOT be exposed in project details');
  assert.strictEqual(rawString.includes('expected_profit'), false, 'expected_profit must NOT be exposed in project details');
});

test('4. Security (Tenant Isolation): Reject access to non-existent or other clients projects', async () => {
  const res = await fetch(`${baseUrl}/api/client-portal/projects/999999`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  assert.strictEqual(res.status === 403 || res.status === 404, true);
  const body = await res.json();
  assert.strictEqual(body.success, false);
});

test('5. Invoices: Fetch and approve an invoice with notes', async () => {
  const listRes = await fetch(`${baseUrl}/api/client-portal/invoices`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.strictEqual(listData.success, true);
  assert.ok(listData.invoices.length > 0, 'Should have at least 1 invoice');

  const pendingInv = listData.invoices.find(i => i.client_approval_status === 'pending') || listData.invoices[0];

  const approveRes = await fetch(`${baseUrl}/api/client-portal/invoices/${pendingInv.id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      decision: 'approved',
      notes: 'تمت المراجعة الهندسية واعتماد المستخلص'
    })
  });

  assert.strictEqual(approveRes.status, 200);
  const approveData = await approveRes.json();
  assert.strictEqual(approveData.success, true);
  assert.strictEqual(approveData.decision, 'approved');
});

test('6. Messages: Send a new message to management', async () => {
  const res = await fetch(`${baseUrl}/api/client-portal/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      project_id: 1,
      subject: 'استفسار فني للاختبار',
      priority: 'high',
      body: 'هذه رسالة اختبارية للتحقق من تكامل واجهة مراسلات العميل'
    })
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.ok(body.message_id);
});

test('7. Notifications: Fetch notifications and mark as read', async () => {
  const res = await fetch(`${baseUrl}/api/client-portal/notifications`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.ok(Array.isArray(body.notifications));

  if (body.notifications.length > 0) {
    const firstNotif = body.notifications[0];
    const readRes = await fetch(`${baseUrl}/api/client-portal/notifications/${firstNotif.id}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(readRes.status, 200);
  }
});

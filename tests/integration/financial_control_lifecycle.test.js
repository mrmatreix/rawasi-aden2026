const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Financial Control & Document Lifecycle - Complete Integrity Suite', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'test-csrf-token-12345678901234567890123456789012';

  const hashedPass = bcrypt.hashSync('Pass@123456', 10);
  const makerId = 7101;
  const checkerId = 7102;

  const cleanupTestData = async () => {
    try {
      await db.run("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE created_by IN (?, ?) OR created_by_name IN ('maker_accountant', 'checker_auditor'))", [makerId, checkerId]);
      await db.run("DELETE FROM journal_entries WHERE created_by IN (?, ?) OR created_by_name IN ('maker_accountant', 'checker_auditor')", [makerId, checkerId]);
      await db.run("DELETE FROM expenses WHERE created_by IN (?, ?) OR created_by_name IN ('maker_accountant', 'checker_auditor')", [makerId, checkerId]);
      await db.run("DELETE FROM payments WHERE created_by IN (?, ?) OR created_by_name IN ('maker_accountant', 'checker_auditor')", [makerId, checkerId]);
      await db.run("DELETE FROM users WHERE id IN (?, ?) OR username IN ('maker_accountant', 'checker_auditor')", [makerId, checkerId]);
    } catch {}
  };

  await cleanupTestData();
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'maker_accountant', ?, 'accountant', 'المحاسب منشئ السند', 'active', '["expenses:view","expenses:create","expenses:edit","expenses:approve","accounting:view"]')`,
    [makerId, hashedPass]
  );
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'checker_auditor', ?, 'auditor', 'المراجع المالي المعتمد', 'active', '["expenses:view","expenses:approve","expenses:post","expenses:cancel","accounting:view","accounting:approve","accounting:post"]')`,
    [checkerId, hashedPass]
  );

  const getHeaders = (user) => {
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, permissions: user.permissions },
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
    username: 'maker_accountant',
    role: 'accountant',
    permissions: ['expenses:view', 'expenses:create', 'expenses:edit', 'expenses:approve', 'accounting:view', 'accounting:create']
  });
  const checkerHeaders = getHeaders({
    id: checkerId,
    username: 'checker_auditor',
    role: 'auditor',
    permissions: ['expenses:view', 'expenses:approve', 'expenses:post', 'expenses:cancel', 'accounting:view', 'accounting:approve', 'accounting:post']
  });

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  try {
    // 1. دورة حياة المستند: إنشاء مسودة والتحقق من عدم التأثير المالي على الدفاتر في مرحلة المسودة
    const initialCash = await db.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 100000 };
    const initialProj = await db.get('SELECT actual_cost FROM projects WHERE id = 1') || { actual_cost: 0 };

  const resDraft = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: makerHeaders,
    body: JSON.stringify({
      expense_type: 'مواد بناء',
      project_id: 1,
      amount: 50000,
      recipient: 'مقاول الخرسانة',
      notes: 'مسودة صرف للاختبار',
      status: 'draft'
    })
  });
  assert.strictEqual(resDraft.status, 200);
  const draftJson = await resDraft.json();
  assert.strictEqual(draftJson.success, true);
  assert.strictEqual(draftJson.status, 'draft', 'Status must be draft');
  const createdExpenseId = draftJson.id;
  const createdReceiptNo = draftJson.receipt_no;

  const afterDraftCash = await db.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 100000 };
  const afterDraftProj = await db.get('SELECT actual_cost FROM projects WHERE id = 1') || { actual_cost: 0 };
  assert.strictEqual(Number(afterDraftCash.current_balance), Number(initialCash.current_balance), 'Cash balance must not change on draft');
  assert.strictEqual(Number(afterDraftProj.actual_cost), Number(initialProj.actual_cost), 'Project actual cost must not change on draft');

  // إرسال المسودة للمراجعة (Draft -> Under Review)
  const resReview = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}/submit-review`, {
    method: 'POST',
    headers: makerHeaders,
    body: JSON.stringify({ notes: 'تمت مراجعة الفواتير الأولية ومطابقة الكميات' })
  });
  assert.strictEqual(resReview.status, 200);
  const reviewJson = await resReview.json();
  assert.strictEqual(reviewJson.status, 'under_review');

  // 2. مبدأ العيون الأربع (Maker-Checker): منع منشئ السند من اعتماده بنفسه
  const resSelfApprove = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}/approve`, {
    method: 'POST',
    headers: makerHeaders,
    body: JSON.stringify({ notes: 'محاولة اعتماد ذاتي' })
  });
  assert.strictEqual(resSelfApprove.status, 403, 'Should reject self-approval with 403 Forbidden');
  const selfJson = await resSelfApprove.json();
  assert.strictEqual(selfJson.fourEyesViolation, true, 'Flag fourEyesViolation must be true');

  // اعتماد السند بواسطة مدقق مستقل ومفوض
  const resCheckerApprove = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}/approve`, {
    method: 'POST',
    headers: checkerHeaders,
    body: JSON.stringify({ notes: 'اعتماد رسمي بعد تدقيق مستندات الصرف' })
  });
  assert.strictEqual(resCheckerApprove.status, 200, 'Independent auditor should approve successfully');
  const checkerJson = await resCheckerApprove.json();
  assert.strictEqual(checkerJson.status, 'approved');

  // ترحيل السند المعتمد لدفتر الأستاذ والصندوق (Post to GL)
  const resPost = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}/post`, {
    method: 'POST',
    headers: checkerHeaders
  });
  assert.strictEqual(resPost.status, 200, 'Posting should succeed');
  const postJson = await resPost.json();
  assert.strictEqual(postJson.status, 'posted');

  // 3. حصانة السجلات المالية: منع الحذف المباشر (DELETE) ومنع تعديل القيمة (PUT)
  const resDelete = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}`, {
    method: 'DELETE',
    headers: checkerHeaders
  });
  assert.strictEqual(resDelete.status, 400, 'Direct deletion of posted voucher must be rejected with 400');
  const delJson = await resDelete.json();
  assert.strictEqual(delJson.financialControlProtected, true);

  const resEdit = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}`, {
    method: 'PUT',
    headers: makerHeaders,
    body: JSON.stringify({ amount: 999999, notes: 'محاولة تعديل رصيد قيد مرحل' })
  });
  assert.strictEqual(resEdit.status, 400, 'Direct update of posted voucher must be rejected with 400');
  const editJson = await resEdit.json();
  assert.strictEqual(editJson.immutable, true);

  // 4. القيد العكسي الذري (Storno Reversal): إلزامية السبب وتوليد قيد يومي عكسي متزن
  const resNoReason = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}/reverse`, {
    method: 'POST',
    headers: checkerHeaders,
    body: JSON.stringify({ reason: '' })
  });
  assert.strictEqual(resNoReason.status, 400, 'Reversal without reason must be rejected');

  const resValidReversal = await fetch(`${baseUrl}/api/expenses/${createdExpenseId}/reverse`, {
    method: 'POST',
    headers: checkerHeaders,
    body: JSON.stringify({
      reason: 'خطأ في تقدير كميات الخرسانة الموردة للموقع وتم التراجع بمحضر اتفاق رقم 14',
      reversal_date: '2026-09-24'
    })
  });
  assert.strictEqual(resValidReversal.status, 200, 'Valid reversal must return 200 OK');
  const revJson = await resValidReversal.json();
  assert.strictEqual(revJson.success, true);
  assert.ok(revJson.reversing_entry_no, 'Should return reversing journal entry number');

  const reversedExpense = await db.get('SELECT * FROM expenses WHERE id = ?', [createdExpenseId]);
  assert.strictEqual(reversedExpense.status, 'reversed', 'Expense status must be reversed');
  assert.ok(reversedExpense.reversal_ref_id, 'Reversal journal entry ref must be recorded');

  const revJE = await db.get('SELECT * FROM journal_entries WHERE id = ?', [reversedExpense.reversal_ref_id]);
  assert.ok(revJE, 'Reversing journal entry must exist');
  assert.strictEqual(Number(revJE.total_debit), Number(revJE.total_credit), 'Reversing entry must be perfectly balanced');
  assert.strictEqual(Number(revJE.total_debit), 50000, 'Debit must match reversed amount');

  // 5. سجل التدقيق: توثيق المستخدم والوقت والقيم القديمة والجديدة والسبب
  const auditRecord = await db.get(
    "SELECT * FROM audit_logs WHERE action = 'REVERSE' AND entity_type = 'expense' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [createdReceiptNo]
  );
  assert.ok(auditRecord, 'Audit record for reversal must be logged');
  assert.strictEqual(auditRecord.username, 'checker_auditor');
  assert.ok(auditRecord.old_values);
  assert.ok(auditRecord.new_values);
  assert.ok(auditRecord.reason.includes('خطأ في تقدير كميات'));

  const oldParsed = JSON.parse(auditRecord.old_values);
  const newParsed = JSON.parse(auditRecord.new_values);
  assert.strictEqual(oldParsed.status, 'posted');
  assert.strictEqual(newParsed.status, 'reversed');

  await cleanupTestData();
  } catch (err) {
    console.error('LIFECYCLE TEST CAUGHT ERROR:', err);
    throw err;
  }
});

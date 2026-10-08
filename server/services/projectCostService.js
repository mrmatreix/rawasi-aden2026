/**
 * خدمة توحيد التكلفة الفعلية للمشاريع (Unified Project Cost Service)
 * ============================================================================
 * مصدر الحقيقة الوحيد (Single Source of Truth) للتكلفة الفعلية actual_cost.
 *
 * المعادلة الموحدة (تُحتسب من السجلات دائماً — لا تراكم يدوي):
 *
 *   التكلفة الفعلية = مصروفات مباشرة (مرحلة/معتمدة، بلا مرايا)
 *                   + صافي الصرف المخزني (صرف − مرتجع موقع)
 *                   + أجور ميدانية (غير الممتصة بسند رسمي)
 *                   + مشتريات فرعية (غير الممتصة بسند رسمي)
 *
 * منع الازدواج (Dedup):
 * 1. المصروفات «المرآة» (المنشأة آلياً من شاشتي الأجور والمشتريات) مربوطة
 *    بمصدرها عبر expenses.source_table/source_id وتُستبعد من بند المصروفات.
 * 2. الربط العكسي: سند رسمي (يدوي) يمكنه «امتصاص» بند فرعي عبر
 *    linked_expense_id — عند ترحيل السند يُحتسب السند فقط (+ متبقي البند
 *    إن كان السند جزئياً)، وقبل الترحيل يُحتسب البند كاملاً. لا فجوة ولا ازدواج.
 * 3. كشف الاشتباه: detectPossibleDuplicates يرصد القيود المتقاربة
 *    (نفس المشروع + المبلغ + التاريخ) ويعيد تحذيرات غير حاجبة.
 */

const db = require('../database/db');
const CashBoxService = require('./cashBoxService');
const { checkPeriodOpen } = require('./periodService');

const { query, get, run, transaction, getActiveEngine } = db;

// الحالات التي تُحتسب ضمن التكلفة (المرحلة + المعتمدة الملتزم بها)
const COUNTED_EXPENSE_STATUSES = ['posted', 'approved'];

// حماية من تكرار فحص المخطط (تُضبط فقط عند النجاح ليُعاد الفحص عند الفشل)
let schemaEnsured = false;

/**
 * التأكد من أعمدة الربط (idempotent). يُستدعى خارج المعاملات.
 * - expenses.source_table / source_id (تحديد المرايا)
 * - project_labor_expenses.linked_expense_id (امتصاص بسند رسمي)
 * - project_purchases.linked_expense_id (امتصاص بسند رسمي)
 * - project_labor_expenses.paid_amount (تتبع المسدد + تعبئة القديم)
 * - accounts.215 (الأجور المستحقة — خصوم تحت 2)
 */
async function ensureSchema() {
  if (schemaEnsured) return true;
  const engine = typeof getActiveEngine === 'function' ? getActiveEngine() : 'sqlite';

  const ensureColumn = async (table, column, sqliteDef, mysqlDef) => {
    if (engine === 'mysql') {
      const cols = await query(`SHOW COLUMNS FROM ${table}`);
      const names = (cols || []).map(c => c.Field || c.field || c.COLUMN_NAME);
      if (!names.includes(column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${mysqlDef}`);
      }
    } else {
      const cols = await query(`PRAGMA table_info(${table})`);
      const names = (cols || []).map(c => c.name);
      if (!names.includes(column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqliteDef}`);
      }
    }
  };

  try {
    await ensureColumn('expenses', 'source_table', 'TEXT', 'VARCHAR(60) NULL');
    await ensureColumn('expenses', 'source_id', 'INTEGER', 'INT NULL');
    await ensureColumn('project_labor_expenses', 'linked_expense_id', 'INTEGER', 'INT NULL');
    await ensureColumn('project_purchases', 'linked_expense_id', 'INTEGER', 'INT NULL');
    // SUGGESTION-8: تتبع المسدد للأجور الموقعية + تعبئة القديم حسب حالته
    await ensureColumn('project_labor_expenses', 'paid_amount', 'REAL DEFAULT NULL', 'REAL DEFAULT NULL');
    await run(`UPDATE project_labor_expenses SET paid_amount = total_amount WHERE paid_amount IS NULL AND payment_status = 'مدفوع'`);
    await run(`UPDATE project_labor_expenses SET paid_amount = 0 WHERE paid_amount IS NULL`);
    // SUGGESTION-8: حساب الأجور المستحقة (215) — خصوم تحت 2
    const wageAcc = await get("SELECT id FROM accounts WHERE code = '215' LIMIT 1");
    if (!wageAcc) {
      const parent = await get("SELECT id FROM accounts WHERE code = '2' LIMIT 1");
      await run('INSERT INTO accounts (code, name, type, parent_id, balance) VALUES (?, ?, ?, ?, 0)',
        ['215', 'أجور مستحقة الدفع (عمال وطواقم المواقع)', 'خصوم', parent ? parent.id : null]);
    }
    schemaEnsured = true;
    return true;
  } catch (err) {
    console.warn('⚠️ [ProjectCost] تعذر التأكد من مخطط الربط:', err.message);
    throw err;
  }
}

/** تنفيذ قراءة عبر tx أو الاتصال العام */
function pickConn(tx) {
  return tx || { query, get, run };
}

/**
 * تفصيل التكلفة الفعلية لمشروع من مصادرها الأربعة.
 * البنود الفرعية المربوطة بسند مرحل/معتمد تُحتسب بمتبقيها فقط (إن وُجد).
 */
async function getCostBreakdown(projectId, tx = null) {
  const pId = Number(projectId);
  if (!pId) throw new Error('معرف المشروع مطلوب لاحتساب التكلفة');
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);

  const statusList = COUNTED_EXPENSE_STATUSES.map(s => `'${s}'`).join(',');

  const expRow = await conn.get(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE project_id = ? AND status IN (${statusList}) AND source_table IS NULL`,
    [pId]
  );

  const outRow = await conn.get(
    `SELECT COALESCE(SUM(total_amount), 0) as total FROM inventory_transactions
     WHERE project_id = ? AND type = 'out'`,
    [pId]
  );

  const retRow = await conn.get(
    `SELECT COALESCE(SUM(total_amount), 0) as total FROM inventory_returns
     WHERE project_id = ? AND return_type = 'project_return'
       AND (status IS NULL OR status NOT IN ('reversed', 'cancelled'))`,
    [pId]
  );

  // الأجور: المربوطة بسند محتسب تُسهم بمتبقيها فقط (سند جزئي)، وإلا كاملة
  const laborRow = await conn.get(
    `SELECT COALESCE(SUM(
       CASE WHEN l.linked_expense_id IS NOT NULL AND e.status IN (${statusList})
            THEN CASE WHEN l.total_amount > e.amount THEN l.total_amount - e.amount ELSE 0 END
            ELSE l.total_amount END
     ), 0) as total,
     COALESCE(SUM(
       CASE WHEN l.linked_expense_id IS NOT NULL AND e.status IN (${statusList})
            THEN CASE WHEN e.amount > l.total_amount THEN l.total_amount ELSE e.amount END
            ELSE 0 END
     ), 0) as absorbed
     FROM project_labor_expenses l LEFT JOIN expenses e ON e.id = l.linked_expense_id
     WHERE l.project_id = ?`,
    [pId]
  );

  const purchRow = await conn.get(
    `SELECT COALESCE(SUM(
       CASE WHEN p.linked_expense_id IS NOT NULL AND e.status IN (${statusList})
            THEN CASE WHEN p.total_amount > e.amount THEN p.total_amount - e.amount ELSE 0 END
            ELSE p.total_amount END
     ), 0) as total,
     COALESCE(SUM(
       CASE WHEN p.linked_expense_id IS NOT NULL AND e.status IN (${statusList})
            THEN CASE WHEN e.amount > p.total_amount THEN p.total_amount ELSE e.amount END
            ELSE 0 END
     ), 0) as absorbed
     FROM project_purchases p LEFT JOIN expenses e ON e.id = p.linked_expense_id
     WHERE p.project_id = ?`,
    [pId]
  );

  const round = n => Math.round((Number(n) || 0) * 100) / 100;
  const expenses = round(expRow?.total);
  const inventoryOut = round(outRow?.total);
  const inventoryReturns = round(retRow?.total);
  const inventoryNet = round(inventoryOut - inventoryReturns);
  const labor = round(laborRow?.total);
  const laborAbsorbed = round(laborRow?.absorbed);
  const purchases = round(purchRow?.total);
  const purchasesAbsorbed = round(purchRow?.absorbed);

  const total = Math.max(0, round(expenses + inventoryNet + labor + purchases));

  return {
    project_id: pId,
    expenses,
    inventory_out: inventoryOut,
    inventory_returns: inventoryReturns,
    inventory_net: inventoryNet,
    labor,
    labor_absorbed: laborAbsorbed,
    purchases,
    purchases_absorbed: purchasesAbsorbed,
    total,
    formula: 'مصروفات مباشرة (مرحلة/معتمدة) + صافي الصرف المخزني + أجور ومشتريات (بمتبقي غير الممتص بسند)'
  };
}

/**
 * إعادة احتساب التكلفة الفعلية لمشروع وحفظها في حقل projects.actual_cost.
 */
async function recalculateProjectCost(projectId, tx = null) {
  const pId = Number(projectId);
  if (!pId) return null;
  const breakdown = await getCostBreakdown(pId, tx);
  const conn = pickConn(tx);
  await conn.run('UPDATE projects SET actual_cost = ? WHERE id = ?', [breakdown.total, pId]);
  return breakdown;
}

/**
 * ربط بند فرعي (أجور/مشتريات) بسند رسمي لامتصاصه ومنع الازدواج.
 * @param {'project_labor_expenses'|'project_purchases'} table
 */
async function linkSubRecordToExpense(table, subId, expenseId, projectId, tx = null) {
  if (!['project_labor_expenses', 'project_purchases'].includes(table)) {
    throw new Error('جدول المصدر غير صالح للربط');
  }
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);
  const sId = Number(subId);
  const eId = Number(expenseId);
  const pId = Number(projectId);
  if (!sId || !eId || !pId) throw new Error('بيانات الربط غير مكتملة');

  const expense = await conn.get('SELECT * FROM expenses WHERE id = ?', [eId]);
  if (!expense) throw new Error('سند الصرف المراد الربط به غير موجود');
  if (expense.source_table) {
    throw new Error('لا يمكن الربط بسند مرآة آلي — الربط يكون بسند رسمي مباشر فقط');
  }
  if (Number(expense.project_id) !== pId) {
    throw new Error('سند الصرف تابع لمشروع مختلف — لا يمكن الربط عبر المشاريع');
  }

  const sub = await conn.get(`SELECT * FROM ${table} WHERE id = ?`, [sId]);
  if (!sub) throw new Error('البند الفرعي المراد ربطه غير موجود');
  if (Number(sub.project_id) !== pId) {
    throw new Error('البند الفرعي تابع لمشروع مختلف');
  }
  if (sub.linked_expense_id && Number(sub.linked_expense_id) !== eId) {
    throw new Error(`هذا البند مربوط مسبقاً بسند آخر (رقم ${sub.linked_expense_id}) — يجب فك الربط أولاً`);
  }

  // SUGGESTION-7/8: السند المرتبط سدادٌ للبند — لا يتجاوز متبقيه المستحق
  const subTotalPre = Number(sub.total_amount) || 0;
  const expAmountPre = Number(expense.amount) || 0;
  const outstandingPre = subTotalPre - (Number(sub.paid_amount) || 0);
  if (expAmountPre - outstandingPre > 0.005) {
    const subKind = table === 'project_purchases' ? 'للفاتورة' : 'لبند الأجور';
    throw new Error(`لا يمكن ربط السند: مبلغ السند (${expAmountPre.toLocaleString('en')}) يتجاوز المتبقي المستحق ${subKind} (${outstandingPre.toLocaleString('en')})`);
  }

  await conn.run(`UPDATE ${table} SET linked_expense_id = ? WHERE id = ?`, [eId, sId]);

  const subTotal = Number(sub.total_amount) || 0;
  const expAmount = Number(expense.amount) || 0;
  let note = 'ربط كامل — البند مغطى بالسند بالكامل';
  if (expAmount < subTotal) {
    note = `ربط جزئي — السند يغطي ${expAmount.toLocaleString('en')} من أصل ${subTotal.toLocaleString('en')}، والمتبقي (${(subTotal - expAmount).toLocaleString('en')}) يبقى محتسباً حتى استكماله`;
  } else if (expAmount > subTotal) {
    note = `تنبيه: مبلغ السند (${expAmount.toLocaleString('en')}) يتجاوز البند (${subTotal.toLocaleString('en')}) — يُحتسب السند كاملاً`;
  }
  return { linked: true, expense_id: eId, sub_id: sId, note };
}

/** فك ربط بند فرعي عن سنده (يعود للاحتساب الكامل). */
async function unlinkSubRecord(table, subId, tx = null) {
  if (!['project_labor_expenses', 'project_purchases'].includes(table)) {
    throw new Error('جدول المصدر غير صالح');
  }
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);
  await conn.run(`UPDATE ${table} SET linked_expense_id = NULL WHERE id = ?`, [Number(subId)]);
  return { unlinked: true };
}

/** تنظيف الروابط المعلقة عند حذف مسودة سند (حتى لا تشير لغير موجود). */
async function clearLinksToExpense(expenseId, tx = null) {
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);
  const eId = Number(expenseId);
  if (!eId) return 0;
  let cleared = 0;
  for (const table of ['project_labor_expenses', 'project_purchases']) {
    const r = await conn.run(`UPDATE ${table} SET linked_expense_id = NULL WHERE linked_expense_id = ?`, [eId]);
    cleared += Number(r?.changes ?? r?.affectedRows ?? 0);
  }
  return cleared;
}

/**
 * كشف الاشتباه بالازدواج: نفس المشروع + مبلغ متقارب + تاريخ متقارب.
 * غير حاجب — يعيد قائمة تحذيرات وصفية.
 */
async function detectPossibleDuplicates({ projectId, amount, date, excludeExpenseId = null, excludeTable = null, excludeId = null }, tx = null) {
  const warnings = [];
  const pId = Number(projectId);
  const amt = Number(amount);
  if (!pId || !amt || amt <= 0) return warnings;
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);

  const day = String(date || '').split('T')[0];
  const pushWarn = (kind, row, label) => {
    warnings.push({
      kind,
      label,
      project_id: pId,
      amount: Number(row.amount ?? row.total_amount ?? row.total ?? 0),
      date: row.date || null,
      ref: row.receipt_no || row.reference_no || row.invoice_no || (row.worker_name_or_team ? `أجور: ${row.worker_name_or_team}` : `#${row.id}`),
      id: row.id
    });
  };

  // 1. مصروفات مباشرة مقاربة (نفس المبلغ ±1، خلال ±3 أيام)
  let expSql = `SELECT id, receipt_no, amount, date FROM expenses
     WHERE project_id = ? AND source_table IS NULL AND status NOT IN ('reversed', 'cancelled')
       AND ABS(amount - ?) <= 1`;
  const expParams = [pId, amt];
  if (excludeExpenseId) {
    expSql += ' AND id != ?';
    expParams.push(Number(excludeExpenseId));
  }
  if (day) {
    expSql += ' AND date BETWEEN date(?, \'-3 days\') AND date(?, \'+3 days\')';
    expParams.push(day, day);
  }
  expSql += ' LIMIT 5';
  // توافق MySQL: دالة date() غير موجودة — نستخدم مقارنة نصية مباشرة
  expSql = expSql.replace(/date\(\?, '-3 days'\)/g, '?').replace(/date\(\?, '\+3 days'\)/g, '?');
  const expParamsFinal = [...expParams];
  if (day) {
    // حساب النطاق في JS ليعمل على المحركين
    const d = new Date(day + 'T00:00:00');
    const fmt = x => x.toISOString().split('T')[0];
    const from = new Date(d); from.setDate(from.getDate() - 3);
    const to = new Date(d); to.setDate(to.getDate() + 3);
    expParamsFinal.splice(expParamsFinal.length - 2, 2, fmt(from), fmt(to));
  }
  const dupExpenses = await conn.query(expSql, expParamsFinal);
  for (const row of dupExpenses || []) {
    pushWarn('expense', row, `مصروف مباشر بنفس المبلغ تقريباً (${Number(row.amount).toLocaleString('en')}) بتاريخ ${row.date}`);
  }

  // 2. بنود فرعية غير مربوطة بنفس المبلغ
  const checkSub = async (table, kind, labelFn) => {
    let sql = `SELECT * FROM ${table} WHERE project_id = ? AND linked_expense_id IS NULL AND ABS(total_amount - ?) <= 1`;
    const params = [pId, amt];
    if (excludeTable === table && excludeId) {
      sql += ' AND id != ?';
      params.push(Number(excludeId));
    }
    if (day) {
      const d = new Date(day + 'T00:00:00');
      const fmt = x => x.toISOString().split('T')[0];
      const from = new Date(d); from.setDate(from.getDate() - 3);
      const to = new Date(d); to.setDate(to.getDate() + 3);
      sql += ' AND date BETWEEN ? AND ?';
      params.push(fmt(from), fmt(to));
    }
    sql += ' LIMIT 5';
    const rows = await conn.query(sql, params);
    for (const row of rows || []) pushWarn(kind, row, labelFn(row));
  };

  await checkSub('project_labor_expenses', 'labor',
    r => `بند أجور غير مربوط بنفس المبلغ (${Number(r.total_amount).toLocaleString('en')}) — ${r.worker_name_or_team || ''} بتاريخ ${r.date}`);
  await checkSub('project_purchases', 'purchase',
    r => `فاتورة مشتريات فرعية غير مربوطة بنفس المبلغ (${Number(r.total_amount).toLocaleString('en')}) — ${(r.item_description || '').slice(0, 40)} بتاريخ ${r.date}`);

  // 3. صرف مخزني بنفس القيمة (خلال ±7 أيام)
  let invSql = `SELECT id, reference_no, total_amount as amount, date FROM inventory_transactions
     WHERE project_id = ? AND type = 'out' AND ABS(total_amount - ?) <= 1`;
  const invParams = [pId, amt];
  if (day) {
    const d = new Date(day + 'T00:00:00');
    const fmt = x => x.toISOString().split('T')[0];
    const from = new Date(d); from.setDate(from.getDate() - 7);
    const to = new Date(d); to.setDate(to.getDate() + 7);
    invSql += ' AND date BETWEEN ? AND ?';
    invParams.push(fmt(from), fmt(to));
  }
  invSql += ' LIMIT 5';
  const dupInv = await conn.query(invSql, invParams);
  for (const row of dupInv || []) {
    pushWarn('inventory', row, `صرف مخزني بنفس القيمة تقريباً (${Number(row.amount).toLocaleString('en')}) بتاريخ ${row.date} — تأكد أنه ليس نفس الحدث`);
  }

  return warnings.slice(0, 8);
}

/**
 * إعادة احتساب التكلفة لكل المشاريع (للترحيل والمعالجة الجماعية).
 */
async function recalculateAllProjects() {
  await ensureSchema();
  const projects = await query('SELECT id, code, name, actual_cost FROM projects ORDER BY id ASC');
  const details = [];
  for (const p of projects) {
    const before = Number(p.actual_cost) || 0;
    const breakdown = await recalculateProjectCost(p.id);
    details.push({
      id: p.id,
      code: p.code,
      name: p.name,
      before,
      after: breakdown.total,
      drift: Math.round((breakdown.total - before) * 100) / 100,
      breakdown
    });
  }
  return { projects_count: details.length, details };
}

/**
 * ربط المصروفات المرآة القديمة بمصادرها (لمرة واحدة بعد الترقية).
 */
async function backfillMirrorLinks() {
  await ensureSchema();
  let linked = 0;

  const labMirrors = await query(
    "SELECT id, receipt_no FROM expenses WHERE source_table IS NULL AND receipt_no LIKE 'EXP-LAB-%'"
  );
  for (const m of labMirrors) {
    const srcId = Number(String(m.receipt_no).replace('EXP-LAB-', '')) || null;
    await run('UPDATE expenses SET source_table = ?, source_id = ? WHERE id = ?', [
      'project_labor_expenses', srcId, m.id
    ]);
    linked++;
  }

  const purMirrors = await query(
    "SELECT id, receipt_no FROM expenses WHERE source_table IS NULL AND receipt_no LIKE 'EXP-PUR-%'"
  );
  for (const m of purMirrors) {
    const srcId = Number(String(m.receipt_no).replace('EXP-PUR-', '')) || null;
    await run('UPDATE expenses SET source_table = ?, source_id = ? WHERE id = ?', [
      'project_purchases', srcId, m.id
    ]);
    linked++;
  }

  const customPur = await run(
    `UPDATE expenses SET source_table = 'project_purchases'
     WHERE source_table IS NULL AND notes LIKE 'فاتورة مشتريات:%'`
  );
  linked += Number(customPur?.changes ?? customPur?.affectedRows ?? 0);

  return linked;
}

/**
 * حذف المصروفات المرآة المرتبطة بسجل فرعي (عند حذف الأصل).
 * لا يحذف أي مصروف له قيد يومي مرتبط (حماية).
 */
async function deleteLinkedMirrors(sourceTable, sourceId, tx = null) {
  if (!sourceTable || !sourceId) return 0;
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);
  const mirrors = await conn.query(
    'SELECT id FROM expenses WHERE source_table = ? AND source_id = ?',
    [sourceTable, Number(sourceId)]
  );
  let deleted = 0;
  for (const m of mirrors) {
    const je = await conn.get(
      'SELECT id FROM journal_entries WHERE reference_id = ? LIMIT 1',
      [m.id]
    );
    if (je) continue;
    await conn.run('DELETE FROM expenses WHERE id = ?', [m.id]);
    deleted++;
  }
  return deleted;
}

// ─── SUGGESTION-5 (§12): قيود المرايا (no-voucher-without-JE) ─────────────────
// كل مصروف مرآة مرحّل له قيد يومي متزن: مدين مصروف / دائن صندوق، + حركة صندوق.
// حذف الأصل يعكس المرآة (لا حذف فيزيائي لما عليه قيد).

const MIRROR_JE_TYPES = {
  project_labor_expenses: 'مصروف مرآة عمالة',
  project_purchases: 'مصروف مرآة مشتريات'
};

/** حسابات المرآة: العمالة ← 511 (فإن غاب: 5)، المشتريات ← 5، الدائن ← 111 */
async function resolveMirrorAccounts(conn, sourceTable) {
  let debitAcc = null;
  if (sourceTable === 'project_labor_expenses') {
    debitAcc = await conn.get("SELECT id FROM accounts WHERE code = '511' LIMIT 1");
  }
  if (!debitAcc) {
    debitAcc = await conn.get("SELECT id FROM accounts WHERE code = '5' LIMIT 1");
  }
  const cashAcc = await conn.get("SELECT id FROM accounts WHERE code = '111' LIMIT 1");
  if (!debitAcc || !cashAcc) {
    throw new Error('الحسابات المحاسبية للمرايا (5/111) غير موجودة في الدليل');
  }
  return { debitAccId: debitAcc.id, cashAccId: cashAcc.id };
}

/**
 * إنشاء قيد المرآة داخل معاملة المتصل (لا DDL هنا).
 * user = { id, name } — قد يكونا null في الباكفيل (يُسجل 'ترحيل آلي').
 */
async function createMirrorJournal(conn, {
  sourceTable, expenseId, projectId = null, costCenterId = null,
  amount, date, receiptNo, label, user = null
}) {
  const refType = MIRROR_JE_TYPES[sourceTable];
  if (!refType) throw new Error('نوع مصدر المرآة غير معروف: ' + sourceTable);
  const { debitAccId, cashAccId } = await resolveMirrorAccounts(conn, sourceTable);
  const countRes = await conn.get('SELECT COUNT(*) as cnt FROM journal_entries');
  let jeSeq = ((countRes ? countRes.cnt : 0) || 0) + 1;
  const year = String(date || '').slice(0, 4) || new Date().getFullYear();
  let entryNo = `JE-MIR-${year}-${String(jeSeq).padStart(4, '0')}`;
  while (await conn.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
    jeSeq++;
    entryNo = `JE-MIR-${year}-${String(jeSeq).padStart(4, '0')}`;
  }
  const userName = (user && user.name) || 'ترحيل آلي';
  const userId = (user && user.id) || null;
  const jeRes = await conn.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    entryNo, date, `${refType} ${receiptNo} — ${label}`,
    refType, expenseId, amount, amount,
    userId, userName, userId, userName
  ]);
  const jeId = jeRes.lastInsertRowid || jeRes.insertId;
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [jeId, debitAccId, costCenterId ?? null, projectId ?? null, amount, `${refType} ${receiptNo}`]);
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `, [jeId, cashAccId, costCenterId ?? null, projectId ?? null, amount, `الصندوق — ${refType} ${receiptNo}`]);
  return { jeId, entryNo };
}

/** قيد المرآة المرتبط بمصروف (مطابقة دقيقة بالنوع + المرجع) */
async function getMirrorJournal(conn, expenseId) {
  return conn.get(
    `SELECT * FROM journal_entries
     WHERE reference_id = ? AND reference_type IN ('مصروف مرآة عمالة', 'مصروف مرآة مشتريات')
     ORDER BY id ASC LIMIT 1`,
    [expenseId]
  );
}

/**
 * عكس مرايا سجل فرعي محذوف (داخل معاملة المتصل — ذري مع حذف الأصل).
 * ينشئ قيد REV + يعكس الأصلي + يقلب المرآة + يعيد النقد لصندوق المشروع.
 */
async function reverseLinkedMirrors(sourceTable, sourceId, { tx = null, user = null, reason = '', reversalDate = null } = {}) {
  if (!sourceTable || !sourceId) return 0;
  if (!tx) await ensureSchema();
  const conn = pickConn(tx);
  const revDate = reversalDate || new Date().toISOString().split('T')[0];
  const period = await checkPeriodOpen(revDate);
  if (!period.isOpen) throw new Error(period.message);
  const cleanReason = String(reason || '').trim() || 'حذف سجل الأصل المرتبط بالمرآة';
  const userName = (user && user.name) || 'النظام';
  const userId = (user && user.id) || null;

  const mirrors = await conn.query(
    `SELECT * FROM expenses WHERE source_table = ? AND source_id = ? AND status IN ('posted', 'approved')`,
    [sourceTable, Number(sourceId)]
  );
  let reversed = 0;
  for (const m of mirrors) {
    const je = await getMirrorJournal(conn, m.id);
    if (!je || (je.status || '').toLowerCase() !== 'posted') continue;
    const lines = await conn.query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [je.id]);
    if (!lines || lines.length === 0) continue;

    const countRes = await conn.get('SELECT COUNT(*) as cnt FROM journal_entries');
    let jeSeq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    let revNo = `REV-${revDate.slice(0, 4)}-${String(jeSeq).padStart(4, '0')}`;
    while (await conn.get('SELECT id FROM journal_entries WHERE entry_no = ?', [revNo])) {
      jeSeq++;
      revNo = `REV-${revDate.slice(0, 4)}-${String(jeSeq).padStart(4, '0')}`;
    }
    const total = Number(je.total_debit) || 0;
    const revRes = await conn.run(`
      INSERT INTO journal_entries (
        entry_no, date, description, reference_type, reference_id,
        total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
      )
      VALUES (?, ?, ?, 'قيد عكسي', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      revNo, revDate, `قيد عكسي للمرآة ${m.receipt_no} (${je.entry_no}) — ${cleanReason}`,
      m.id, total, total, userId, userName, userId, userName
    ]);
    const revId = revRes.lastInsertRowid || revRes.insertId;
    for (const l of lines) {
      await conn.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [revId, l.account_id, l.cost_center_id ?? null, l.project_id ?? null,
          Number(l.credit) || 0, Number(l.debit) || 0, `عكس: ${l.notes || ''}`]);
    }
    await conn.run(`
      UPDATE journal_entries
      SET status = 'reversed', reversed_by = ?, reversed_by_name = ?,
          reversed_at = CURRENT_TIMESTAMP, reversal_reason = ?, reversal_ref_id = ?
      WHERE id = ?
    `, [userId, userName, cleanReason, revId, je.id]);
    await conn.run(`
      UPDATE expenses
      SET status = 'reversed', reversed_by = ?, reversed_by_name = ?,
          reversed_at = CURRENT_TIMESTAMP, reversal_reason = ?, reversal_ref_id = ?
      WHERE id = ?
    `, [userId, userName, cleanReason, revId, m.id]);
    // إعادة النقد لصندوق المشروع (تعويض حركة الصرف الأصلية)
    await CashBoxService.appendMovement(conn, {
      projectId: m.project_id ?? null, cashIn: Number(m.amount) || 0,
      currency: m.currency || 'ر.ي', date: revDate, notes: `عكس مرآة: ${m.receipt_no}`
    });
    reversed++;
  }
  return reversed;
}

/**
 * باكفيل قيود المرايا القديمة (idempotent — كل مرآة بمعاملتها).
 * يتخطى مرايا الفترات المقفلة مع الإبلاغ (لا يمكن الترحيل فيها).
 */
async function backfillMirrorJEs() {
  await ensureSchema();
  const mirrors = await query(`
    SELECT e.* FROM expenses e
    WHERE e.source_table IS NOT NULL AND e.status IN ('posted', 'approved')
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries j
        WHERE j.reference_id = e.id
          AND j.reference_type IN ('مصروف مرآة عمالة', 'مصروف مرآة مشتريات')
      )
    ORDER BY e.id ASC
  `);
  let created = 0;
  let skippedClosed = 0;
  for (const m of mirrors) {
    const period = await checkPeriodOpen(m.date);
    if (!period.isOpen) { skippedClosed++; continue; }
    await transaction(async (tx) => {
      let ccId = null;
      if (m.project_id) {
        const prjCc = await tx.get('SELECT id FROM cost_centers WHERE project_id = ? LIMIT 1', [m.project_id]);
        if (prjCc) ccId = prjCc.id;
      }
      if (!ccId) ccId = 1;
      await createMirrorJournal(tx, {
        sourceTable: m.source_table, expenseId: m.id,
        projectId: m.project_id ?? null, costCenterId: ccId,
        amount: Number(m.amount) || 0, date: m.date,
        receiptNo: m.receipt_no, label: m.notes || m.expense_type, user: null
      });
      await CashBoxService.appendMovement(tx, {
        projectId: m.project_id ?? null, cashOut: Number(m.amount) || 0,
        currency: m.currency || 'ر.ي', date: m.date, notes: `مصروف مرآة: ${m.receipt_no} (باكفيل)`
      });
    });
    created++;
  }
  return { total: mirrors.length, created, skipped_closed: skippedClosed };
}

// ─── SUGGESTION-6 (§12): ذمم الموردين لمشتريات المواقع ────────────────────────
// لا مشتريات آجلة بلا التزام: المتبقي غير المسدد من الفاتورة الموقعية يُثبت
// دائناً للمورد (21) بقيد استحقاق + رصيد مورد، والسداد اللاحق يخفض الالتزام
// بقيد تسوية (مدين 21 / دائن 111) + حركة صندوق. حذف الفاتورة يفك كل الأثر.

const AP_JE_TYPES = {
  accrual: 'مستحق مورد — مشتريات موقعية',
  settlement: 'سداد مستحق موقعية'
};

/** حسابات الذمم: المصروف ← 5، الالتزام ← 21، النقد ← 111 */
async function resolvePayableAccounts(conn) {
  const exp = await conn.get("SELECT id FROM accounts WHERE code = '5' LIMIT 1");
  const ap = await conn.get("SELECT id FROM accounts WHERE code = '21' LIMIT 1");
  const cash = await conn.get("SELECT id FROM accounts WHERE code = '111' LIMIT 1");
  if (!exp || !ap || !cash) {
    throw new Error('الحسابات المحاسبية للذمم (5/21/111) غير موجودة في الدليل');
  }
  return { expenseAccId: exp.id, apAccId: ap.id, cashAccId: cash.id };
}

/** ترقيم قيود ببادئة مخصصة (مع ضمان الفرادة) */
async function nextEntryNo(conn, prefix, year) {
  const countRes = await conn.get('SELECT COUNT(*) as cnt FROM journal_entries');
  let jeSeq = ((countRes ? countRes.cnt : 0) || 0) + 1;
  let entryNo = `${prefix}-${year}-${String(jeSeq).padStart(4, '0')}`;
  while (await conn.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
    jeSeq++;
    entryNo = `${prefix}-${year}-${String(jeSeq).padStart(4, '0')}`;
  }
  return entryNo;
}

/**
 * قيد استحقاق المورد داخل معاملة المتصل: مدين مصروف (5) / دائن موردون (21).
 * بلا حركة نقدية (استحقاق دفتري — النقد يتحرك عند السداد فقط).
 */
async function createPayableJournal(conn, {
  purchaseId, supplierId, projectId = null, costCenterId = null,
  amount, date, invoiceRef, user = null
}) {
  const { expenseAccId, apAccId } = await resolvePayableAccounts(conn);
  const year = String(date || '').slice(0, 4) || new Date().getFullYear();
  const entryNo = await nextEntryNo(conn, 'JE-AP', year);
  const userName = (user && user.name) || 'ترحيل آلي';
  const userId = (user && user.id) || null;
  const refType = AP_JE_TYPES.accrual;
  const jeRes = await conn.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    entryNo, date, `استحقاق مورد — فاتورة موقعية ${invoiceRef}`,
    refType, purchaseId, amount, amount,
    userId, userName, userId, userName
  ]);
  const jeId = jeRes.lastInsertRowid || jeRes.insertId;
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [jeId, expenseAccId, costCenterId ?? null, projectId ?? null, amount, `مصروف مواد — ${invoiceRef}`]);
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `, [jeId, apAccId, costCenterId ?? null, projectId ?? null, amount, `ذمة المورد — ${invoiceRef}`]);
  return { jeId, entryNo };
}

/**
 * قيد سداد المستحق داخل معاملة المتصل: مدين موردون (21) / دائن صندوق (111).
 * (الحركة النقدية في صندوق المشروع مسؤولية المتصل — كالمرايا.)
 */
async function createSettlementJournal(conn, {
  purchaseId, supplierId, projectId = null, costCenterId = null,
  amount, date, payRef, user = null
}) {
  const { apAccId, cashAccId } = await resolvePayableAccounts(conn);
  const year = String(date || '').slice(0, 4) || new Date().getFullYear();
  const entryNo = await nextEntryNo(conn, 'JE-SET', year);
  const userName = (user && user.name) || 'ترحيل آلي';
  const userId = (user && user.id) || null;
  const refType = AP_JE_TYPES.settlement;
  const jeRes = await conn.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    entryNo, date, `سداد مستحق موقعية — ${payRef}`,
    refType, purchaseId, amount, amount,
    userId, userName, userId, userName
  ]);
  const jeId = jeRes.lastInsertRowid || jeRes.insertId;
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [jeId, apAccId, costCenterId ?? null, projectId ?? null, amount, `سداد ذمة المورد — ${payRef}`]);
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `, [jeId, cashAccId, costCenterId ?? null, projectId ?? null, amount, `الصندوق — ${payRef}`]);
  return { jeId, entryNo };
}

/** قيد الاستحقاق المرحّل لفاتورة موقعية (الأحدث أولاً) */
async function getPayableJournal(conn, purchaseId) {
  const c = conn || { query, get, run };
  return c.get(
    `SELECT * FROM journal_entries
     WHERE reference_id = ? AND reference_type = ?
       AND LOWER(status) = 'posted'
     ORDER BY id DESC LIMIT 1`,
    [purchaseId, AP_JE_TYPES.accrual]
  );
}

/** قيود التسوية المرحّلة لفاتورة موقعية */
async function getSettlementJournals(conn, purchaseId) {
  const c = conn || { query, get, run };
  return c.query(
    `SELECT * FROM journal_entries
     WHERE reference_id = ? AND reference_type = ?
       AND LOWER(status) = 'posted'
     ORDER BY id ASC`,
    [purchaseId, AP_JE_TYPES.settlement]
  );
}

/** بناء قيد عكسي لقيد ذمم (مشارك للاستحقاق والتسويات — موردين وأجور) */
async function postPayableReversalJE(conn, je, { revDate, reason, user, refId, label = 'لذمم الموردين' }) {
  const lines = await conn.query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [je.id]);
  if (!lines || lines.length === 0) return null;
  const revNo = await nextEntryNo(conn, 'REV', String(revDate).slice(0, 4));
  const total = Number(je.total_debit) || 0;
  const userName = (user && user.name) || 'النظام';
  const userId = (user && user.id) || null;
  const revRes = await conn.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
    )
    VALUES (?, ?, ?, 'قيد عكسي', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    revNo, revDate, `قيد عكسي ${label} (${je.entry_no}) — ${reason}`,
    refId, total, total, userId, userName, userId, userName
  ]);
  const revId = revRes.lastInsertRowid || revRes.insertId;
  for (const l of lines) {
    await conn.run(`
      INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [revId, l.account_id, l.cost_center_id ?? null, l.project_id ?? null,
        Number(l.credit) || 0, Number(l.debit) || 0, `عكس: ${l.notes || ''}`]);
  }
  await conn.run(`
    UPDATE journal_entries
    SET status = 'reversed', reversed_by = ?, reversed_by_name = ?,
        reversed_at = CURRENT_TIMESTAMP, reversal_reason = ?, reversal_ref_id = ?
    WHERE id = ?
  `, [userId, userName, reason, revId, je.id]);
  return { revId, revNo, total };
}

/**
 * فك أثر الذمم عند حذف الفاتورة الموقعية (داخل معاملة المتصل).
 * يعكس قيد الاستحقاق + قيود التسوية، يعيد النقد المسدد لصندوق المشروع،
 * ويعيد رصيد المورد لوضعه قبل الفاتورة. يُرمى عند إقفال فترة اليوم.
 */
async function reverseSitePurchasePayables(conn, purchase, { user = null, reason = '', revDate = null } = {}) {
  if (!purchase || !purchase.id) return { apReversed: 0, settlementsReversed: 0, balanceDelta: 0 };
  const revDay = revDate || new Date().toISOString().split('T')[0];
  const period = await checkPeriodOpen(revDay);
  if (!period.isOpen) throw new Error(period.message);
  const cleanReason = String(reason || '').trim() || 'حذف الفاتورة الموقعية وفك ذممها';
  const supplierId = purchase.supplier_id ? Number(purchase.supplier_id) : null;

  let apReversed = 0;
  let apBooked = 0;
  const apJe = await getPayableJournal(conn, purchase.id);
  if (apJe) {
    const rev = await postPayableReversalJE(conn, apJe, {
      revDate: revDay, reason: cleanReason, user, refId: purchase.id
    });
    if (rev) { apReversed = 1; apBooked = rev.total; }
  }

  let settlementsReversed = 0;
  let settledSum = 0;
  const settlements = await getSettlementJournals(conn, purchase.id);
  for (const s of settlements) {
    const rev = await postPayableReversalJE(conn, s, {
      revDate: revDay, reason: cleanReason, user, refId: purchase.id
    });
    if (!rev) continue;
    // إعادة النقد المسدد لصندوق المشروع (تعويض حركة السداد الأصلية)
    await CashBoxService.appendMovement(conn, {
      projectId: purchase.project_id ?? null, cashIn: rev.total,
      currency: 'ر.ي', date: revDay, notes: `عكس سداد مستحق موقعية: ${s.entry_no}`
    });
    settlementsReversed++;
    settledSum += rev.total;
  }

  // إعادة رصيد المورد لوضع ما قبل الفاتورة: −المثبت +المسدد
  let balanceDelta = 0;
  if (supplierId && Math.abs(apBooked - settledSum) > 0.005) {
    const delta = apBooked - settledSum;
    if (delta > 0) {
      await conn.run(
        'UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?',
        [delta, supplierId]
      );
      balanceDelta = -delta;
    } else {
      await conn.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [-delta, supplierId]);
      balanceDelta = -delta;
    }
  }
  return { apReversed, settlementsReversed, balanceDelta };
}

/**
 * تقرير التعرض غير المثبت: فواتير موقعية بمتبقي > 0 بلا قيد استحقاق مرحّل.
 * قراءة فقط — تُراجع يدوياً وتُثبت كأرصدة افتتاحية، لا ترحيل آلي لمجهول الدائنين.
 */
async function reportUnbookedPayables() {
  const rows = await query(`
    SELECT pp.id, pp.project_id, pp.invoice_no,
           COALESCE(s.name, pp.supplier_name, 'بلا مورد') as supplier_label,
           pp.total_amount, COALESCE(pp.paid_amount, 0) as paid_amount,
           (pp.total_amount - COALESCE(pp.paid_amount, 0)) as outstanding, pp.date
    FROM project_purchases pp
    LEFT JOIN suppliers s ON s.id = pp.supplier_id
    WHERE (pp.total_amount - COALESCE(pp.paid_amount, 0)) > 0.005
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries j
        WHERE j.reference_id = pp.id
          AND j.reference_type = '${AP_JE_TYPES.accrual}'
          AND LOWER(j.status) = 'posted'
      )
    ORDER BY pp.date ASC, pp.id ASC
  `);
  const total = (rows || []).reduce((sum, r) => sum + (Number(r.outstanding) || 0), 0);
  return { rows: rows || [], count: (rows || []).length, total };
}

// ─── SUGGESTION-8 (§12): ذمم الأجور الموقعية ─────────────────────────────────
// لا أجور آجلة بلا التزام: المتبقي غير المسدد يُثبت دائناً (215) بقيد استحقاق،
// والسداد اللاحق (endpoint أو سند مرتبط) يخفض الالتزام. الدائن اسم العامل/الطاقم
// (السجلات هي الأستاذ الفرعي — بلا جدول أرصدة منفصل).

const WAGE_JE_TYPES = {
  accrual: 'مستحق أجور — عمالة موقعية',
  settlement: 'سداد مستحق أجور'
};

/** حسابات الأجور: المصروف ← 511 (فإن غاب: 5)، الالتزام ← 215، النقد ← 111 */
async function resolveWageAccounts(conn) {
  let exp = await conn.get("SELECT id FROM accounts WHERE code = '511' LIMIT 1");
  if (!exp) exp = await conn.get("SELECT id FROM accounts WHERE code = '5' LIMIT 1");
  const wp = await conn.get("SELECT id FROM accounts WHERE code = '215' LIMIT 1");
  const cash = await conn.get("SELECT id FROM accounts WHERE code = '111' LIMIT 1");
  if (!exp || !wp || !cash) {
    throw new Error('الحسابات المحاسبية للأجور (511/215/111) غير موجودة في الدليل');
  }
  return { wageExpAccId: exp.id, wagesPayableAccId: wp.id, cashAccId: cash.id };
}

/**
 * قيد استحقاق الأجور داخل معاملة المتصل: مدين أجور (511) / دائن مستحقة (215).
 * بلا حركة نقدية (استحقاق دفتري — النقد يتحرك عند السداد فقط).
 */
async function createWageAccrualJournal(conn, {
  laborId, workerLabel, projectId = null, costCenterId = null,
  amount, date, user = null
}) {
  const { wageExpAccId, wagesPayableAccId } = await resolveWageAccounts(conn);
  const year = String(date || '').slice(0, 4) || new Date().getFullYear();
  const entryNo = await nextEntryNo(conn, 'JE-WP', year);
  const userName = (user && user.name) || 'ترحيل آلي';
  const userId = (user && user.id) || null;
  const refType = WAGE_JE_TYPES.accrual;
  const jeRes = await conn.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    entryNo, date, `استحقاق أجور — ${workerLabel} (سجل #${laborId})`,
    refType, laborId, amount, amount,
    userId, userName, userId, userName
  ]);
  const jeId = jeRes.lastInsertRowid || jeRes.insertId;
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [jeId, wageExpAccId, costCenterId ?? null, projectId ?? null, amount, `مصروف أجور — ${workerLabel}`]);
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `, [jeId, wagesPayableAccId, costCenterId ?? null, projectId ?? null, amount, `أجر مستحق — ${workerLabel}`]);
  return { jeId, entryNo };
}

/**
 * قيد سداد المستحق داخل معاملة المتصل: مدين مستحقة (215) / دائن صندوق (111).
 * (الحركة النقدية في صندوق المشروع مسؤولية المتصل.)
 */
async function createWageSettlementJournal(conn, {
  laborId, workerLabel, projectId = null, costCenterId = null,
  amount, date, payRef, user = null
}) {
  const { wagesPayableAccId, cashAccId } = await resolveWageAccounts(conn);
  const year = String(date || '').slice(0, 4) || new Date().getFullYear();
  const entryNo = await nextEntryNo(conn, 'JE-WS', year);
  const userName = (user && user.name) || 'ترحيل آلي';
  const userId = (user && user.id) || null;
  const refType = WAGE_JE_TYPES.settlement;
  const jeRes = await conn.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    entryNo, date, `سداد مستحق أجور — ${workerLabel} (${payRef})`,
    refType, laborId, amount, amount,
    userId, userName, userId, userName
  ]);
  const jeId = jeRes.lastInsertRowid || jeRes.insertId;
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [jeId, wagesPayableAccId, costCenterId ?? null, projectId ?? null, amount, `سداد أجر مستحق — ${workerLabel}`]);
  await conn.run(`
    INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `, [jeId, cashAccId, costCenterId ?? null, projectId ?? null, amount, `الصندوق — ${payRef}`]);
  return { jeId, entryNo };
}

/** قيد الاستحقاق المرحّل لسجل أجور (الأحدث أولاً) */
async function getWageAccrualJournal(conn, laborId) {
  const c = conn || { query, get, run };
  return c.get(
    `SELECT * FROM journal_entries
     WHERE reference_id = ? AND reference_type = ?
       AND LOWER(status) = 'posted'
     ORDER BY id DESC LIMIT 1`,
    [laborId, WAGE_JE_TYPES.accrual]
  );
}

/** قيود التسوية المرحّلة لسجل أجور */
async function getWageSettlementJournals(conn, laborId) {
  const c = conn || { query, get, run };
  return c.query(
    `SELECT * FROM journal_entries
     WHERE reference_id = ? AND reference_type = ?
       AND LOWER(status) = 'posted'
     ORDER BY id ASC`,
    [laborId, WAGE_JE_TYPES.settlement]
  );
}

/**
 * فك أثر الأجور عند حذف السجل (داخل معاملة المتصل).
 * يعكس قيد الاستحقاق + قيود التسوية، ويعيد النقد المسدد لصندوق المشروع.
 * يُرمى عند إقفال فترة اليوم.
 */
async function reverseSiteLaborPayables(conn, labor, { user = null, reason = '', revDate = null } = {}) {
  if (!labor || !labor.id) return { accrualReversed: 0, settlementsReversed: 0 };
  const revDay = revDate || new Date().toISOString().split('T')[0];
  const period = await checkPeriodOpen(revDay);
  if (!period.isOpen) throw new Error(period.message);
  const cleanReason = String(reason || '').trim() || 'حذف سجل الأجور وفك مستحقاته';

  let accrualReversed = 0;
  const accJe = await getWageAccrualJournal(conn, labor.id);
  if (accJe) {
    const rev = await postPayableReversalJE(conn, accJe, {
      revDate: revDay, reason: cleanReason, user, refId: labor.id, label: 'لمستحقات الأجور'
    });
    if (rev) accrualReversed = 1;
  }

  let settlementsReversed = 0;
  const settlements = await getWageSettlementJournals(conn, labor.id);
  for (const s of settlements) {
    const rev = await postPayableReversalJE(conn, s, {
      revDate: revDay, reason: cleanReason, user, refId: labor.id, label: 'لمستحقات الأجور'
    });
    if (!rev) continue;
    await CashBoxService.appendMovement(conn, {
      projectId: labor.project_id ?? null, cashIn: rev.total,
      currency: 'ر.ي', date: revDay, notes: `عكس سداد مستحق أجور: ${s.entry_no}`
    });
    settlementsReversed++;
  }
  return { accrualReversed, settlementsReversed };
}

/**
 * تقرير التعرض غير المثبت للأجور: سجلات بمتبقي > 0 بلا قيد استحقاق مرحّل.
 * قراءة فقط — تُراجع يدوياً، لا ترحيل آلي هنا.
 */
async function reportUnbookedWages() {
  const rows = await query(`
    SELECT l.id, l.project_id, l.worker_name_or_team as worker_label, l.trade,
           l.total_amount, COALESCE(l.paid_amount, 0) as paid_amount,
           (l.total_amount - COALESCE(l.paid_amount, 0)) as outstanding, l.date
    FROM project_labor_expenses l
    WHERE (l.total_amount - COALESCE(l.paid_amount, 0)) > 0.005
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries j
        WHERE j.reference_id = l.id
          AND j.reference_type = '${WAGE_JE_TYPES.accrual}'
          AND LOWER(j.status) = 'posted'
      )
    ORDER BY l.date ASC, l.id ASC
  `);
  const total = (rows || []).reduce((sum, r) => sum + (Number(r.outstanding) || 0), 0);
  return { rows: rows || [], count: (rows || []).length, total };
}

module.exports = {
  COUNTED_EXPENSE_STATUSES,
  ensureSchema,
  getCostBreakdown,
  recalculateProjectCost,
  recalculateAllProjects,
  backfillMirrorLinks,
  deleteLinkedMirrors,
  linkSubRecordToExpense,
  unlinkSubRecord,
  clearLinksToExpense,
  detectPossibleDuplicates,
  createMirrorJournal,
  reverseLinkedMirrors,
  backfillMirrorJEs,
  AP_JE_TYPES,
  resolvePayableAccounts,
  createPayableJournal,
  createSettlementJournal,
  getPayableJournal,
  getSettlementJournals,
  reverseSitePurchasePayables,
  reportUnbookedPayables,
  WAGE_JE_TYPES,
  resolveWageAccounts,
  createWageAccrualJournal,
  createWageSettlementJournal,
  getWageAccrualJournal,
  getWageSettlementJournals,
  reverseSiteLaborPayables,
  reportUnbookedWages
};

/**
 * خدمة الصناديق النقدية المفصولة (Cash Boxes Service)
 * ============================================================================
 * SUGGESTION-4 (§12): فصل الصناديق المجمعة.
 * كل مشروع له سلسلة صندوق مستقلة (previous/current خاص به)، والحركات غير
 * المرتبطة بمشروع تبقى في الصندوق الرئيسي (project_id = NULL) — بما فيها
 * الأرصدة التاريخية التي لا يمكن تقسيمها بأثر رجعي.
 *
 * إجمالي النقدية = مجموع أرصدة الصناديق (آخر صف في كل سلسلة).
 */

const db = require('../database/db');

const { query, get, run, getActiveEngine } = db;

let schemaEnsured = false;

/**
 * التأكد من عمود التقسيم (idempotent). يُستدعى خارج المعاملات وعند الإقلاع.
 */
async function ensureSchema() {
  if (schemaEnsured) return true;
  const engine = typeof getActiveEngine === 'function' ? getActiveEngine() : 'sqlite';

  try {
    if (engine === 'mysql') {
      const cols = await query('SHOW COLUMNS FROM cash_movements');
      const names = (cols || []).map(c => c.Field || c.field || c.COLUMN_NAME);
      if (!names.includes('project_id')) {
        await run('ALTER TABLE cash_movements ADD COLUMN project_id INT NULL');
      }
      try {
        await run('CREATE INDEX idx_cash_box ON cash_movements (project_id, id)');
      } catch {}
    } else {
      const cols = await query('PRAGMA table_info(cash_movements)');
      const names = (cols || []).map(c => c.name);
      if (!names.includes('project_id')) {
        await run('ALTER TABLE cash_movements ADD COLUMN project_id INTEGER');
      }
      try {
        await run('CREATE INDEX IF NOT EXISTS idx_cash_box ON cash_movements (project_id, id)');
      } catch {}
    }
    schemaEnsured = true;
    return true;
  } catch (err) {
    console.warn('⚠️ [CashBox] تعذر التأكد من مخطط الصناديق:', err.message);
    throw err;
  }
}

/** الشرط المحمول للمطابقة مع NULL على المحركين (IFNULL مدعوم في SQLite وMySQL).
 *  الـ +0 يجبر المقارنة الرقمية (بدونه: INTEGER = TEXT تُرجع خطأً دائماً في SQLite). */
const BOX_MATCH = 'IFNULL(project_id, 0) + 0 = IFNULL(?, 0) + 0';

/**
 * إلحاق حركة نقدية بسلسلة صندوقها (داخل معاملة المتصل — لا DDL هنا).
 * الصندوق الفارغ يبدأ من الصفر (لا أرصدة مفترضة).
 */
async function appendMovement(conn, {
  projectId = null, cashIn = 0, cashOut = 0, withdrawals = 0,
  currency = 'ر.ي', date, notes = ''
} = {}) {
  // تطبيع المفتاح رقمياً (معاملات المسارات نصية — والعمود صحيح)
  const boxId = (projectId === null || projectId === undefined || projectId === '')
    ? null : Number(projectId);
  const last = await conn.get(
    `SELECT current_balance FROM cash_movements WHERE ${BOX_MATCH} ORDER BY id DESC LIMIT 1`,
    [boxId]
  );
  const prevBal = last ? (Number(last.current_balance) || 0) : 0;
  const newBal = prevBal + (Number(cashIn) || 0) - (Number(cashOut) || 0) - (Number(withdrawals) || 0);
  const res = await conn.run(`
    INSERT INTO cash_movements
      (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes, project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    prevBal,
    Number(cashIn) || 0, Number(cashOut) || 0, Number(withdrawals) || 0,
    newBal, currency || 'ر.ي', date, notes || '', boxId
  ]);
  return { id: res.lastInsertRowid || res.insertId, previous: prevBal, current: newBal };
}

/**
 * ملخص الصناديق: آخر رصيد لكل صندوق + المجاميع + الإجمالي.
 */
async function getBoxesSummary() {
  await ensureSchema();
  const boxes = await query(`
    SELECT m.project_id, p.code as project_code, p.name as project_name,
           m.current_balance, m.date as last_date
    FROM cash_movements m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.id IN (SELECT MAX(id) FROM cash_movements GROUP BY IFNULL(project_id, 0))
    ORDER BY m.project_id IS NULL DESC, m.project_id ASC
  `);
  const totals = await get(`
    SELECT COALESCE(SUM(cash_in), 0) as total_in,
           COALESCE(SUM(cash_out), 0) as total_out,
           COALESCE(SUM(withdrawals), 0) as total_withdrawals
    FROM cash_movements
  `);
  const first = await get('SELECT previous_balance FROM cash_movements ORDER BY id ASC LIMIT 1');
  const list = (boxes || []).map(b => ({
    project_id: b.project_id,
    project_code: b.project_code || null,
    project_name: b.project_name || (b.project_id ? 'مشروع محذوف' : 'الصندوق الرئيسي'),
    current_balance: Number(b.current_balance) || 0,
    last_date: b.last_date
  }));
  const totalCurrent = list.reduce((s, b) => s + b.current_balance, 0);
  return {
    boxes: list,
    initial_balance: first ? (Number(first.previous_balance) || 0) : 0,
    total_cash_in: Number(totals?.total_in) || 0,
    total_cash_out: Number(totals?.total_out) || 0,
    total_withdrawals: Number(totals?.total_withdrawals) || 0,
    current_balance: totalCurrent
  };
}

/** إجمالي النقدية عبر الصناديق (للوحة التحكم). */
async function getTotalBalance() {
  const summary = await getBoxesSummary();
  return summary.current_balance;
}

/** إجمالي النقدية عبر الصناديق بتاريخ محدد (شامل asOf أو قبل before — للتدفقات). */
async function getTotalBalanceAsOf({ asOf = null, before = null } = {}) {
  await ensureSchema();
  let cond = '';
  const params = [];
  if (asOf) { cond = 'WHERE m2.date <= ?'; params.push(asOf); }
  if (before) { cond = 'WHERE m2.date < ?'; params.push(before); }
  const rows = await query(`
    SELECT m.current_balance
    FROM cash_movements m
    WHERE m.id IN (SELECT MAX(m2.id) FROM cash_movements m2 ${cond} GROUP BY IFNULL(m2.project_id, 0))
  `, params);
  return (rows || []).reduce((s, r) => s + (Number(r.current_balance) || 0), 0);
}

module.exports = { ensureSchema, appendMovement, getBoxesSummary, getTotalBalance, getTotalBalanceAsOf };

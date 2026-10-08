/**
 * server/services/cashFlowReportService.js
 * 
 * خدمة تقرير التدفقات النقدية المعيارية القائمة كلياً على دفتر الأستاذ العام (General Ledger Cash Flow Engine)
 * - تحدد حسابات النقد والبنوك كركيزة أساسية
 * - تصنف الحركات النقدية بدقة إلى: تشغيلية (Operating)، استثمارية (Investing)، تمويلية (Financing)
 * - تعزل التحويلات الداخلية بين الصناديق والبنوك (Internal Transfers) بأثر صافي = 0
 * - تحسب الرصيد الافتتاحي من قيود اليومية السابقة للفترة
 * - تطابق الرصيد الختامي مع أرصدة الأستاذ العام وتكشف أي فروقات تسوية
 * - خالية تماماً من أي أرقام وهمية أو افتراضية مصطنعة (Zero Magic Numbers)
 */

const { query, get } = require('../database/db');

class CashFlowReportService {
  /**
   * جلب قائمة حسابات النقدية والبنوك النهائية (Leaf Cash & Bank Accounts)
   */
  async getCashAndBankAccounts() {
    return await query(`
      SELECT a.id, a.code, a.name, a.type
      FROM accounts a
      WHERE (a.code LIKE '121%' OR a.code LIKE '122%' OR a.name LIKE '%صندوق%' OR a.name LIKE '%بنك%' OR a.name LIKE '%نقد%')
        AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = a.id)
      ORDER BY a.code ASC
    `);
  }

  /**
   * إنشاء تقرير التدفقات النقدية المعياري لفترة محددة
   * @param {Object} params { from_date, to_date }
   */
  async generateCashFlowReport({ from_date, to_date }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    const cashAccounts = await this.getCashAndBankAccounts();
    const cashAccountIds = cashAccounts.map(a => a.id);

    if (cashAccountIds.length === 0) {
      return {
        period: { from_date: fromDate, to_date: toDate },
        opening_balance: 0,
        operating_activities: { inflows: [], outflows: [], net: 0 },
        investing_activities: { inflows: [], outflows: [], net: 0 },
        financing_activities: { inflows: [], outflows: [], net: 0 },
        internal_transfers: { total_transferred: 0, net_impact: 0 },
        net_cash_change: 0,
        closing_balance: 0,
        gl_reconciliation: {
          gl_cash_balance: 0,
          difference: 0,
          is_reconciled: true
        },
        warnings: ['لا توجد حسابات نقدية أو بنكية معرفة في دليل الحسابات']
      };
    }

    const cashPlaceholders = cashAccountIds.map(() => '?').join(',');

    // 1. حساب الرصيد الافتتاحي للنقدية والبنوك من قيود اليومية السابقة للفترة (Posted Entries Prior to from_date)
    const openRes = await get(`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS opening_balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.account_id IN (${cashPlaceholders})
        AND je.status = 'posted'
        AND je.date < ?
    `, [...cashAccountIds, fromDate]);

    const openingBalance = Math.round(Number(openRes?.opening_balance || 0) * 100) / 100;

    // 2. جلب جميع القيود المرحلة خلال الفترة التي تؤثر على حسابات النقدية والبنوك
    const cashEntries = await query(`
      SELECT DISTINCT je.id, je.entry_no, je.date, je.description, je.reference_type, je.reference_id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE jel.account_id IN (${cashPlaceholders})
        AND je.status = 'posted'
        AND je.date BETWEEN ? AND ?
      ORDER BY je.date ASC, je.id ASC
    `, [...cashAccountIds, fromDate, toDate]);

    // 3. خرائط التصنيف المعتمدة (cash_flow_account_mappings)
    const mappingsRows = await query('SELECT account_id, activity FROM cash_flow_account_mappings WHERE is_active = 1');
    const mappingMap = {};
    (mappingsRows || []).forEach(m => { mappingMap[m.account_id] = m.activity; });

    const operatingInflows = [];
    const operatingOutflows = [];
    const investingInflows = [];
    const investingOutflows = [];
    const financingInflows = [];
    const financingOutflows = [];
    let totalInternalTransfers = 0;

    // تجميع الحركات حسب الحساب المقابل والنشاط
    for (const entry of cashEntries) {
      const allLines = await query(`
        SELECT jel.*, a.code as account_code, a.name as account_name, a.type as account_type
        FROM journal_entry_lines jel
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.entry_id = ?
      `, [entry.id]);

      const cashLines = allLines.filter(l => cashAccountIds.includes(l.account_id));
      const nonCashLines = allLines.filter(l => !cashAccountIds.includes(l.account_id));

      // فحص هل القيد تحويل داخلي بحت بين الصناديق والبنوك (Internal Cash Transfer)
      if (nonCashLines.length === 0) {
        const transferAmt = cashLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
        totalInternalTransfers += transferAmt;
        continue; // أثر التحويل الداخلي الصافي على إجمالي نقدية الشركة = 0
      }

      // حساب صافي التغير في النقدية لهذا القيد (Net Cash In/Out)
      const entryCashDebit = cashLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const entryCashCredit = cashLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
      const netCashChangeInEntry = entryCashDebit - entryCashCredit;

      if (netCashChangeInEntry === 0) continue;

      // تصنيف الطرف المقابل
      for (const line of nonCashLines) {
        const lineWeight = (Number(line.debit) + Number(line.credit));
        const totalNonCashWeight = nonCashLines.reduce((s, l) => s + (Number(l.debit) + Number(l.credit)), 0) || 1;
        const allocatedCashAmount = Math.round(Math.abs(netCashChangeInEntry) * (lineWeight / totalNonCashWeight) * 100) / 100;

        let activity = mappingMap[line.account_id];
        if (!activity) {
          const code = String(line.account_code || '');
          const type = String(line.account_type || '');
          if (code.startsWith('111') || type === 'أصول ثابتة') {
            activity = 'investing';
          } else if (code.startsWith('22') || code.startsWith('212') || type === 'حقوق ملكية' || type === 'قروض') {
            activity = 'financing';
          } else {
            activity = 'operating';
          }
        }

        if (activity === 'excluded') continue;

        const itemDesc = `${line.account_name || 'حساب غير مسمى'} (${entry.description || entry.reference_type || 'قيد'})`;

        if (netCashChangeInEntry > 0) {
          // تدفق نقد داخل (Inflow)
          if (activity === 'investing') investingInflows.push({ item: itemDesc, amount: allocatedCashAmount, entry_no: entry.entry_no });
          else if (activity === 'financing') financingInflows.push({ item: itemDesc, amount: allocatedCashAmount, entry_no: entry.entry_no });
          else operatingInflows.push({ item: itemDesc, amount: allocatedCashAmount, entry_no: entry.entry_no });
        } else {
          // تدفق نقد خارج (Outflow)
          if (activity === 'investing') investingOutflows.push({ item: itemDesc, amount: allocatedCashAmount, entry_no: entry.entry_no });
          else if (activity === 'financing') financingOutflows.push({ item: itemDesc, amount: allocatedCashAmount, entry_no: entry.entry_no });
          else operatingOutflows.push({ item: itemDesc, amount: allocatedCashAmount, entry_no: entry.entry_no });
        }
      }
    }

    // تجميع البنود المتشابهة لتنظيم التقرير
    const aggregateItems = (items) => {
      const map = {};
      items.forEach(it => {
        const key = it.item.split(' (')[0];
        map[key] = (map[key] || 0) + it.amount;
      });
      return Object.keys(map).map(k => ({ item: k, amount: Math.round(map[k] * 100) / 100 }));
    };

    const aggOpIn = aggregateItems(operatingInflows);
    const aggOpOut = aggregateItems(operatingOutflows);
    const aggInvIn = aggregateItems(investingInflows);
    const aggInvOut = aggregateItems(investingOutflows);
    const aggFinIn = aggregateItems(financingInflows);
    const aggFinOut = aggregateItems(financingOutflows);

    const totalOpIn = aggOpIn.reduce((s, i) => s + i.amount, 0);
    const totalOpOut = aggOpOut.reduce((s, i) => s + i.amount, 0);
    const netOperating = Math.round((totalOpIn - totalOpOut) * 100) / 100;

    const totalInvIn = aggInvIn.reduce((s, i) => s + i.amount, 0);
    const totalInvOut = aggInvOut.reduce((s, i) => s + i.amount, 0);
    const netInvesting = Math.round((totalInvIn - totalInvOut) * 100) / 100;

    const totalFinIn = aggFinIn.reduce((s, i) => s + i.amount, 0);
    const totalFinOut = aggFinOut.reduce((s, i) => s + i.amount, 0);
    const netFinancing = Math.round((totalFinIn - totalFinOut) * 100) / 100;

    const netCashChange = Math.round((netOperating + netInvesting + netFinancing) * 100) / 100;
    const closingBalance = Math.round((openingBalance + netCashChange) * 100) / 100;

    // 4. المطابقة الرقابية مع رصيد الأستاذ العام الفعلي حتى تاريخ النهاية
    const glCloseRes = await get(`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS gl_cash_balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.account_id IN (${cashPlaceholders})
        AND je.status = 'posted'
        AND je.date <= ?
    `, [...cashAccountIds, toDate]);

    const actualGlCashBalance = Math.round(Number(glCloseRes?.gl_cash_balance || 0) * 100) / 100;
    const reconciliationDiff = Math.round(Math.abs(closingBalance - actualGlCashBalance) * 100) / 100;

    return {
      period: { from_date: fromDate, to_date: toDate },
      opening_balance: openingBalance,
      operating_activities: {
        inflows: aggOpIn,
        outflows: aggOpOut,
        total_inflow: totalOpIn,
        total_outflow: totalOpOut,
        net: netOperating
      },
      investing_activities: {
        inflows: aggInvIn,
        outflows: aggInvOut,
        total_inflow: totalInvIn,
        total_outflow: totalInvOut,
        net: netInvesting
      },
      financing_activities: {
        inflows: aggFinIn,
        outflows: aggFinOut,
        total_inflow: totalFinIn,
        total_outflow: totalFinOut,
        net: netFinancing
      },
      internal_transfers: {
        total_transferred: Math.round(totalInternalTransfers * 100) / 100,
        net_impact: 0,
        description: 'تحويلات داخلية نقدية بين الصناديق والبنوك (أثر السيولة = 0)'
      },
      net_cash_change: netCashChange,
      closing_balance: closingBalance,
      gl_reconciliation: {
        calculated_closing: closingBalance,
        gl_cash_balance: actualGlCashBalance,
        difference: reconciliationDiff,
        is_reconciled: reconciliationDiff < 0.01
      }
    };
  }
}

module.exports = new CashFlowReportService();

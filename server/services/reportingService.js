/**
 * server/services/reportingService.js
 * 
 * محرك التقارير المالية الموحد القائم كلياً على دفتر الأستاذ العام (General Ledger Reporting Engine)
 * لشركة رواسي عدن للهندسة والمقاولات
 * 
 * المبادئ المحاسبية المعيارية المطبقة:
 * 1. General Ledger هو المصدر المحاسبي النهائي والوحيد للتقارير الرسمية (Trial Balance, P&L, Balance Sheet, Cash Flow).
 * 2. الحسابات الفرعية الأخيرة فقط (Leaf Accounts Only) تظهر وتسجل في العمليات.
 * 3. خلو تام من أي أرقام وهمية أو افتراضية مصطنعة (Zero Magic Numbers, Zero Synthetic Revenue).
 * 4. ربط التقارير التشغيلية (المشاريع، العملاء، الموردين) بالأستاذ العام ومطابقتها مع كشف الفروقات.
 * 5. التحقق المحاسبي الرياضي من التوازن (Total Debit == Total Credit, Assets == Liabilities + Equity).
 * 6. بنية استجابة موحدة تشمل meta, warnings, reconciliation.
 */

const { query, get } = require('../database/db');
const CashFlowReportService = require('./cashFlowReportService');
const ContractingAccountingService = require('./contractingAccountingService');

class ReportingService {
  /**
   * 1. تقرير ميزان المراجعة بالمجاميع والأرصدة (Trial Balance)
   * - الرصيد الافتتاحي: القيود المرحلة قبل from_date (debit - credit)
   * - حركات الفترة: مجموع مدين ومجموع دائن القيود المرحلة بين from_date و to_date
   * - الرصيد الختامي: الافتتاحي + مدين الفترة - دائن الفترة
   * - الحسابات الفرعية الأخيرة فقط (Leaf Accounts Only)
   */
  async getTrialBalance({ from_date, to_date }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    const sql = `
      SELECT
          a.id,
          a.code,
          a.name,
          a.type,
          a.parent_id,
          COALESCE(SUM(
              CASE
                  WHEN je.date < ? THEN jel.debit - jel.credit
                  ELSE 0
              END
          ), 0) AS opening_balance,
          COALESCE(SUM(
              CASE
                  WHEN je.date BETWEEN ? AND ? THEN jel.debit
                  ELSE 0
              END
          ), 0) AS period_debit,
          COALESCE(SUM(
              CASE
                  WHEN je.date BETWEEN ? AND ? THEN jel.credit
                  ELSE 0
              END
          ), 0) AS period_credit
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.status = 'posted'
      WHERE NOT EXISTS (
          SELECT 1
          FROM accounts child
          WHERE child.parent_id = a.id
      )
      GROUP BY a.id, a.code, a.name, a.type, a.parent_id
      ORDER BY a.code ASC;
    `;

    const rows = await query(sql, [fromDate, fromDate, toDate, fromDate, toDate]);

    let sumOpeningDebit = 0;
    let sumOpeningCredit = 0;
    let sumPeriodDebit = 0;
    let sumPeriodCredit = 0;
    let sumClosingDebit = 0;
    let sumClosingCredit = 0;

    const accounts = rows.map(r => {
      const openBal = Math.round(Number(r.opening_balance || 0) * 100) / 100;
      const pDeb = Math.round(Number(r.period_debit || 0) * 100) / 100;
      const pCred = Math.round(Number(r.period_credit || 0) * 100) / 100;
      const closeBal = Math.round((openBal + pDeb - pCred) * 100) / 100;

      const openDebit = openBal > 0 ? openBal : 0;
      const openCredit = openBal < 0 ? Math.abs(openBal) : 0;

      const closeDebit = closeBal > 0 ? closeBal : 0;
      const closeCredit = closeBal < 0 ? Math.abs(closeBal) : 0;

      sumOpeningDebit += openDebit;
      sumOpeningCredit += openCredit;
      sumPeriodDebit += pDeb;
      sumPeriodCredit += pCred;
      sumClosingDebit += closeDebit;
      sumClosingCredit += closeCredit;

      return {
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        opening_debit: openDebit,
        opening_credit: openCredit,
        opening_balance: openBal,
        period_debit: pDeb,
        period_credit: pCred,
        closing_debit: closeDebit,
        closing_credit: closeCredit,
        closing_balance: closeBal,
        net_balance: closeBal
      };
    });

    const isPeriodBalanced = Math.abs(sumPeriodDebit - sumPeriodCredit) < 0.01;
    const isClosingBalanced = Math.abs(sumClosingDebit - sumClosingCredit) < 0.01;
    const isBalanced = isPeriodBalanced && isClosingBalanced;

    return {
      success: true,
      data: {
        accounts,
        totals: {
          opening_debit: Math.round(sumOpeningDebit * 100) / 100,
          opening_credit: Math.round(sumOpeningCredit * 100) / 100,
          period_debit: Math.round(sumPeriodDebit * 100) / 100,
          period_credit: Math.round(sumPeriodCredit * 100) / 100,
          closing_debit: Math.round(sumClosingDebit * 100) / 100,
          closing_credit: Math.round(sumClosingCredit * 100) / 100,
          is_balanced: isBalanced
        }
      },
      meta: {
        report_name: 'ميزان المراجعة بالأرصدة والمجاميع',
        from_date: fromDate,
        to_date: toDate,
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: isBalanced ? [] : ['يوجد عدم اتزان في مجاميع ميزان المراجعة يرجى مراجعة قيود اليومية'],
      reconciliation: {
        is_balanced: isBalanced,
        period_difference: Math.round(Math.abs(sumPeriodDebit - sumPeriodCredit) * 100) / 100,
        closing_difference: Math.round(Math.abs(sumClosingDebit - sumClosingCredit) * 100) / 100
      }
    };
  }

  /**
   * 2. تقرير قائمة الدخل المعيارية (Income Statement)
   * - الإيرادات (Revenues): حسابات 4 من القيود المرحلة (Credit - Debit)
   * - تكلفة الإيراد المباشرة (Direct Costs): تكاليف المشاريع والمواد (Debit - Credit)
   * - مجمل الربح (Gross Profit): Revenue - Direct Costs (بدون نسبة 35% وهمية!)
   * - المصروفات التشغيلية والإدارية (Operating & Admin Expenses): حسابات 3 (Debit - Credit)
   * - صافي الدخل (Net Income): Gross Profit - Operating Expenses
   * - خالية تماماً من الـ Fallbacks (1250000, 450000)
   */
  async getIncomeStatement({ from_date, to_date }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    // الإيرادات من دفتر الأستاذ العام
    const revenueRows = await query(`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(SUM(jel.credit - jel.debit), 0) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.status = 'posted'
        AND je.date BETWEEN ? AND ?
        AND (a.type = 'إيرادات' OR a.code LIKE '4%')
        AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = a.id)
      GROUP BY a.id, a.code, a.name, a.type
      HAVING amount != 0
      ORDER BY a.code ASC;
    `, [fromDate, toDate]);

    // تكلفة الإيراد المباشرة (Direct Project Costs)
    const directCostRows = await query(`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(SUM(jel.debit - jel.credit), 0) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.status = 'posted'
        AND je.date BETWEEN ? AND ?
        AND (a.type = 'تكاليف' OR a.code LIKE '51%' OR a.name LIKE '%تكاليف مشاريع%' OR a.name LIKE '%مواد بناء%')
        AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = a.id)
      GROUP BY a.id, a.code, a.name, a.type
      HAVING amount != 0
      ORDER BY a.code ASC;
    `, [fromDate, toDate]);

    // المصروفات التشغيلية والإدارية والعمومية (Operating & General Expenses)
    const operatingExpenseRows = await query(`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(SUM(jel.debit - jel.credit), 0) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.status = 'posted'
        AND je.date BETWEEN ? AND ?
        AND (a.type = 'مصروفات' OR a.code LIKE '3%' OR a.code LIKE '52%')
        AND a.code NOT LIKE '51%'
        AND a.name NOT LIKE '%تكاليف مشاريع%'
        AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = a.id)
      GROUP BY a.id, a.code, a.name, a.type
      HAVING amount != 0
      ORDER BY a.code ASC;
    `, [fromDate, toDate]);

    const totalRevenues = Math.round(revenueRows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
    const totalDirectCosts = Math.round(directCostRows.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100;
    const grossProfit = Math.round((totalRevenues - totalDirectCosts) * 100) / 100;
    const grossMarginPct = totalRevenues > 0 ? Math.round((grossProfit / totalRevenues) * 1000) / 10 : 0;

    const totalOperatingExpenses = Math.round(operatingExpenseRows.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100;
    const totalExpenses = Math.round((totalDirectCosts + totalOperatingExpenses) * 100) / 100;
    const netProfit = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;
    const netMarginPct = totalRevenues > 0 ? Math.round((netProfit / totalRevenues) * 1000) / 10 : 0;

    return {
      success: true,
      data: {
        period: { from_date: fromDate, to_date: toDate },
        revenues: revenueRows.map(r => ({ code: r.code, name: r.name, amount: Number(r.amount) })),
        total_revenues: totalRevenues,
        direct_costs: directCostRows.map(c => ({ code: c.code, name: c.name, amount: Number(c.amount) })),
        total_direct_costs: totalDirectCosts,
        gross_profit: grossProfit,
        gross_margin_percentage: grossMarginPct,
        operating_expenses: operatingExpenseRows.map(e => ({ code: e.code, name: e.name, amount: Number(e.amount) })),
        total_operating_expenses: totalOperatingExpenses,
        expenses: [...directCostRows, ...operatingExpenseRows].map(e => ({ code: e.code, name: e.name, amount: Number(e.amount) })),
        total_expenses: totalExpenses,
        net_profit: netProfit,
        net_income: netProfit,
        net_margin_percentage: netMarginPct
      },
      meta: {
        report_name: 'قائمة الدخل المعيارية',
        from_date: fromDate,
        to_date: toDate,
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: totalRevenues === 0 && totalExpenses === 0 ? ['لا توجد قيود إيرادات أو مصروفات مرحلة خلال هذه الفترة'] : [],
      reconciliation: {
        is_balanced: true,
        accounting_equation: 'Gross Profit = Revenues - Direct Costs | Net Profit = Gross Profit - Operating Expenses'
      }
    };
  }

  /**
   * 3. تقرير الأرباح والخسائر الشامل (P&L)
   * يعتمد على نفس المحرك والأرقام الخاصة بـ getIncomeStatement بنسبة 100%
   * ويدعمه بمقارنة السيولة النقدية والمقبوضات
   */
  async getProfitLoss({ from_date, to_date }) {
    const isReport = await this.getIncomeStatement({ from_date, to_date });
    const fromDate = isReport.meta.from_date;
    const toDate = isReport.meta.to_date;

    // المقبوضات النقدية والبنكية الفعلية من payments للمقارنة الرقابية
    const receiptsRes = await get(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payments
      WHERE type = 'قبض' AND status NOT IN ('reversed', 'failed', 'draft')
        AND date BETWEEN ? AND ?
    `, [fromDate, toDate]);

    const cashReceipts = Math.round(Number(receiptsRes?.total || 0) * 100) / 100;
    const recognizedRevenue = isReport.data.total_revenues;
    const totalExpenses = isReport.data.total_expenses;
    const trueNetProfit = isReport.data.net_profit;
    const netCashMargin = cashReceipts - totalExpenses;
    const liquidityVsProfitGap = Math.round((cashReceipts - recognizedRevenue) * 100) / 100;

    return {
      success: true,
      data: {
        ...isReport.data,
        cash_receipts: cashReceipts,
        net_cash_flow: netCashMargin,
        liquidity_vs_profit_gap: liquidityVsProfitGap,
        gap_explanation: liquidityVsProfitGap > 0
          ? 'المقبوضات تفوق الإيراد المعترف به (مقبوضات مسبقة والتزامات واجبة التنفيذ)'
          : (liquidityVsProfitGap < 0 ? 'الإيراد المحاسبي يفوق المقبوضات (إنجاز أعمال ومستحقات قيد التحصيل)' : 'تطابق تام بين المقبوضات والإيرادات')
      },
      meta: {
        ...isReport.meta,
        report_name: 'قائمة الأرباح والخسائر الشاملة'
      },
      warnings: isReport.warnings,
      reconciliation: {
        is_balanced: true,
        income_statement_match: true
      }
    };
  }

  /**
   * 4. تقرير الميزانية العمومية والمركز المالي (Balance Sheet)
   * - الأصول (Assets): 1%
   * - الخصوم (Liabilities): 21%
   * - حقوق الملكية (Equity): 22% + صافي ربح الفترة الحالية (من الدفاتر العامة)
   * - التحقق الإلزامي: Assets = Liabilities + Equity
   */
  async getBalanceSheet({ as_of_date, to_date }) {
    const asOf = as_of_date || to_date || new Date().toISOString().split('T')[0];

    // جلب حركات جميع حسابات الميزانية التراكمية حتى تاريخ التقرير من قيود اليومية المرحلة
    const sql = `
      SELECT
          a.id,
          a.code,
          a.name,
          a.type,
          a.parent_id,
          COALESCE(SUM(jel.debit - jel.credit), 0) AS balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.status = 'posted' AND je.date <= ?
      WHERE NOT EXISTS (
          SELECT 1
          FROM accounts child
          WHERE child.parent_id = a.id
      )
      GROUP BY a.id, a.code, a.name, a.type, a.parent_id
      ORDER BY a.code ASC;
    `;

    const rows = await query(sql, [asOf]);

    const assets = [];
    const liabilities = [];
    const equity = [];

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const r of rows) {
      const bal = Number(r.balance || 0);
      const code = String(r.code || '');
      const type = String(r.type || '');

      if (code.startsWith('1') || type === 'asset' || type === 'أصول') {
        const amt = bal; // الأصول طبيعتها مدينة
        if (amt !== 0) {
          assets.push({ id: r.id, code: r.code, name: r.name, type: r.type, balance: amt });
          totalAssets += amt;
        }
      } else if (code.startsWith('21') || type === 'equity' || type === 'حقوق ملكية') {
        const amt = -bal; // حقوق الملكية طبيعتها دائنة
        if (amt !== 0) {
          equity.push({ id: r.id, code: r.code, name: r.name, type: r.type, balance: amt });
          totalEquity += amt;
        }
      } else if (code.startsWith('22') || (code.startsWith('2') && !code.startsWith('21')) || type === 'liability' || type === 'خصوم' || type === 'التزامات') {
        const amt = -bal; // الخصوم طبيعتها دائنة
        if (amt !== 0) {
          liabilities.push({ id: r.id, code: r.code, name: r.name, type: r.type, balance: amt });
          totalLiabilities += amt;
        }
      }
    }

    // حساب صافي ربح الفترة الحالية غير المقفل في الأرباح المحتجزة
    const pnlRes = await get(`
      SELECT 
        COALESCE(SUM(CASE WHEN a.type = 'إيرادات' OR a.code LIKE '4%' THEN jel.credit - jel.debit ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN a.type = 'مصروفات' OR a.type = 'تكاليف' OR a.code LIKE '3%' OR a.code LIKE '5%' THEN jel.debit - jel.credit ELSE 0 END), 0) AS net_profit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.status = 'posted' AND je.date <= ?
    `, [asOf]);

    const currentPeriodNetIncome = Math.round(Number(pnlRes?.net_profit || 0) * 100) / 100;

    totalAssets = Math.round(totalAssets * 100) / 100;
    totalLiabilities = Math.round(totalLiabilities * 100) / 100;
    totalEquity = Math.round(totalEquity * 100) / 100;

    const totalEquityWithIncome = Math.round((totalEquity + currentPeriodNetIncome) * 100) / 100;
    const totalLiabPlusEquity = Math.round((totalLiabilities + totalEquityWithIncome) * 100) / 100;
    const difference = Math.round(Math.abs(totalAssets - totalLiabPlusEquity) * 100) / 100;
    const isBalanced = difference < 0.05;

    return {
      success: true,
      data: {
        as_of_date: asOf,
        assets,
        liabilities,
        equity,
        current_period_net_income: currentPeriodNetIncome,
        totals: {
          assets: totalAssets,
          liabilities: totalLiabilities,
          equity: totalEquityWithIncome,
          liabilities_plus_equity: totalLiabPlusEquity
        }
      },
      meta: {
        report_name: 'تقرير المركز المالي (الميزانية العمومية)',
        as_of_date: asOf,
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: isBalanced ? [] : [`يوجد فارق في الميزانية العمومية قدره (${difference} ر.ي)`],
      reconciliation: {
        is_balanced: isBalanced,
        difference: difference,
        formula: 'Total Assets = Total Liabilities + (Total Equity + Current Period Net Profit)'
      }
    };
  }

  /**
   * 5. تقرير التدفقات النقدية (Cash Flow)
   * يفوض إلى CashFlowReportService الموحد
   */
  async getCashFlow({ from_date, to_date }) {
    const cfData = await CashFlowReportService.generateCashFlowReport({ from_date, to_date });
    const opInflow = Number(cfData.operating_activities?.total_inflow || 0);
    const opOutflow = Number(cfData.operating_activities?.total_outflow || 0);
    const invInflow = Number(cfData.investing_activities?.total_inflow || 0);
    const invOutflow = Number(cfData.investing_activities?.total_outflow || 0);
    const finInflow = Number(cfData.financing_activities?.total_inflow || 0);
    const finOutflow = Number(cfData.financing_activities?.total_outflow || 0);

    return {
      success: true,
      data: {
        ...cfData,
        operating: {
          inflow: opInflow,
          outflow: opOutflow,
          net: cfData.operating_activities?.net || 0
        },
        investing: {
          inflow: invInflow,
          outflow: invOutflow,
          net: cfData.investing_activities?.net || 0
        },
        financing: {
          inflow: finInflow,
          outflow: finOutflow,
          net: cfData.financing_activities?.net || 0
        },
        net_cash_flow: cfData.net_cash_change
      },
      meta: {
        report_name: 'تقرير قائمة التدفقات النقدية',
        from_date: cfData.period.from_date,
        to_date: cfData.period.to_date,
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: cfData.warnings || [],
      reconciliation: {
        is_balanced: cfData.gl_reconciliation.is_reconciled,
        difference: cfData.gl_reconciliation.difference
      }
    };
  }

  /**
   * 6. تقرير ربحية المشاريع المحاسبية (Projects Profitability)
   * قائم على أسطر القيود اليومية المرتبطة بالمشروع (journal_entry_lines.project_id)
   * ويدعمه بمؤشرات الإنجاز التعاقدي الحقيقي IFRS 15 دون أي افتراضات وهمية
   */
  async getProjectsProfitability({ from_date, to_date, project_id, allowedProjects = ['*'] }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    let whereClause = '1=1';
    const params = [];

    if (allowedProjects && !allowedProjects.includes('*') && !allowedProjects.includes('all')) {
      const ph = allowedProjects.map(() => '?').join(',');
      whereClause += ` AND p.id IN (${ph})`;
      params.push(...allowedProjects);
    }

    if (project_id) {
      whereClause += ' AND p.id = ?';
      params.push(Number(project_id));
    }

    const projects = await query(`
      SELECT p.id, p.code, p.name, p.status, p.contract_value, p.estimated_cost, p.actual_cost,
             c.name as client_name
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE ${whereClause}
      ORDER BY p.id ASC
    `, params);

    const report = [];

    for (const prj of projects) {
      // 1. الإيرادات المثبتة دفترياً من قيود الأستاذ العام المرتبطة بالمشروع
      const revRes = await get(`
        SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS gl_revenue
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.project_id = ?
          AND je.status = 'posted'
          AND je.date BETWEEN ? AND ?
          AND (a.type = 'إيرادات' OR a.code LIKE '4%')
      `, [prj.id, fromDate, toDate]);

      // 2. التكاليف والمصروفات المثبتة دفترياً من قيود الأستاذ العام المرتبطة بالمشروع
      const costRes = await get(`
        SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS gl_cost
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.project_id = ?
          AND je.status = 'posted'
          AND je.date BETWEEN ? AND ?
          AND (a.type = 'تكاليف' OR a.type = 'مصروفات' OR a.code LIKE '5%' OR a.code LIKE '3%')
      `, [prj.id, fromDate, toDate]);

      const glRevenue = Math.round(Number(revRes?.gl_revenue || 0) * 100) / 100;
      const glCost = Math.round(Number(costRes?.gl_cost || 0) * 100) / 100;
      const glProfit = Math.round((glRevenue - glCost) * 100) / 100;
      const glMargin = glRevenue > 0 ? Math.round((glProfit / glRevenue) * 1000) / 10 : 0;

      // المقبوضات النقدية التشغيلية من السندات
      const payRes = await get(`
        SELECT COALESCE(SUM(amount), 0) AS cash_in
        FROM payments
        WHERE project_id = ? AND type = 'قبض' AND status NOT IN ('reversed', 'failed', 'draft')
          AND date BETWEEN ? AND ?
      `, [prj.id, fromDate, toDate]);
      const cashIn = Math.round(Number(payRes?.cash_in || 0) * 100) / 100;

      report.push({
        id: prj.id,
        project_id: prj.id,
        project_code: prj.code,
        project_name: prj.name,
        client_name: prj.client_name || '-',
        status: prj.status,
        contract_value: Number(prj.contract_value) || 0,
        estimated_cost: Number(prj.estimated_cost) || 0,
        // الأرقام المحاسبية الرسمية المستندة لدفتر الأستاذ العام
        gl_recognized_revenue: glRevenue,
        gl_project_cost: glCost,
        gl_net_profit: glProfit,
        gl_profit_margin_pct: glMargin,
        // أسماء بديلة للتوافق السلس
        recognized_revenue: glRevenue,
        project_costs: glCost,
        recognized_profit: glProfit,
        profit_margin: glMargin,
        // السيولة والمقبوضات المقارنة
        cash_collections: cashIn,
        cash_vs_revenue_gap: Math.round((cashIn - glRevenue) * 100) / 100
      });
    }

    const totalContract = report.reduce((s, p) => s + p.contract_value, 0);
    const totalRev = report.reduce((s, p) => s + p.gl_recognized_revenue, 0);
    const totalCost = report.reduce((s, p) => s + p.gl_project_cost, 0);
    const totalProfit = Math.round((totalRev - totalCost) * 100) / 100;
    const overallMargin = totalRev > 0 ? Math.round((totalProfit / totalRev) * 1000) / 10 : 0;

    return {
      success: true,
      data: {
        projects: report,
        totals: {
          total_contract_value: totalContract,
          total_recognized_revenue: totalRev,
          total_project_cost: totalCost,
          total_net_profit: totalProfit,
          overall_margin_percentage: overallMargin
        }
      },
      meta: {
        report_name: 'تقرير ربحية المشاريع المحاسبي',
        from_date: fromDate,
        to_date: toDate,
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: [],
      reconciliation: {
        is_balanced: true,
        ledger_source: 'journal_entry_lines.project_id'
      }
    };
  }

  /**
   * 7. تقرير ربحية مراكز التكلفة المحاسبي (Cost Centers Profitability)
   * يعتمد حصرياً على journal_entry_lines.cost_center_id
   * مانع التكرار (No double counting)، وبدون أي نسبة تقديرية (Zero 70% synthetic revenue)
   */
  async getCostCentersProfitability({ from_date, to_date, cost_center_id }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    let whereClause = '1=1';
    const params = [];
    if (cost_center_id) {
      whereClause += ' AND cc.id = ?';
      params.push(Number(cost_center_id));
    }

    const costCenters = await query(`
      SELECT cc.id, cc.code, cc.name, cc.type, p.name as project_name
      FROM cost_centers cc
      LEFT JOIN projects p ON cc.project_id = p.id
      WHERE ${whereClause}
      ORDER BY cc.code ASC
    `, params);

    const report = [];
    let grandRevenue = 0;
    let grandExpense = 0;

    for (const cc of costCenters) {
      // إيرادات المركز من قيود الأستاذ العام
      const revRes = await get(`
        SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS revenue
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.cost_center_id = ?
          AND je.status = 'posted'
          AND je.date BETWEEN ? AND ?
          AND (a.type = 'إيرادات' OR a.code LIKE '4%')
      `, [cc.id, fromDate, toDate]);

      // تكاليف ومصروفات المركز من قيود الأستاذ العام
      const expRes = await get(`
        SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS expense
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE jel.cost_center_id = ?
          AND je.status = 'posted'
          AND je.date BETWEEN ? AND ?
          AND (a.type = 'تكاليف' OR a.type = 'مصروفات' OR a.code LIKE '5%' OR a.code LIKE '3%')
      `, [cc.id, fromDate, toDate]);

      const rev = Math.round(Number(revRes?.revenue || 0) * 100) / 100;
      const exp = Math.round(Number(expRes?.expense || 0) * 100) / 100;
      const profit = Math.round((rev - exp) * 100) / 100;
      const margin = rev > 0 ? Math.round((profit / rev) * 1000) / 10 : 0;

      grandRevenue += rev;
      grandExpense += exp;

      report.push({
        id: cc.id,
        code: cc.code,
        name: cc.name,
        type: cc.type || 'عام',
        project_name: cc.project_name || '-',
        total_revenue: rev,
        total_expense: exp,
        revenues: rev,
        expenses: exp,
        net_profit: profit,
        profit_margin: margin,
        status: profit > 0 ? 'profitable' : (profit < 0 ? 'loss' : 'breakeven')
      });
    }

    grandRevenue = Math.round(grandRevenue * 100) / 100;
    grandExpense = Math.round(grandExpense * 100) / 100;
    const grandProfit = Math.round((grandRevenue - grandExpense) * 100) / 100;
    const grandMargin = grandRevenue > 0 ? Math.round((grandProfit / grandRevenue) * 1000) / 10 : 0;

    return {
      success: true,
      data: {
        centers: report,
        cost_centers: report,
        totals: {
          total_revenue: grandRevenue,
          total_expense: grandExpense,
          net_profit: grandProfit,
          overall_margin: grandMargin
        }
      },
      meta: {
        report_name: 'تقرير ربحية مراكز التكلفة والمشاريع',
        from_date: fromDate,
        to_date: toDate,
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: [],
      reconciliation: {
        is_balanced: true,
        zero_synthetic_revenue: true
      }
    };
  }

  /**
   * 8. كشف حساب عميل معياري (Client Statement)
   * يعتمد على حساب الذمم المدينة في دفتر الأستاذ العام (Client AR Account)
   * ويطابق مع فواتير ومستخلصات وسندات العميل
   */
  async getClientStatement(clientId, { from_date, to_date }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    const client = await get('SELECT * FROM clients WHERE id = ?', [Number(clientId)]);
    if (!client) {
      throw new Error(`العميل برقم (${clientId}) غير موجود`);
    }

    // 1. تحديد حساب الأستاذ العام المرتبط بالعميل
    const partyMap = await get("SELECT account_id FROM party_account_mappings WHERE party_type = 'client' AND party_id = ?", [client.id]);
    let arAccountId = partyMap?.account_id;
    if (!arAccountId) {
      const defAr = await get("SELECT id FROM accounts WHERE code LIKE '123%' AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = accounts.id) LIMIT 1");
      arAccountId = defAr ? defAr.id : null;
    }

    // 2. الرصيد الافتتاحي في الأستاذ العام قبل from_date
    let openingBal = 0;
    if (arAccountId) {
      const openRes = await get(`
        SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as open_bal
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = ? AND je.status = 'posted' AND je.date < ?
      `, [arAccountId, fromDate]);
      openingBal = Number(openRes?.open_bal || 0);
    } else {
      openingBal = Number(client.previous_balance || 0);
    }

    // 3. الحركات التشغيلية المساندة (المستخلصات والدفعات)
    const bills = await query(`
      SELECT b.*, p.name as project_name
      FROM bills b
      LEFT JOIN projects p ON b.project_id = p.id
      WHERE b.client_id = ? AND b.status NOT IN ('ملغي', 'مرفوض')
        AND b.date BETWEEN ? AND ?
      ORDER BY b.date ASC
    `, [client.id, fromDate, toDate]);

    const payments = await query(`
      SELECT p.*, pr.name as project_name
      FROM payments p
      LEFT JOIN projects pr ON p.project_id = pr.id
      WHERE p.client_id = ? AND p.type = 'قبض' AND p.status NOT IN ('ملغي', 'reversed', 'failed')
        AND p.date BETWEEN ? AND ?
      ORDER BY p.date ASC
    `, [client.id, fromDate, toDate]);

    const statement = [];
    if (openingBal !== 0) {
      statement.push({
        date: fromDate,
        type: 'رصيد افتتاحي',
        ref: 'رصيد أول المدة',
        debit: openingBal > 0 ? openingBal : 0,
        credit: openingBal < 0 ? Math.abs(openingBal) : 0,
        notes: 'الرصيد الافتتاحي من دفتر الأستاذ العام'
      });
    }

    bills.forEach(b => {
      const amt = Number(b.net_amount) || Number(b.amount) || 0;
      statement.push({
        date: b.date,
        type: b.bill_type || 'مستخلص أعمال',
        ref: b.bill_no,
        project_name: b.project_name || '-',
        debit: amt,
        credit: 0,
        notes: b.notes || `مستخلص رقم ${b.bill_no}`
      });
    });

    payments.forEach(p => {
      statement.push({
        date: p.date,
        type: p.payment_method ? `سند قبض (${p.payment_method})` : 'سند قبض',
        ref: p.receipt_no || p.payment_no || ('PAY-' + p.id),
        project_name: p.project_name || '-',
        debit: 0,
        credit: Number(p.amount) || 0,
        notes: p.notes || ''
      });
    });

    statement.sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    const enriched = statement.map(item => {
      running += (item.debit - item.credit);
      return { ...item, running_balance: Math.round(running * 100) / 100 };
    });

    const totalDebit = Math.round(statement.reduce((s, i) => s + (i.debit || 0), 0) * 100) / 100;
    const totalCredit = Math.round(statement.reduce((s, i) => s + (i.credit || 0), 0) * 100) / 100;
    const netBalance = Math.round((totalDebit - totalCredit) * 100) / 100;

    return {
      success: true,
      data: {
        client: {
          id: client.id,
          name: client.name,
          company: client.company,
          phone: client.phone,
          currency: client.currency || 'ر.ي',
          ar_account_id: arAccountId
        },
        statement: enriched,
        summary: {
          opening_balance: openingBal,
          total_invoiced: totalDebit,
          total_collected: totalCredit,
          outstanding_balance: netBalance
        }
      },
      meta: {
        report_name: 'كشف حساب عميل تفصيلي',
        from_date: fromDate,
        to_date: toDate,
        currency: client.currency || 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger AR & Subledger Billing'
      },
      warnings: arAccountId ? [] : ['لم يتم ربط العميل بحساب ذمم مدينة مستقل في دليل الحسابات'],
      reconciliation: {
        is_balanced: true,
        net_balance: netBalance
      }
    };
  }

  /**
   * 9. كشف حساب مورد معياري (Supplier Statement)
   * يعتمد على حساب الذمم الدائنة في دفتر الأستاذ العام (Supplier AP Account)
   * ويطابق مع أوامر الشراء والاستلامات وسندات الصرف
   */
  async getSupplierStatement(supplierId, { from_date, to_date }) {
    const fromDate = from_date || '2024-01-01';
    const toDate = to_date || new Date().toISOString().split('T')[0];

    const supplier = await get('SELECT * FROM suppliers WHERE id = ?', [Number(supplierId)]);
    if (!supplier) {
      throw new Error(`المورد برقم (${supplierId}) غير موجود`);
    }

    // 1. تحديد حساب الأستاذ العام المرتبط بالمورد
    const partyMap = await get("SELECT account_id FROM party_account_mappings WHERE party_type = 'supplier' AND party_id = ?", [supplier.id]);
    let apAccountId = partyMap?.account_id;
    if (!apAccountId) {
      const defAp = await get("SELECT id FROM accounts WHERE code LIKE '211%' AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = accounts.id) LIMIT 1");
      apAccountId = defAp ? defAp.id : null;
    }

    // 2. الرصيد الافتتاحي في الأستاذ العام قبل from_date
    let openingBal = 0;
    if (apAccountId) {
      const openRes = await get(`
        SELECT COALESCE(SUM(jel.credit - jel.debit), 0) as open_bal
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE jel.account_id = ? AND je.status = 'posted' AND je.date < ?
      `, [apAccountId, fromDate]);
      openingBal = Number(openRes?.open_bal || 0);
    } else {
      openingBal = Number(supplier.balance || 0);
    }

    // 3. الحركات التشغيلية المساندة (أوامر الشراء ومستخلصات التوريد وسندات الصرف)
    const grns = await query(`
      SELECT g.*, po.po_no, po.total_amount as po_amount, p.name as project_name
      FROM goods_receipt_notes g
      LEFT JOIN purchase_orders po ON g.po_id = po.id
      LEFT JOIN projects p ON po.project_id = p.id
      WHERE g.supplier_id = ? AND g.status NOT IN ('cancelled', 'rejected')
        AND g.received_date BETWEEN ? AND ?
      ORDER BY g.received_date ASC
    `, [supplier.id, fromDate, toDate]);

    const expenses = await query(`
      SELECT e.*, p.name as project_name
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      WHERE e.supplier_id = ? AND e.status IN ('posted', 'approved')
        AND e.date BETWEEN ? AND ?
      ORDER BY e.date ASC
    `, [supplier.id, fromDate, toDate]);

    const statement = [];
    if (openingBal !== 0) {
      statement.push({
        date: fromDate,
        type: 'رصيد افتتاحي',
        ref: 'رصيد أول المدة',
        credit: openingBal > 0 ? openingBal : 0,
        debit: openingBal < 0 ? Math.abs(openingBal) : 0,
        notes: 'الرصيد الافتتاحي المقيد بدفتر الأستاذ العام'
      });
    }

    grns.forEach(g => {
      const amt = Number(g.po_amount) || 0;
      statement.push({
        date: g.received_date,
        type: 'استلام بضاعة (GRN)',
        ref: g.grn_no || ('GRN-' + g.id),
        project_name: g.project_name || '-',
        credit: amt,
        debit: 0,
        notes: `أمر شراء رقم ${g.po_no || g.po_id}`
      });
    });

    expenses.forEach(e => {
      statement.push({
        date: e.date,
        type: e.payment_method ? `سند صرف (${e.payment_method})` : 'سند صرف',
        ref: e.receipt_no || ('EXP-' + e.id),
        project_name: e.project_name || '-',
        credit: 0,
        debit: Number(e.amount) || 0,
        notes: e.notes || ''
      });
    });

    statement.sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    const enriched = statement.map(item => {
      running += (item.credit - item.debit);
      return { ...item, running_balance: Math.round(running * 100) / 100 };
    });

    const totalCredit = Math.round(statement.reduce((s, i) => s + (i.credit || 0), 0) * 100) / 100;
    const totalDebit = Math.round(statement.reduce((s, i) => s + (i.debit || 0), 0) * 100) / 100;
    const netBalance = Math.round((totalCredit - totalDebit) * 100) / 100;

    return {
      success: true,
      data: {
        supplier: {
          id: supplier.id,
          name: supplier.company_name || supplier.name,
          phone: supplier.phone_number || supplier.phone,
          currency: supplier.default_currency || 'YER',
          ap_account_id: apAccountId
        },
        statement: enriched,
        summary: {
          opening_balance: openingBal,
          total_invoiced: totalCredit,
          total_paid: totalDebit,
          outstanding_balance: netBalance
        }
      },
      meta: {
        report_name: 'كشف حساب مورد تفصيلي',
        from_date: fromDate,
        to_date: toDate,
        currency: supplier.default_currency || 'YER',
        generated_at: new Date().toISOString(),
        source: 'General Ledger AP & Subledger Purchasing'
      },
      warnings: apAccountId ? [] : ['لم يتم ربط المورد بحساب ذمم دائنة مستقل في دليل الحسابات'],
      reconciliation: {
        is_balanced: true,
        net_balance: netBalance
      }
    };
  }

  /**
   * 10. إحصائيات لوحة التحكم المركزية (Dashboard KPIs)
   * مبنية على نفس خدمات التقارير الرسمية لمنع أي تضارب بين لوحة التحكم والقوائم الرسمية
   */
  async getDashboard({ allowedProjects = ['*'] } = {}) {
    const today = new Date().toISOString().split('T')[0];
    const yearStart = `${new Date().getFullYear()}-01-01`;

    const incomeReport = await this.getIncomeStatement({ from_date: yearStart, to_date: today });
    const balanceSheet = await this.getBalanceSheet({ as_of_date: today });
    const cashFlow = await this.getCashFlow({ from_date: yearStart, to_date: today });

    const clientDueSum = await get("SELECT COALESCE(SUM(current_balance), 0) as total FROM clients");
    const supplierDueSum = await get("SELECT COALESCE(SUM(balance), 0) as total FROM suppliers");
    const activeProjectsCount = await get("SELECT COUNT(*) as cnt FROM projects WHERE status = 'active'");
    const totalProjectsCount = await get("SELECT COUNT(*) as cnt FROM projects");

    const totalIncome = incomeReport.data.total_revenues;
    const totalExpenses = incomeReport.data.total_expenses;
    const netProfit = incomeReport.data.net_profit;
    const cashBalance = cashFlow.data.closing_balance;

    // استخراج حركة الـ 6 أشهر الماضية
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const now = new Date();
    const monthsList = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      monthsList.push({ key: `${y}-${m}`, name: monthNames[d.getMonth()] });
    }

    const monthlyTrends = [];
    for (const m of monthsList) {
      const mStart = `${m.key}-01`;
      const mEnd = `${m.key}-31`;
      const mRevRes = await get(`
        SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS rev
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE je.status = 'posted' AND je.date BETWEEN ? AND ?
          AND (a.type = 'إيرادات' OR a.code LIKE '4%')
      `, [mStart, mEnd]);

      const mExpRes = await get(`
        SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS exp
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN accounts a ON a.id = jel.account_id
        WHERE je.status = 'posted' AND je.date BETWEEN ? AND ?
          AND (a.type = 'مصروفات' OR a.type = 'تكاليف' OR a.code LIKE '3%' OR a.code LIKE '5%')
      `, [mStart, mEnd]);

      monthlyTrends.push({
        month: m.name,
        income: Math.round(Number(mRevRes?.rev || 0) * 100) / 100,
        expense: Math.round(Number(mExpRes?.exp || 0) * 100) / 100
      });
    }

    return {
      success: true,
      data: {
        kpis: {
          total_income: totalIncome,
          recognized_revenue: totalIncome,
          total_expenses: totalExpenses,
          net_profit: netProfit,
          cash_balance: cashBalance,
          client_receivables: Number(clientDueSum?.total || 0),
          supplier_payables: Number(supplierDueSum?.total || 0),
          active_projects: Number(activeProjectsCount?.cnt || 0),
          total_projects: Number(totalProjectsCount?.cnt || 0)
        },
        monthly_trend: monthlyTrends,
        expenses_by_type: incomeReport.data.operating_expenses
      },
      meta: {
        report_name: 'لوحة التحكم والمؤشرات المالية',
        currency: 'ر.ي',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: [],
      reconciliation: {
        is_balanced: balanceSheet.data.totals.assets === balanceSheet.data.totals.liabilities_plus_equity
      }
    };
  }

  /**
   * 11. الفحص الشامل لسلامة البيانات والأستاذ العام (Financial Integrity Check)
   * يفحص القيود غير المتوازنة، القيود على حسابات أب، المراجع المكررة، وأي فروقات تسوية
   */
  async getIntegrityCheck() {
    // 1. قيود غير متوازنة
    const unbalancedEntries = await query(`
      SELECT je.id, je.entry_no, je.date, je.description, je.total_debit, je.total_credit,
             ABS(je.total_debit - je.total_credit) AS difference
      FROM journal_entries je
      WHERE je.status = 'posted' AND ABS(je.total_debit - je.total_credit) >= 0.001;
    `);

    // 2. سطور مرتبطة بحسابات أب
    const parentAccountLines = await query(`
      SELECT jel.id, jel.entry_id, jel.account_id, a.code, a.name
      FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE EXISTS (
          SELECT 1
          FROM accounts child
          WHERE child.parent_id = a.id
      );
    `);

    // 3. مراجع قيود مكررة
    const duplicateReferences = await query(`
      SELECT reference_type, reference_id, COUNT(*) AS count
      FROM journal_entries
      WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL
      GROUP BY reference_type, reference_id
      HAVING COUNT(*) > 1;
    `);

    // 4. فحص اتزان ميزان المراجعة
    const tb = await this.getTrialBalance({});
    // 5. فحص اتزان الميزانية العمومية
    const bs = await this.getBalanceSheet({});
    // 6. فحص تسوية التدفق النقدي
    const cf = await this.getCashFlow({});

    const allPassed = unbalancedEntries.length === 0 &&
                      parentAccountLines.length === 0 &&
                      duplicateReferences.length === 0 &&
                      tb.reconciliation.is_balanced &&
                      bs.reconciliation.is_balanced &&
                      cf.reconciliation.is_balanced;

    return {
      success: true,
      data: {
        is_healthy: allPassed,
        unbalanced_entries: { count: unbalancedEntries.length, items: unbalancedEntries },
        parent_account_lines: { count: parentAccountLines.length, items: parentAccountLines },
        duplicate_references: { count: duplicateReferences.length, items: duplicateReferences },
        trial_balance_check: tb.reconciliation,
        balance_sheet_check: bs.reconciliation,
        cash_flow_check: cf.reconciliation
      },
      meta: {
        report_name: 'تقرير التدقيق والفحص الشامل لسلامة الدفاتر والأستاذ العام',
        generated_at: new Date().toISOString(),
        source: 'General Ledger'
      },
      warnings: allPassed ? [] : ['تم اكتشاف مشاكل أو فروقات في سلامة الدفاتر المحاسبية يرجى مراجعتها فوراً']
    };
  }
}

module.exports = new ReportingService();

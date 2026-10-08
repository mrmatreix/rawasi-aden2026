/**
 * contractingAccountingService.js
 * 
 * محرك المحاسبة الاحترافي لقطاع المقاولات والهندسة الإنشائية
 * مبني وفق المعايير الدولية لإعداد التقارير المالية (IFRS 15 / Percentage of Completion - POC)
 * يحل نهائياً إشكالية الخلط القاتل بين:
 *  1. المقبوضات النقدية (Cash Receipts / Liquidity)
 *  2. الإيرادات المعترف بها (Recognized Revenue / Cost-to-Cost POC)
 *  3. المستخلصات المعتمدة (Progress Billings / Interim Payment Certificates)
 *  4. الدفعات المقدمة (Advance Payments / Contract Liabilities)
 *  5. محتجز الضمان (Retention Money / Contract Asset)
 *  6. الأعمال تحت التنفيذ (WIP / Costs & Profits in Excess of Billings)
 *  7. الأصول والالتزامات التعاقدية (Contract Assets vs Contract Liabilities)
 *  8. أوامر التغيير والمطالبات (Approved vs Pending Variation Orders)
 */

const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const { checkPeriodOpen } = require('./periodService');

// معرفات الحسابات المعيارية لعقود المقاولات في دليل الحسابات
const CONTRACT_ACCOUNTS = {
  CASH_AND_BANKS: 3,         // 111 - الصندوق الرئيسي والبنك
  CLIENT_RECEIVABLES: 4,     // 112 - العملاء (الذمم المدينة)
  RETENTION_RECEIVABLE: 16,  // 1125 - محتجزات ضمان لدى العملاء
  CONTRACT_ASSET_WIP: 17,    // 1128 - أصول تعاقدية / أعمال منجزة غير مفوترة
  CUSTOMER_ADVANCES: 18,     // 2105 - التزامات تعاقدية / دفعات مقدمة من العملاء
  CONTRACT_LIABILITY: 19,    // 2115 - التزامات تعاقدية / فواتير تزيد عن التكلفة والإنجاز
  CONTRACT_REVENUE: 20,      // 4101 - إيرادات عقود المقاولات المعترف بها
  VARIATION_REVENUE: 21,     // 4102 - إيرادات أوامر التغيير المعتمدة
  PROJECT_EXPENSES: 10       // 5 - المصروفات وتكاليف المشاريع
};

const ContractingAccountingService = {
  CONTRACT_ACCOUNTS,

  /**
   * حساب المصفوفة المالية التفصيلية لمشروع واحد وفصل ركائز المقاولات الـ 8
   * @param {number|string} projectId 
   * @param {Object} options 
   */
  async calculateProjectMetrics(projectId, options = {}) {
    const pId = Number(projectId);
    const proj = await get(`
      SELECT p.*, c.name as client_name, c.company as client_company
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [pId]);

    if (!proj) {
      throw new Error(`المشروع رقم (${projectId}) غير موجود في النظام`);
    }

    // 1. العقد الأساسي وشروطه
    const contract = await get('SELECT * FROM project_contracts WHERE project_id = ? ORDER BY id DESC LIMIT 1', [pId]);
    const baseContractValue = Number(proj.contract_value) || 0;
    const baseEstimatedCost = Number(proj.estimated_cost) || 0;
    const engineeringProgress = Number(proj.progress_percentage) || 0;

    // 2. أوامر التغيير والمطالبات (Variation Orders & Claims)
    // المعتمدة: تضاف لقيمة العقد وتؤثر في نسبة الإنجاز والاعتراف بالإيراد
    // المعلقة/قيد المراجعة: تعزل تماماً لحماية الشركة من تضخيم الأرباح
    const changeOrders = await query('SELECT * FROM project_change_orders WHERE project_id = ?', [pId]);
    let approvedVariationsAmount = 0;
    let pendingVariationsAmount = 0;
    let approvedVariationsCount = 0;
    let pendingVariationsCount = 0;

    (changeOrders || []).forEach(co => {
      const amt = Number(co.amount) || 0;
      if (co.status === 'معتمد') {
        approvedVariationsAmount += amt;
        approvedVariationsCount++;
      } else if (co.status !== 'مرفوض') {
        pendingVariationsAmount += amt;
        pendingVariationsCount++;
      }
    });

    const revisedContractValue = baseContractValue + approvedVariationsAmount;

    // 3. التكاليف الفعلية المتكبدة حتى تاريخه (Cumulative Incurred Actual Cost)
    const expRow = await get(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expenses 
      WHERE project_id = ? AND status IN ('posted', 'approved')
    `, [pId]);
    const purchasesRow = await get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM project_purchases 
      WHERE project_id = ?
    `, [pId]);
    const laborRow = await get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM project_labor_expenses 
      WHERE project_id = ?
    `, [pId]);

    const directCostFromRecords = (expRow ? Number(expRow.total) : 0) +
                                  (purchasesRow ? Number(purchasesRow.total) : 0) +
                                  (laborRow ? Number(laborRow.total) : 0);

    const cumulativeActualCost = Math.max(Number(proj.actual_cost) || 0, directCostFromRecords);

    // تقدير التكلفة الإجمالية المنقحة (Revised Estimated Total Cost)
    // بدون أي نسب افتراضية مصطنعة (Zero Magic Numbers)
    const warnings = [];
    let revisedEstimatedCost = baseEstimatedCost > 0 ? (baseEstimatedCost + approvedVariationsAmount) : 0;

    if (revisedEstimatedCost <= 0) {
      warnings.push({
        code: 'MISSING_ESTIMATED_COST',
        message: `المشروع (${proj.name}) يفتقر إلى موازنة تقديرية معتمدة (Estimated Cost = 0)`
      });
    }

    // 4. نسبة الإنجاز المحاسبية المعيارية (POC - Percentage of Completion / Cost-to-Cost)
    let costToCostPOC = null;
    if (proj.status === 'completed') {
      costToCostPOC = 100;
    } else if (revisedEstimatedCost > 0) {
      costToCostPOC = Math.min(100, Math.round(((cumulativeActualCost / revisedEstimatedCost) * 100) * 100) / 100);
    }

    // 5. الإيراد المعترف به تراكمياً وفق نسبة الإنجاز والمعيار الدولي IFRS 15
    const cumulativeRecognizedRevenue = (costToCostPOC !== null && revisedContractValue > 0)
      ? Math.round(revisedContractValue * (costToCostPOC / 100))
      : 0;

    // فحص الإيرادات المثبتة دفترياً من جدول القيود السابقة
    const lastRecognition = await get(`
      SELECT * FROM contract_revenue_recognitions 
      WHERE project_id = ? AND status = 'posted' 
      ORDER BY id DESC LIMIT 1
    `, [pId]);
    const previouslyPostedRevenue = lastRecognition ? Number(lastRecognition.cumulative_recognized_revenue) : 0;
    const unpostedPeriodRevenue = Math.max(0, cumulativeRecognizedRevenue - previouslyPostedRevenue);

    // 6. المستخلصات المعتمدة التراكمية (Progress Billings / IPC)
    const billsRows = await query(`
      SELECT * FROM bills 
      WHERE project_id = ? AND status NOT IN ('ملغي', 'مرفوض', 'مسودة')
    `, [pId]);

    const projectInvoicesRows = await query(`
      SELECT * FROM project_invoices 
      WHERE project_id = ? AND status NOT IN ('ملغي', 'مرفوض', 'مسودة')
    `, [pId]);

    let grossBillings = 0;
    let advanceDeducted = 0;
    let retentionDeducted = 0;
    let otherDeductions = 0;
    let netBilledReceivable = 0;

    if (projectInvoicesRows && projectInvoicesRows.length > 0) {
      projectInvoicesRows.forEach(inv => {
        grossBillings += Number(inv.current_gross_amount) || Number(inv.cumulative_work_done) || 0;
        advanceDeducted += Number(inv.advance_deduction) || 0;
        retentionDeducted += Number(inv.retention_deduction) || 0;
        otherDeductions += Number(inv.other_deductions) || 0;
        netBilledReceivable += Number(inv.net_amount) || 0;
      });
    } else {
      (billsRows || []).forEach(b => {
        const amt = Number(b.amount) || 0;
        const ded = Number(b.deduction) || 0;
        const net = Number(b.net_amount) || (amt - ded);
        grossBillings += amt;
        advanceDeducted += Number(b.advance_deduction) || 0;
        retentionDeducted += Number(b.retention_deduction) || 0;
        netBilledReceivable += net;
      });
    }

    // 7. المقبوضات النقدية الفعلية (Actual Cash Receipts) من الخزينة/البنك
    const receiptsRows = await query(`
      SELECT * FROM payments 
      WHERE project_id = ? AND type = 'قبض' AND status != 'reversed'
    `, [pId]);

    let totalCashReceipts = 0;
    let advancePaymentsReceived = 0;
    let progressBillingsCollected = 0;
    let retentionReleasesCollected = 0;
    let generalReceipts = 0;

    (receiptsRows || []).forEach(r => {
      const amt = Number(r.amount) || 0;
      totalCashReceipts += amt;
      const cat = r.receipt_category || 'general';
      const notes = (r.notes || '').toLowerCase();

      if (cat === 'advance_payment' || notes.includes('مقدمة') || notes.includes('دفعة اولى') || notes.includes('دفعة أولى')) {
        advancePaymentsReceived += amt;
      } else if (cat === 'retention_release' || notes.includes('ضمان') || notes.includes('محتجز')) {
        retentionReleasesCollected += amt;
      } else if (cat === 'progress_billing' || notes.includes('مستخلص')) {
        progressBillingsCollected += amt;
      } else {
        generalReceipts += amt;
      }
    });

    // إذا تم استلام دفعة مقدمة مسجلة في العقد ولم تُصنف في سند منفصل
    const contractAdvanceTarget = contract ? Number(contract.advance_payment_amount) || 0 : 0;
    if (advancePaymentsReceived === 0 && contractAdvanceTarget > 0 && totalCashReceipts >= contractAdvanceTarget) {
      advancePaymentsReceived = contractAdvanceTarget;
      progressBillingsCollected = Math.max(0, totalCashReceipts - advancePaymentsReceived);
    }

    // 8. الدفعة المقدمة غير المستهلكة (Unamortized Advance Payment - Contract Liability)
    // التزام تعاقدي على الشركة حتى يتم تسويته من المستخلصات
    const unamortizedAdvanceLiability = Math.max(0, advancePaymentsReceived - advanceDeducted);

    // 9. محتجز الضمان القائم (Active Retention Balance - Contract Asset / Retention Receivable)
    // أصل تعاقدي للشركة محتجز لدى العميل حتى انتهاء فترة الصيانة والتسليم النهائي
    const activeRetentionAsset = Math.max(0, retentionDeducted - retentionReleasesCollected);

    // 10. الأصول التعاقدية (WIP) والالتزامات التعاقدية (Contract Assets vs Liabilities)
    // الفرق بين الإيراد المعترف به وفق الإنجاز وبين إجمالي الأعمال المفوترة
    const billingRevenueDelta = cumulativeRecognizedRevenue - grossBillings;
    let contractAssetWIP = 0;      // إنجاز غير مفوتر (Under-billing)
    let contractLiabilityExcess = 0; // فوترة تفوق الإنجاز (Over-billing)

    if (billingRevenueDelta > 0) {
      contractAssetWIP = billingRevenueDelta;
    } else if (billingRevenueDelta < 0) {
      contractLiabilityExcess = Math.abs(billingRevenueDelta);
    }

    // إجمالي الالتزامات التعاقدية الشاملة (دفعات مقدمة غير مستهلكة + فوترة زائدة عن الإنجاز)
    const totalContractLiabilities = unamortizedAdvanceLiability + contractLiabilityExcess;

    // 11. المقارنة التحليلية الصارمة: الأرباح المحاسبية الحقيقية مقابل السيولة النقدية
    const recognizedNetProfit = cumulativeRecognizedRevenue - cumulativeActualCost;
    const recognizedProfitMargin = cumulativeRecognizedRevenue > 0
      ? Math.round((recognizedNetProfit / cumulativeRecognizedRevenue) * 100 * 10) / 10
      : 0;

    const netCashFlow = totalCashReceipts - cumulativeActualCost;
    const liquidityVsProfitGap = totalCashReceipts - cumulativeRecognizedRevenue;

    return {
      project_id: pId,
      project_name: proj.name,
      project_code: proj.code,
      client_id: proj.client_id,
      client_name: proj.client_name || 'عميل عام',
      status: proj.status,

      // ركائز العقد والتكاليف
      base_contract_value: baseContractValue,
      revised_contract_value: revisedContractValue,
      revised_estimated_cost: revisedEstimatedCost,
      cumulative_actual_cost: cumulativeActualCost,

      // نسب الإنجاز المقارنة
      engineering_progress_pct: engineeringProgress,
      cost_to_cost_poc_pct: costToCostPOC,

      // الركائز المحاسبية الـ 8 المفصولة بدقة:
      // 1. المقبوضات النقدية (سيولة حقيقية)
      cash_receipts: {
        total: totalCashReceipts,
        advance_received: advancePaymentsReceived,
        billings_collected: progressBillingsCollected,
        retention_collected: retentionReleasesCollected,
        general_receipts: generalReceipts
      },

      // 2. الإيرادات المعترف بها (IFRS 15)
      recognized_revenue: {
        cumulative: cumulativeRecognizedRevenue,
        previously_posted: previouslyPostedRevenue,
        unposted_period: unpostedPeriodRevenue,
        basis: `طريقة التكلفة للتكلفة POC (${costToCostPOC}%) من قيمة العقد المنقحة`
      },

      // 3. المستخلصات المعتمدة (مطالبات رسمية)
      progress_billings: {
        gross_billings: grossBillings,
        advance_deducted: advanceDeducted,
        retention_deducted: retentionDeducted,
        other_deductions: otherDeductions,
        net_billed_receivable: netBilledReceivable,
        outstanding_receivable: Math.max(0, netBilledReceivable - progressBillingsCollected)
      },

      // 4. الدفعات المقدمة (التزام تعاقدي)
      advance_payments: {
        total_received: advancePaymentsReceived,
        amortized_in_billings: advanceDeducted,
        unamortized_liability: unamortizedAdvanceLiability,
        accounting_treatment: 'التزام تعاقدي متداول (خصوم) لا يُعد إيراداً حتى تنفيذ الأعمال المقابلة'
      },

      // 5. محتجز الضمان (أصل تعاقدي)
      retention_money: {
        total_deducted: retentionDeducted,
        released_collected: retentionReleasesCollected,
        active_retention_asset: activeRetentionAsset,
        accounting_treatment: 'أصل تعاقدي وحق مؤجل التحصيل يسترد بعد انتهاء فترة الضمان والصيانة'
      },

      // 6 & 7. الأصول والالتزامات التعاقدية (WIP vs Over-billings)
      contract_assets_and_liabilities: {
        contract_asset_wip: contractAssetWIP,
        contract_liability_excess: contractLiabilityExcess,
        total_contract_liabilities: totalContractLiabilities,
        status_description: contractAssetWIP > 0
          ? `أصل تعاقدي (WIP): أعمال منفذة وإيرادات مستحقة غير مفوترة بقيمة ${contractAssetWIP.toLocaleString()} ر.ي`
          : (contractLiabilityExcess > 0
            ? `التزام تعاقدي: فواتير تفوق نسبة الإنجاز الفعلي بقيمة ${contractLiabilityExcess.toLocaleString()} ر.ي`
            : 'توازن تام بين الإنجاز المحاسبي والفوترة المعتمدة')
      },

      // 8. أوامر التغيير والمطالبات
      variation_orders: {
        approved_amount: approvedVariationsAmount,
        approved_count: approvedVariationsCount,
        pending_amount: pendingVariationsAmount,
        pending_count: pendingVariationsCount,
        compliance_rule: 'الأوامر المعتمدة تضاف لقيمة العقد وتؤثر في الإيراد، والمعلقة معزولة وفق مبدأ التحفظ'
      },

      // التحليل المالي: الأرباح مقابل السيولة النقدية
      financial_analysis: {
        true_recognized_profit: recognizedNetProfit,
        profit_margin_pct: recognizedProfitMargin,
        net_cash_flow: netCashFlow,
        liquidity_vs_profit_gap: liquidityVsProfitGap,
        gap_insight: liquidityVsProfitGap > 0
          ? 'السيولة تفوق الإيراد (مقبوضات مسبقة والتزامات واجبة التنفيذ)'
          : (liquidityVsProfitGap < 0
            ? 'الإيراد يفوق السيولة (إنجاز عالي ومستحقات ذمم تحت التحصيل)'
            : 'تطابق تام بين التدفق النقدي والإيراد المكتسب')
      },
      warnings
    };
  },

  /**
   * جلب المصفوفة المالية الشاملة للشركة وكافة المشاريع مجمعة
   * @param {Object} options 
   */
  async getCompanyWideSeparationMatrix(options = {}) {
    const { allowedProjectIds = ['*'] } = options;

    let whereClause = '';
    const params = [];
    if (allowedProjectIds && !allowedProjectIds.includes('*') && !allowedProjectIds.includes('all')) {
      if (allowedProjectIds.length === 0) {
        return this._getEmptyMatrix();
      }
      const placeholders = allowedProjectIds.map(() => '?').join(',');
      whereClause = ` WHERE id IN (${placeholders})`;
      params.push(...allowedProjectIds.map(Number));
    }

    const projects = await query(`
      SELECT id, name, code, status, contract_value, estimated_cost, actual_cost, progress_percentage 
      FROM projects 
      ${whereClause} 
      ORDER BY id ASC
    `, params);

    const projectMetrics = [];
    for (const p of projects) {
      try {
        const m = await this.calculateProjectMetrics(p.id);
        projectMetrics.push(m);
      } catch (err) {
        console.error(`Error calculating metrics for project ${p.id}:`, err.message);
      }
    }

    // تجميع الإجماليات على مستوى الشركة
    const summary = {
      total_contract_value: 0,
      total_cumulative_cost: 0,
      total_cash_receipts: 0,
      total_recognized_revenue: 0,
      total_gross_billings: 0,
      total_net_billings: 0,
      total_advance_liability: 0,
      total_active_retention: 0,
      total_contract_asset_wip: 0,
      total_contract_liability: 0,
      total_approved_variations: 0,
      total_pending_variations: 0,
      total_true_profit: 0,
      total_net_cash_flow: 0
    };

    projectMetrics.forEach(pm => {
      summary.total_contract_value += pm.revised_contract_value;
      summary.total_cumulative_cost += pm.cumulative_actual_cost;
      summary.total_cash_receipts += pm.cash_receipts.total;
      summary.total_recognized_revenue += pm.recognized_revenue.cumulative;
      summary.total_gross_billings += pm.progress_billings.gross_billings;
      summary.total_net_billings += pm.progress_billings.net_billed_receivable;
      summary.total_advance_liability += pm.advance_payments.unamortized_liability;
      summary.total_active_retention += pm.retention_money.active_retention_asset;
      summary.total_contract_asset_wip += pm.contract_assets_and_liabilities.contract_asset_wip;
      summary.total_contract_liability += pm.contract_assets_and_liabilities.total_contract_liabilities;
      summary.total_approved_variations += pm.variation_orders.approved_amount;
      summary.total_pending_variations += pm.variation_orders.pending_amount;
      summary.total_true_profit += pm.financial_analysis.true_recognized_profit;
      summary.total_net_cash_flow += pm.financial_analysis.net_cash_flow;
    });

    const overallProfitMargin = summary.total_recognized_revenue > 0
      ? Math.round((summary.total_true_profit / summary.total_recognized_revenue) * 100 * 10) / 10
      : 0;

    return {
      success: true,
      timestamp: new Date().toISOString(),
      standards: 'IFRS 15 - Revenue from Contracts with Customers / Percentage of Completion (POC)',
      summary: {
        ...summary,
        overall_profit_margin_pct: overallProfitMargin,
        cash_to_revenue_ratio: summary.total_recognized_revenue > 0
          ? Math.round((summary.total_cash_receipts / summary.total_recognized_revenue) * 100)
          : 0,
        uncollected_billed_ratio: summary.total_net_billings > 0
          ? Math.round((Math.max(0, summary.total_net_billings - summary.total_cash_receipts) / summary.total_net_billings) * 100)
          : 0
      },
      projects: projectMetrics
    };
  },

  _getEmptyMatrix() {
    return {
      success: true,
      timestamp: new Date().toISOString(),
      standards: 'IFRS 15 - Percentage of Completion',
      summary: {
        total_contract_value: 0,
        total_cumulative_cost: 0,
        total_cash_receipts: 0,
        total_recognized_revenue: 0,
        total_gross_billings: 0,
        total_net_billings: 0,
        total_advance_liability: 0,
        total_active_retention: 0,
        total_contract_asset_wip: 0,
        total_contract_liability: 0,
        total_approved_variations: 0,
        total_pending_variations: 0,
        total_true_profit: 0,
        total_net_cash_flow: 0
      },
      projects: []
    };
  },

  /**
   * إنشاء قيد تسوية إثبات الإيراد المحاسبي الدوري لمشروع وفق نسبة الإنجاز POC
   * @param {Object} params 
   */
  async recognizeProjectRevenue({ projectId, periodDate, notes, user, req = null }) {
    const pId = Number(projectId);
    const date = periodDate || new Date().toISOString().split('T')[0];

    // التحقق من فتح الفترة المحاسبية
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      throw new Error(`الفترة المحاسبية لتاريخ (${date}) مغلقة: ${periodCheck.message}`);
    }

    // حساب المعايير الحالية للمشروع
    const metrics = await this.calculateProjectMetrics(pId);
    const unpostedAmount = metrics.recognized_revenue.unposted_period;

    if (unpostedAmount <= 0) {
      return {
        success: false,
        message: `تم إثبات الإيراد مسبقاً حتى نسبة الإنجاز الحالية (${metrics.cost_to_cost_poc_pct}%). لا يوجد إيراد جديد غير مثبت لهذه الفترة.`,
        cumulative_revenue: metrics.recognized_revenue.cumulative,
        previously_posted: metrics.recognized_revenue.previously_posted,
        period_revenue: 0
      };
    }

    let recognitionId = null;
    let entryNo = '';
    let jeId = null;

    const creatorId = user?.id || null;
    const creatorName = user?.username || user?.full_name || 'مدير الحسابات';

    await transaction(async (tx) => {
      // 1. توليد رقم تسلسلي لإثبات الإيراد
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM contract_revenue_recognitions');
      const recSeq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      const recNo = `REV-REC-${new Date().getFullYear()}-${String(recSeq).padStart(4, '0')}`;

      // 2. توليد قيد اليومية العام لإثبات الإيراد المعترف به
      // الطرف المدين: 1128 - أصول تعاقدية / أعمال منجزة غير مفوترة (Contract Asset / WIP)
      // الطرف الدائن: 4101 - إيرادات عقود المقاولات المعترف بها (Contract Revenue)
      const jeCountRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let jeSeq = ((jeCountRes ? jeCountRes.cnt : 0) || 0) + 1;
      entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
        jeSeq++;
        entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      }

      const jeDesc = `إثبات إيراد مقاولات دوري مشروع (${metrics.project_name}) - نسبة إنجاز ${metrics.cost_to_cost_poc_pct}% (IFRS 15)`;
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id,
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'إثبات إيراد تعاقدي', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entryNo, date, jeDesc,
        pId, unpostedAmount, unpostedAmount,
        creatorId, creatorName, creatorId, creatorName
      ]);

      jeId = jeRes.lastInsertRowid || jeRes.insertId;

      // سطر المدين: أصول تعاقدية (حساب 17 أو كود 1128)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, cost_center_id, debit, credit, notes)
        VALUES (?, 17, ?, 1, ?, 0, ?)
      `, [jeId, pId, unpostedAmount, `أصول تعاقدية - إيراد مستحق غير مفوتر حتى نسبة ${metrics.cost_to_cost_poc_pct}%`]);

      // سطر الدائن: إيرادات عقود المقاولات (حساب 20 أو كود 4101)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, cost_center_id, debit, credit, notes)
        VALUES (?, 20, ?, 1, 0, ?, ?)
      `, [jeId, pId, unpostedAmount, `إيرادات عقود مقاولات معترف بها - معيار IFRS 15`]);

      // 3. حفظ سجل الإثبات في جدول contract_revenue_recognitions
      const recRes = await tx.run(`
        INSERT INTO contract_revenue_recognitions (
          recognition_no, project_id, period_date, contract_value, estimated_cost,
          actual_cost_cumulative, poc_percentage, cumulative_recognized_revenue,
          previous_recognized_revenue, period_recognized_revenue, cumulative_billings,
          contract_asset_wip, contract_liability, journal_entry_id, status, notes,
          created_by, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)
      `, [
        recNo, pId, date, metrics.revised_contract_value, metrics.revised_estimated_cost,
        metrics.cumulative_actual_cost, metrics.cost_to_cost_poc_pct, metrics.recognized_revenue.cumulative,
        metrics.recognized_revenue.previously_posted, unpostedAmount, metrics.progress_billings.gross_billings,
        metrics.contract_assets_and_liabilities.contract_asset_wip,
        metrics.contract_assets_and_liabilities.contract_liability_excess,
        jeId, notes || 'تسوية إيرادات دورية آلية معتمدة وفق نسبة الإنجاز',
        creatorId, creatorName
      ]);

      recognitionId = recRes.lastInsertRowid || recRes.insertId;
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVENUE_RECOGNITION',
        entity_type: 'contract_revenue',
        entity_id: String(recognitionId),
        details: {
          project_id: pId,
          project_name: metrics.project_name,
          poc_pct: metrics.cost_to_cost_poc_pct,
          period_revenue: unpostedAmount,
          cumulative_revenue: metrics.recognized_revenue.cumulative,
          journal_entry_no: entryNo
        },
        new_values: {
          period_revenue: unpostedAmount,
          cumulative_revenue: metrics.recognized_revenue.cumulative,
          entry_no: entryNo
        },
        reason: notes || `إثبات إيراد تعاقدي معتمد وفق نسبة الإنجاز ${metrics.cost_to_cost_poc_pct}%`
      });
    }

    return {
      success: true,
      message: `تم إثبات إيراد الفترة بنجاح بقيمة (${unpostedAmount.toLocaleString()} ر.ي) بموجب القيد المحاسبي (${entryNo}) للمشروع (${metrics.project_name})`,
      recognition_id: recognitionId,
      journal_entry_no: entryNo,
      journal_entry_id: jeId,
      period_recognized_revenue: unpostedAmount,
      cumulative_recognized_revenue: metrics.recognized_revenue.cumulative,
      poc_pct: metrics.cost_to_cost_poc_pct
    };
  }
};

module.exports = ContractingAccountingService;

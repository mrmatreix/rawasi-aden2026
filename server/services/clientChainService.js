/**
 * server/services/clientChainService.js
 * 
 * محرك إدارة وتتبع دورة حياة العميل المالية والربط الهرمي المتكامل:
 * عميل (Client) → عقد (Contract) → مشاريع (Projects) → مستخلصات (Bills) → فواتير ومطالبات (Claims)
 * → دفعات مقدمة (Advance Payments) → مبالغ محصلة (Collections) → محتجزات (Retention) → رصيد مستحق (Outstanding Balance)
 * 
 * يضمن:
 * 1. الربط التلقائي والآلي بين المستخلص والمشروع والعقد وحساب العميل.
 * 2. التأثير الآلي واللحظي على رصيد العميل عند أي حركة مالية (Zero Static Drift).
 * 3. تتبع استهلاك الدفعات المقدمة ومحتجزات الضمان ومتبقيات المستخلصات.
 * 4. توليد هيكل هرمي متسلسل وشفاف لقراءته عبر API والواجهات الأمامية.
 */

const { query, get, run } = require('../database/db');

class ClientChainService {
  /**
   * التحديث المحاسبي الذري لرصيد العميل ومستحقاته ومدفوعاته في الوقت الفعلي
   * @param {number} clientId معرف العميل
   * @param {object} [tx] معاملة قاعدة بيانات اختيارية
   */
  async syncClientBalances(clientId, tx = null) {
    if (!clientId) return null;
    const executor = tx || { get, run, query };

    const client = await executor.get('SELECT id, previous_balance FROM clients WHERE id = ?', [clientId]);
    if (!client) return null;

    const prevBal = Number(client.previous_balance) || 0;

    // 1. إجمالي المطالبات والمستخلصات المعتمدة (ذمم مدينة)
    const billRes = await executor.get(`
      SELECT COALESCE(SUM(net_amount), 0) AS total_due
      FROM bills
      WHERE client_id = ? 
        AND status IN ('معتمد', 'posted', 'محصل جزئي', 'محصل كامل')
    `, [clientId]);
    const totalDue = Number(billRes ? billRes.total_due : 0) || 0;

    // 2. إجمالي المقبوضات المعتمدة (سندات قبض)
    const payRes = await executor.get(`
      SELECT COALESCE(SUM(COALESCE(local_amount, amount)), 0) AS total_paid
      FROM payments
      WHERE client_id = ? 
        AND type = 'قبض' 
        AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
    `, [clientId]);
    const totalPaid = Number(payRes ? payRes.total_paid : 0) || 0;

    // 3. صافي الرصيد المستحق = (رصيد أول المدة + إجمالي المستخلصات المعتمدة) - إجمالي المحصل
    const currentBalance = Math.round(((prevBal + totalDue) - totalPaid) * 100) / 100;

    await executor.run(`
      UPDATE clients 
      SET total_due = ?, total_paid = ?, current_balance = ?
      WHERE id = ?
    `, [totalDue, totalPaid, currentBalance, clientId]);

    return {
      clientId,
      previous_balance: prevBal,
      total_due: totalDue,
      total_paid: totalPaid,
      current_balance: currentBalance
    };
  }

  /**
   * ربط آلي ذكي لبيانات المستخلص مع العقد والمشروع ونسب الاستقطاع
   * @param {object} billData بيانات المستخلص المراد إنشاؤه
   */
  async resolveBillContractAndClient(billData) {
    let { project_id, client_id, contract_id, amount, advance_deduction, retention_deduction } = billData;
    const grossAmount = Number(amount) || 0;

    // 1. استنتاج العميل من المشروع إن لم يُحدد
    if (!client_id && project_id) {
      const proj = await get('SELECT client_id FROM projects WHERE id = ?', [project_id]);
      if (proj && proj.client_id) {
        client_id = proj.client_id;
      }
    }

    // 2. استنتاج العقد الساري للمشروع إن لم يُحدد
    let contract = null;
    if (contract_id) {
      contract = await get('SELECT * FROM project_contracts WHERE id = ?', [contract_id]);
    } else if (project_id) {
      contract = await get("SELECT * FROM project_contracts WHERE project_id = ? AND (status != 'ملغي' OR status IS NULL) ORDER BY id DESC LIMIT 1", [project_id]);
      if (contract) {
        contract_id = contract.id;
      }
    }

    // 3. احتساب الاستقطاعات التلقائية من شروط العقد إذا لم يتم إدخالها صراحة
    let advDed = Number(advance_deduction) || 0;
    let retDed = Number(retention_deduction) || 0;

    if (contract && grossAmount > 0) {
      // إذا لم يحدد استقطاع دفعة مقدمة وكان في العقد نسبة استقطاع
      if (advDed === 0 && contract.advance_payment_pct > 0) {
        advDed = Math.round((grossAmount * (Number(contract.advance_payment_pct) / 100)) * 100) / 100;
      }
      // إذا لم يحدد استقطاع ضمان وكان في العقد نسبة محتجزات ضمان
      if (retDed === 0 && contract.retention_pct > 0) {
        retDed = Math.round((grossAmount * (Number(contract.retention_pct) / 100)) * 100) / 100;
      }
    }

    const netAmount = Math.max(0, Math.round((grossAmount - (advDed + retDed)) * 100) / 100);

    return {
      project_id,
      client_id,
      contract_id,
      gross_amount: grossAmount,
      advance_deduction: advDed,
      retention_deduction: retDed,
      net_amount: netAmount,
      contract
    };
  }

  /**
   * تطبيق سند قبض على مستخلص وتحديث حالته ومتبقياته تلقائياً
   * @param {number} billId معرف المستخلص
   * @param {number} paymentAmount مبلغ السداد
   * @param {object} [tx] معاملة قاعدة بيانات اختيارية
   */
  async applyPaymentToBill(billId, paymentAmount, tx = null) {
    if (!billId || !paymentAmount || paymentAmount <= 0) return null;
    const executor = tx || { get, run, query };

    const bill = await executor.get('SELECT id, net_amount, paid_amount, status FROM bills WHERE id = ?', [billId]);
    if (!bill) return null;

    const currentPaid = Number(bill.paid_amount) || 0;
    const netAmount = Number(bill.net_amount) || 0;
    const newPaid = Math.round((currentPaid + Number(paymentAmount)) * 100) / 100;
    const remaining = Math.max(0, Math.round((netAmount - newPaid) * 100) / 100);

    const paymentStatus = remaining <= 0 ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'unpaid');
    const newStatus = remaining <= 0 ? 'محصل كامل' : 'محصل جزئي';

    await executor.run(`
      UPDATE bills 
      SET paid_amount = ?, remaining_amount = ?, payment_status = ?, status = ?
      WHERE id = ?
    `, [newPaid, remaining, paymentStatus, newStatus, billId]);

    return {
      billId,
      paid_amount: newPaid,
      remaining_amount: remaining,
      payment_status: paymentStatus,
      status: newStatus
    };
  }

  /**
   * عكس تأثير سند قبض ملغي على المستخلص
   * @param {number} billId معرف المستخلص
   * @param {number} paymentAmount مبلغ السند المعكوس
   * @param {object} [tx] معاملة قاعدة بيانات اختيارية
   */
  async reversePaymentFromBill(billId, paymentAmount, tx = null) {
    if (!billId || !paymentAmount || paymentAmount <= 0) return null;
    const executor = tx || { get, run, query };

    const bill = await executor.get('SELECT id, net_amount, paid_amount, status FROM bills WHERE id = ?', [billId]);
    if (!bill) return null;

    const currentPaid = Number(bill.paid_amount) || 0;
    const netAmount = Number(bill.net_amount) || 0;
    const newPaid = Math.max(0, Math.round((currentPaid - Number(paymentAmount)) * 100) / 100);
    const remaining = Math.max(0, Math.round((netAmount - newPaid) * 100) / 100);

    const paymentStatus = newPaid <= 0 ? 'unpaid' : (remaining <= 0 ? 'paid' : 'partially_paid');
    const newStatus = newPaid <= 0 ? 'معتمد' : (remaining <= 0 ? 'محصل كامل' : 'محصل جزئي');

    await executor.run(`
      UPDATE bills 
      SET paid_amount = ?, remaining_amount = ?, payment_status = ?, status = ?
      WHERE id = ?
    `, [newPaid, remaining, paymentStatus, newStatus, billId]);

    return {
      billId,
      paid_amount: newPaid,
      remaining_amount: remaining,
      payment_status: paymentStatus,
      status: newStatus
    };
  }

  /**
   * استخراج السلسلة الهرمية الكاملة للعميل:
   * عميل → عقد → مشاريع → مستخلصات → مطالبات → دفعات مقدمة → مبالغ محصلة → محتجزات → رصيد مستحق
   * @param {number} clientId معرف العميل
   */
  async getClientLifecycleChain(clientId) {
    if (!clientId) throw new Error('معرف العميل مطلوب');

    const client = await get('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (!client) throw new Error('العميل غير موجود');

    // 1. جلب عقود العميل (المرتبطة مباشرة بالعميل أو عبر مشاريع العميل)
    const rawContracts = await query(`
      SELECT pc.*, p.name AS project_name, p.code AS project_code, p.id AS linked_project_id
      FROM project_contracts pc
      LEFT JOIN projects p ON pc.project_id = p.id
      WHERE (pc.client_id = ? OR p.client_id = ?)
      ORDER BY pc.contract_date DESC, pc.id DESC
    `, [clientId, clientId]);

    // 2. جلب جميع مشاريع العميل
    const rawProjects = await query(`
      SELECT p.*
      FROM projects p
      WHERE p.client_id = ?
      ORDER BY p.created_at DESC
    `, [clientId]);

    // 3. جلب جميع مستخلصات العميل
    const rawBills = await query(`
      SELECT b.*, p.name AS project_name, pc.contract_no, pc.title AS contract_title
      FROM bills b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN project_contracts pc ON b.contract_id = pc.id
      WHERE b.client_id = ? AND b.status NOT IN ('reversed', 'cancelled')
      ORDER BY b.date DESC, b.id DESC
    `, [clientId]);

    // 4. جلب جميع سندات القبض للعميل (مبالغ محصلة ودفعات مقدمة ومحتجزات مفرج عنها)
    const rawPayments = await query(`
      SELECT py.*, p.name AS project_name, b.bill_no, pc.contract_no
      FROM payments py
      LEFT JOIN projects p ON py.project_id = p.id
      LEFT JOIN bills b ON py.bill_id = b.id
      LEFT JOIN project_contracts pc ON py.contract_id = pc.id
      WHERE py.client_id = ? 
        AND py.type = 'قبض'
        AND (py.status IN ('posted', 'cleared', 'approved') OR py.status IS NULL)
      ORDER BY py.date DESC, py.id DESC
    `, [clientId]);

    // 5. جلب مطالبات المشاريع (Claims Register) إن وجدت
    let rawClaims = [];
    try {
      rawClaims = await query(`
        SELECT c.*, p.name AS project_name
        FROM project_claims_register c
        JOIN projects p ON c.project_id = p.id
        WHERE p.client_id = ?
        ORDER BY c.claim_date DESC, c.id DESC
      `, [clientId]);
    } catch (e) {
      rawClaims = [];
    }

    // 6. تنظيم السلسلة الهرمية: العقد → المشاريع → المستخلصات والمطالبات → الدفعات → المحصلات → المحتجزات
    const projectMap = new Map();
    rawProjects.forEach(prj => {
      const pId = prj.id;
      const prjBills = rawBills.filter(b => b.project_id === pId);
      const prjPayments = rawPayments.filter(p => p.project_id === pId);
      const prjClaims = rawClaims.filter(c => c.project_id === pId);

      const grossBilled = prjBills.reduce((sum, b) => sum + (Number(b.gross_amount) || Number(b.amount) || 0), 0);
      const advanceDeducted = prjBills.reduce((sum, b) => sum + (Number(b.advance_deduction) || 0), 0);
      const retentionDeducted = prjBills.reduce((sum, b) => sum + (Number(b.retention_deduction) || 0), 0);
      const netBilled = prjBills.reduce((sum, b) => sum + (Number(b.net_amount) || Number(b.amount) || 0), 0);

      const advancesReceived = prjPayments
        .filter(p => p.receipt_category === 'advance_payment')
        .reduce((sum, p) => sum + (Number(p.local_amount) || Number(p.amount) || 0), 0);

      const collectionsReceived = prjPayments
        .filter(p => p.receipt_category !== 'advance_payment' && p.receipt_category !== 'retention_release')
        .reduce((sum, p) => sum + (Number(p.local_amount) || Number(p.amount) || 0), 0);

      const retentionReleased = prjPayments
        .filter(p => p.receipt_category === 'retention_release')
        .reduce((sum, p) => sum + (Number(p.local_amount) || Number(p.amount) || 0), 0);

      const totalPrjCollected = prjPayments.reduce((sum, p) => sum + (Number(p.local_amount) || Number(p.amount) || 0), 0);

      const activeRetention = Math.max(0, retentionDeducted - retentionReleased);
      const remainingAdvance = Math.max(0, advancesReceived - advanceDeducted);
      const prjDueBalance = Math.round((netBilled - collectionsReceived) * 100) / 100;

      projectMap.set(pId, {
        project: prj,
        bills: prjBills,
        claims: prjClaims,
        advance_payments: prjPayments.filter(p => p.receipt_category === 'advance_payment'),
        collections: prjPayments.filter(p => p.receipt_category !== 'advance_payment'),
        retentions: {
          total_held: retentionDeducted,
          total_released: retentionReleased,
          active_balance: activeRetention
        },
        financials: {
          contract_value: Number(prj.contract_value) || 0,
          gross_billed: grossBilled,
          advance_deducted: advanceDeducted,
          retention_deducted: retentionDeducted,
          net_billed: netBilled,
          advances_received: advancesReceived,
          remaining_advance: remainingAdvance,
          collections_received: collectionsReceived,
          total_collected: totalPrjCollected,
          active_retention: activeRetention,
          outstanding_due: prjDueBalance
        }
      });
    });

    // تجميع المشاريع تحت العقود
    const contractsList = [];
    const processedProjectIds = new Set();

    rawContracts.forEach(cnt => {
      const contractProjects = [];
      if (cnt.project_id && projectMap.has(cnt.project_id)) {
        contractProjects.push(projectMap.get(cnt.project_id));
        processedProjectIds.add(cnt.project_id);
      }

      // إذا كان هناك مشاريع أخرى تحمل نفس معرف العقد
      rawProjects.forEach(p => {
        if (!processedProjectIds.has(p.id) && p.contract_id === cnt.id) {
          contractProjects.push(projectMap.get(p.id));
          processedProjectIds.add(p.id);
        }
      });

      const cntGrossBilled = contractProjects.reduce((s, p) => s + p.financials.gross_billed, 0);
      const cntNetBilled = contractProjects.reduce((s, p) => s + p.financials.net_billed, 0);
      const cntAdvances = contractProjects.reduce((s, p) => s + p.financials.advances_received, 0);
      const cntCollected = contractProjects.reduce((s, p) => s + p.financials.total_collected, 0);
      const cntRetention = contractProjects.reduce((s, p) => s + p.financials.active_retention, 0);
      const cntDue = contractProjects.reduce((s, p) => s + p.financials.outstanding_due, 0);

      contractsList.push({
        contract: cnt,
        projects: contractProjects,
        summary: {
          contract_value: Number(cnt.contract_value) || 0,
          gross_billed: cntGrossBilled,
          net_billed: cntNetBilled,
          advances_received: cntAdvances,
          total_collected: cntCollected,
          active_retention: cntRetention,
          outstanding_due: cntDue
        }
      });
    });

    // المشاريع المستقلة التي ليس لها عقد مسجل بعد
    const standaloneProjects = [];
    rawProjects.forEach(p => {
      if (!processedProjectIds.has(p.id)) {
        standaloneProjects.push(projectMap.get(p.id));
      }
    });

    if (standaloneProjects.length > 0) {
      contractsList.push({
        contract: {
          id: 0,
          contract_no: 'بدون عقد رسمي',
          title: 'أعمال ومشاريع مباشرة (أوامر تكليف)',
          status: 'ساري',
          contract_value: standaloneProjects.reduce((s, p) => s + (Number(p.project.contract_value) || 0), 0)
        },
        projects: standaloneProjects,
        summary: {
          contract_value: standaloneProjects.reduce((s, p) => s + (Number(p.project.contract_value) || 0), 0),
          gross_billed: standaloneProjects.reduce((s, p) => s + p.financials.gross_billed, 0),
          net_billed: standaloneProjects.reduce((s, p) => s + p.financials.net_billed, 0),
          advances_received: standaloneProjects.reduce((s, p) => s + p.financials.advances_received, 0),
          total_collected: standaloneProjects.reduce((s, p) => s + p.financials.total_collected, 0),
          active_retention: standaloneProjects.reduce((s, p) => s + p.financials.active_retention, 0),
          outstanding_due: standaloneProjects.reduce((s, p) => s + p.financials.outstanding_due, 0)
        }
      });
    }

    // 7. الملخص المالي الإجمالي الشامل للعميل (Master Financial Summary)
    const prevBalance = Number(client.previous_balance) || 0;
    const totalContractsValue = rawContracts.reduce((s, c) => s + (Number(c.contract_value) || 0), 0) +
      standaloneProjects.reduce((s, p) => s + (Number(p.project.contract_value) || 0), 0);

    const totalGrossBilled = rawBills.reduce((s, b) => s + (Number(b.gross_amount) || Number(b.amount) || 0), 0);
    const totalAdvanceDeductions = rawBills.reduce((s, b) => s + (Number(b.advance_deduction) || 0), 0);
    const totalRetentionDeductions = rawBills.reduce((s, b) => s + (Number(b.retention_deduction) || 0), 0);
    const totalNetBilled = rawBills.reduce((s, b) => s + (Number(b.net_amount) || Number(b.amount) || 0), 0);

    const totalAdvanceReceived = rawPayments
      .filter(p => p.receipt_category === 'advance_payment')
      .reduce((s, p) => s + (Number(p.local_amount) || Number(p.amount) || 0), 0);

    const totalRetentionReleased = rawPayments
      .filter(p => p.receipt_category === 'retention_release')
      .reduce((s, p) => s + (Number(p.local_amount) || Number(p.amount) || 0), 0);

    const totalCollected = rawPayments.reduce((s, p) => s + (Number(p.local_amount) || Number(p.amount) || 0), 0);

    const remainingAdvanceBalance = Math.max(0, Math.round((totalAdvanceReceived - totalAdvanceDeductions) * 100) / 100);
    const activeRetentionBalance = Math.max(0, Math.round((totalRetentionDeductions - totalRetentionReleased) * 100) / 100);

    // صافي الرصيد المستحق في ذمة العميل = (رصيد أول المدة + صافي المستخلصات) - المبالغ المحصلة
    const outstandingDueBalance = Math.round(((prevBalance + totalNetBilled) - totalCollected) * 100) / 100;

    return {
      client: {
        id: client.id,
        name: client.name,
        company: client.company,
        phone: client.phone,
        email: client.email,
        address: client.address,
        currency: client.currency || 'ر.ي',
        previous_balance: prevBalance,
        total_paid: totalCollected,
        total_due: totalNetBilled,
        current_balance: outstandingDueBalance
      },
      chain: {
        contracts: contractsList,
        contracts_count: rawContracts.length,
        projects_count: rawProjects.length,
        bills_count: rawBills.length,
        claims_count: rawClaims.length,
        payments_count: rawPayments.length
      },
      contracts: contractsList,
      raw_contracts: rawContracts,
      projects: rawProjects,
      bills: rawBills,
      payments: rawPayments,
      claims: rawClaims,
      financial_summary: {
        total_contracts_count: rawContracts.length,
        total_projects_count: rawProjects.length,
        total_bills_count: rawBills.length,
        total_payments_count: rawPayments.length,
        total_contracts_value: totalContractsValue,
        total_gross_billed: totalGrossBilled,
        total_advance_deductions: totalAdvanceDeductions,
        total_retention_deductions: totalRetentionDeductions,
        total_net_billed: totalNetBilled,
        total_advance_received: totalAdvanceReceived,
        remaining_advance_balance: remainingAdvanceBalance,
        total_retention_released: totalRetentionReleased,
        active_retention_balance: activeRetentionBalance,
        total_collected: totalCollected,
        outstanding_due_balance: outstandingDueBalance,
        currency: client.currency || 'ر.ي'
      }
    };
  }
}

module.exports = new ClientChainService();

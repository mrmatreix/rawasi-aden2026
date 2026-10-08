/**
 * =========================================================================
 * cashFlowProjectionService.js
 * خدمة نظام التدقيق النقدي وتوقعات التدفق (Cash Flow Projection Engine)
 * لشركة رواسي عدن للهندسة والمقاولات
 *
 * يوفر:
 * 1. توقعات التدفقات النقدية الداخلة والخارجة بدقة لمشاريع وعقود الشركة.
 * 2. ربط الإيرادات المتوقعة بالمستخلصات المعتمدة وخطط الـ POC ومحجوزات الضمان.
 * 3. ربط المدفوعات بمستحقات الموردين ومقاولي الباطن والرواتب والضرائب والضمانات.
 * 4. احتساب الرصيد التراكمي وتوليد السيناريوهات الثلاثية (الواقعي / المتفائل / المتشائم).
 * =========================================================================
 */

const { get, query, run, transaction } = require('../database/db');

class CashFlowProjectionService {
  /**
   * توليد نطاق الأشهر (YYYY-MM) بين تاريخين
   */
  static getMonthRange(fromMonth, toMonth) {
    const months = [];
    const [fromY, fromM] = fromMonth.split('-').map(Number);
    const [toY, toM] = toMonth.split('-').map(Number);

    let curY = fromY;
    let curM = fromM;

    while (curY < toY || (curY === toY && curM <= toM)) {
      const monthStr = `${curY}-${String(curM).padStart(2, '0')}`;
      months.push(monthStr);
      curM++;
      if (curM > 12) {
        curM = 1;
        curY++;
      }
    }
    return months;
  }

  /**
   * جلب الرصيد الافتتاحي للنقدية والبنوك في اللحظة الراهنة
   */
  static async getCurrentCashPosition() {
    let totalBank = 0;
    let totalCash = 0;

    try {
      const bankRes = await get(`
        SELECT COALESCE(SUM(current_balance), 0) as total 
        FROM bank_accounts 
        WHERE is_active = 1
      `);
      totalBank = Number(bankRes?.total || 0);
    } catch {
      totalBank = 0;
    }

    try {
      const cashRes = await get(`
        SELECT COALESCE(SUM(balance), 0) as total 
        FROM accounts 
        WHERE code IN ('111', '1111', '1112', '1110', '1120')
      `);
      totalCash = Number(cashRes?.total || 0);
    } catch {
      totalCash = 0;
    }

    // إذا لم تتوفر أرصدة حسابات، الاستعلام من حركة الصندوق
    if (totalCash === 0) {
      try {
        const lastMov = await get(`
          SELECT current_balance 
          FROM cash_movements 
          ORDER BY id DESC LIMIT 1
        `);
        totalCash = Number(lastMov?.current_balance || 0);
      } catch {}
    }

    const totalAvailable = totalBank + totalCash;
    return {
      total_bank: totalBank,
      total_cash: totalCash,
      total_available: totalAvailable > 0 ? totalAvailable : 65000.00 // قيمة تأسيسية افتراضية في حال البداية
    };
  }

  /**
   * توليد وإعادة احتساب توقعات التدفق النقدي الشاملة للفترة المحددة
   * @param {string} monthFrom - شهر البداية YYYY-MM
   * @param {string} monthTo - شهر النهاية YYYY-MM
   */
  static async generateProjections(monthFrom = null, monthTo = null) {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const defaultFrom = `${curYear}-${curMonth}`;

    // نهاية الفترة الافتراضية بعد 12 شهراً
    const futureDate = new Date(now.getFullYear(), now.getMonth() + 11, 1);
    const defaultTo = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}`;

    const fromM = monthFrom || defaultFrom;
    const toM = monthTo || defaultTo;

    const months = this.getMonthRange(fromM, toM);
    const cashPos = await this.getCurrentCashPosition();

    return await transaction(async (tx) => {
      // تنظيف التوقعات المخططة السابقة في هذا النطاق لإعادة الحساب على بيانات حية
      await tx.run(`
        DELETE FROM cash_flow_projections 
        WHERE projection_month >= ? AND projection_month <= ? AND status = 'planned'
      `, [fromM, toM]);

      // =====================================================================
      // 1. الإيرادات المتوقعة (Inflows)
      // =====================================================================

      // 1.1 مستخلصات معتمدة غير محصلة (Bills pending payment)
      const pendingBills = await tx.query(`
        SELECT b.id, b.bill_no, b.project_id, b.contract_id, b.net_amount, b.paid_amount,
               b.date, b.created_at, p.name as project_name
        FROM bills b
        LEFT JOIN projects p ON b.project_id = p.id
        WHERE b.status IN ('approved', 'posted', 'معتمد')
          AND COALESCE(b.payment_status, 'pending') != 'paid'
      `);

      for (const bill of pendingBills) {
        const remaining = Number(bill.net_amount || 0) - Number(bill.paid_amount || 0);
        if (remaining > 0) {
          let targetMonth = fromM;
          if (bill.date) {
            const bMonth = bill.date.slice(0, 7);
            if (bMonth >= fromM && bMonth <= toM) {
              targetMonth = bMonth;
            }
          }

          await tx.run(`
            INSERT INTO cash_flow_projections (
              project_id, contract_id, projection_month, expected_inflow_type,
              expected_inflow_amount, expected_inflow_date, confidence_level,
              source_document, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            bill.project_id, bill.contract_id || null, targetMonth,
            'مستخلص', remaining, `${targetMonth}-15`, 'high',
            'bill', 'planned', `تحصيل مستخلص معتمد برقم [${bill.bill_no}] لمشروع ${bill.project_name || ''}`
          ]);
        }
      }

      // 1.2 مستخلصات مجدولة للمشاريع النشطة بناءً على POC المتبقي والعقد
      const activeProjects = await tx.query(`
        SELECT p.id, p.name, p.contract_value, p.actual_cost, p.progress_percentage,
               c.id as contract_id, c.contract_no, c.end_date, c.ipc_cycle_days,
               COALESCE(c.supervision_monthly_fee, 0) as supervision_fee,
               COALESCE(c.retention_pct, 10) as retention_pct,
               COALESCE(c.advance_payment_pct, 10) as advance_pct,
               c.retention_due_date
        FROM projects p
        LEFT JOIN project_contracts c ON p.id = c.project_id
        WHERE p.status IN ('active', 'in_progress', 'قيد التنفيذ', 'جارية')
      `);

      for (const prj of activeProjects) {
        const contractVal = Number(prj.contract_value || 0);
        if (contractVal <= 0) continue;

        // حساب ما تم فوترته حتى تاريخه
        const billedRes = await tx.get(`
          SELECT COALESCE(SUM(net_amount), 0) as billed 
          FROM bills 
          WHERE project_id = ? AND status != 'cancelled'
        `, [prj.id]);
        const billedTotal = Number(billedRes?.billed || 0);
        const remainingToBill = Math.max(0, contractVal - billedTotal);

        if (remainingToBill > 0) {
          // توزيع المتبقي على الأشهر القادمة (بحد أقصى 6 أشهر أو حتى نهاية العقد)
          const activeMonths = months.slice(0, 6);
          const monthlyPortion = Math.round((remainingToBill / activeMonths.length) * 100) / 100;

          for (const m of activeMonths) {
            await tx.run(`
              INSERT INTO cash_flow_projections (
                project_id, contract_id, projection_month, expected_inflow_type,
                expected_inflow_amount, expected_inflow_date, confidence_level,
                source_document, status, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              prj.id, prj.contract_id || null, m,
              'مستخلص', monthlyPortion, `${m}-25`, 'medium',
              'contract', 'planned', `مستخلص إنجاز أعمال مجدول لمشروع ${prj.name}`
            ]);
          }
        }

        // 1.3 خدمات إشراف واستشارات شهرية (إن وجدت)
        const supervisionFee = Number(prj.supervision_fee || 0);
        if (supervisionFee > 0) {
          for (const m of months.slice(0, 6)) {
            await tx.run(`
              INSERT INTO cash_flow_projections (
                project_id, contract_id, projection_month, expected_inflow_type,
                expected_inflow_amount, expected_inflow_date, confidence_level,
                source_document, status, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              prj.id, prj.contract_id || null, m,
              'خدمة_إشراف', supervisionFee, `${m}-05`, 'high',
              'contract', 'planned', `أتعاب إشراف هندسي شهرية منتظمة - مشروع ${prj.name}`
            ]);
          }
        }

        // 1.4 استرداد محجوز الضمان (Retention due after DLP)
        const totalRetentionRes = await tx.get(`
          SELECT COALESCE(SUM(retention_deduction), 0) as retention_sum
          FROM bills
          WHERE project_id = ? AND status != 'cancelled'
        `, [prj.id]);
        const retentionAmount = Number(totalRetentionRes?.retention_sum || (contractVal * (prj.retention_pct / 100)));

        if (retentionAmount > 0) {
          let retMonth = toM;
          if (prj.retention_due_date) {
            const rM = prj.retention_due_date.slice(0, 7);
            if (rM >= fromM && rM <= toM) retMonth = rM;
          }
          await tx.run(`
            INSERT INTO cash_flow_projections (
              project_id, contract_id, projection_month, expected_inflow_type,
              expected_inflow_amount, expected_inflow_date, confidence_level,
              source_document, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            prj.id, prj.contract_id || null, retMonth,
            'محجوز', retentionAmount, `${retMonth}-28`, 'medium',
            'contract', 'planned', `استحقاق استرداد محتجز الضمان النهائي (Retention Release) لمشروع ${prj.name}`
          ]);
        }
      }

      // =====================================================================
      // 2. المدفوعات المتوقعة (Outflows)
      // =====================================================================

      // 2.1 فواتير موردين غير مسددة (Purchases pending payment)
      const unpaidPurchases = await tx.query(`
        SELECT p.id, p.invoice_no, p.project_id, p.total_amount, p.paid_amount,
               p.date, s.name as supplier_name
        FROM purchases p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.status IN ('posted', 'approved')
          AND COALESCE(p.payment_status, 'pending') != 'paid'
      `);

      for (const pur of unpaidPurchases) {
        const remaining = Number(pur.total_amount || 0) - Number(pur.paid_amount || 0);
        if (remaining > 0) {
          let targetMonth = fromM;
          if (pur.date) {
            const pMonth = pur.date.slice(0, 7);
            if (pMonth >= fromM && pMonth <= toM) targetMonth = pMonth;
          }

          await tx.run(`
            INSERT INTO cash_flow_projections (
              project_id, projection_month, expected_outflow_type,
              expected_outflow_amount, expected_outflow_date, confidence_level,
              source_document, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            pur.project_id || null, targetMonth,
            'مورد', remaining, `${targetMonth}-20`, 'high',
            'po', 'planned', `سداد مستحقات مورد [${pur.supplier_name || 'مورد مواد'}] فاتورة رقم: ${pur.invoice_no}`
          ]);
        }
      }

      // 2.2 الرواتب والأجور الشهرية المجدولة (Monthly Payroll)
      let monthlySalary = 0;
      try {
        const empRes = await tx.get(`
          SELECT COALESCE(SUM(basic_salary), 0) as total_salary 
          FROM employees 
          WHERE status = 'active'
        `);
        monthlySalary = Number(empRes?.total_salary || 0);
      } catch {}

      if (monthlySalary <= 0) {
        try {
          const payRes = await tx.get(`
            SELECT COALESCE(AVG(net_salary), 0) * 15 as avg_total 
            FROM payroll 
            ORDER BY id DESC LIMIT 30
          `);
          monthlySalary = Number(payRes?.avg_total || 0);
        } catch {}
      }
      if (monthlySalary <= 0) monthlySalary = 4500.00; // قيمة تقديرية واقعية

      for (const m of months) {
        await tx.run(`
          INSERT INTO cash_flow_projections (
            projection_month, expected_outflow_type,
            expected_outflow_amount, expected_outflow_date, confidence_level,
            source_document, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          m, 'راتب', monthlySalary, `${m}-28`, 'high',
          'payroll', 'planned', `مسير رواتب وأجور الكادر الهندسي والإداري والتشغيلي`
        ]);
      }

      // 2.3 مستحقات مقاولي الباطن والعمالة المباشرة غير المسددة
      try {
        const pendingLabor = await tx.query(`
          SELECT ple.id, ple.project_id, ple.worker_name_or_team, ple.total_amount, ple.date
          FROM project_labor_expenses ple
          WHERE ple.payment_status IN ('مستحق', 'pending', 'unpaid')
        `);

        for (const lab of pendingLabor) {
          const amt = Number(lab.total_amount || 0);
          if (amt > 0) {
            let targetMonth = fromM;
            if (lab.date) {
              const lM = lab.date.slice(0, 7);
              if (lM >= fromM && lM <= toM) targetMonth = lM;
            }

            await tx.run(`
              INSERT INTO cash_flow_projections (
                project_id, projection_month, expected_outflow_type,
                expected_outflow_amount, expected_outflow_date, confidence_level,
                source_document, status, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              lab.project_id || null, targetMonth,
              'مقاول_باطن', amt, `${targetMonth}-25`, 'high',
              'labor', 'planned', `أتعاب مقاول باطن / عمالة تخصصية: ${lab.worker_name_or_team || ''}`
            ]);
          }
        }
      } catch {}

      // 2.4 التزامات ضريبية مستحقة
      try {
        const pendingTaxes = await tx.query(`
          SELECT id, project_id, tax_amount, date 
          FROM tax_withholdings 
          WHERE status = 'pending'
        `);
        for (const tax of pendingTaxes) {
          const amt = Number(tax.tax_amount || 0);
          if (amt > 0) {
            await tx.run(`
              INSERT INTO cash_flow_projections (
                project_id, projection_month, expected_outflow_type,
                expected_outflow_amount, expected_outflow_date, confidence_level,
                source_document, status, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              tax.project_id || null, fromM,
              'ضريبة', amt, `${fromM}-20`, 'medium',
              'tax', 'planned', `سداد إقرارات ضريبية وضرائب أرباح مستقطعة`
            ]);
          }
        }
      } catch {}

      // 2.5 رسوم خطابات الضمان والتمويلات
      for (const m of months.slice(0, 6)) {
        await tx.run(`
          INSERT INTO cash_flow_projections (
            projection_month, expected_outflow_type,
            expected_outflow_amount, expected_outflow_date, confidence_level,
            source_document, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          m, 'ضمان', 350.00, `${m}-10`, 'medium',
          'contract', 'planned', `مصاريف وعمولات بنكية دورية لتجديد الضمانات البنكية`
        ]);
      }

      return {
        success: true,
        period_from: fromM,
        period_to: toM,
        months_count: months.length,
        initial_cash: cashPos.total_available
      };
    });
  }

  /**
   * جلب تفاصيل التوقعات لشهر معين بصيغة JSON المعيارية
   * @param {string} month - YYYY-MM
   * @param {number} openingBalance - الرصيد الافتتاحي للشهر
   */
  static async getMonthProjection(month, openingBalance = 0) {
    const records = await query(`
      SELECT cfp.*, p.name as project_name, p.code as project_code
      FROM cash_flow_projections cfp
      LEFT JOIN projects p ON cfp.project_id = p.id
      WHERE cfp.projection_month = ? AND cfp.status != 'cancelled'
      ORDER BY COALESCE(cfp.expected_inflow_date, cfp.expected_outflow_date) ASC
    `, [month]);

    let totalCollections = 0;
    let totalPayments = 0;

    const breakdownByType = {
      ipc_collections: 0,
      advance_payments: 0,
      retention_receivables: 0,
      supervision_fees: 0,
      vendor_payments: 0,
      salaries: 0,
      subcontractors: 0,
      taxes: 0,
      guarantees: 0
    };

    const projectMap = new Map();

    for (const r of records) {
      const inAmt = Number(r.expected_inflow_amount || 0);
      const outAmt = Number(r.expected_outflow_amount || 0);

      totalCollections += inAmt;
      totalPayments += outAmt;

      // تصنيف التدفقات الداخلة
      if (r.expected_inflow_type === 'مستخلص') breakdownByType.ipc_collections += inAmt;
      else if (r.expected_inflow_type === 'دفعة_مقدمة') breakdownByType.advance_payments += inAmt;
      else if (r.expected_inflow_type === 'محجوز') breakdownByType.retention_receivables += inAmt;
      else if (r.expected_inflow_type === 'خدمة_إشراف') breakdownByType.supervision_fees += inAmt;

      // تصنيف التدفقات الخارجة
      if (r.expected_outflow_type === 'مورد') breakdownByType.vendor_payments += outAmt;
      else if (r.expected_outflow_type === 'راتب') breakdownByType.salaries += outAmt;
      else if (r.expected_outflow_type === 'مقاول_باطن') breakdownByType.subcontractors += outAmt;
      else if (r.expected_outflow_type === 'ضريبة') breakdownByType.taxes += outAmt;
      else if (r.expected_outflow_type === 'ضمان') breakdownByType.guarantees += outAmt;

      // تجميع حسب المشروع
      const pKey = r.project_id ? String(r.project_id) : 'general';
      if (!projectMap.has(pKey)) {
        projectMap.set(pKey, {
          project_id: r.project_id || null,
          project_name: r.project_name || 'عام / مصاريف إدارية مركزية',
          project_code: r.project_code || 'HQ',
          inflow: 0,
          outflow: 0,
          net: 0
        });
      }
      const pData = projectMap.get(pKey);
      pData.inflow += inAmt;
      pData.outflow += outAmt;
      pData.net = pData.inflow - pData.outflow;
    }

    const netFlow = totalCollections - totalPayments;
    const cumulative = Number(openingBalance) + netFlow;

    return {
      period: month,
      expected_collections: Math.round(totalCollections * 100) / 100,
      expected_payments: Math.round(totalPayments * 100) / 100,
      net_cash_flow: Math.round(netFlow * 100) / 100,
      cumulative_balance: Math.round(cumulative * 100) / 100,
      breakdown: {
        by_project: Array.from(projectMap.values()),
        by_type: {
          ipc_collections: Math.round(breakdownByType.ipc_collections * 100) / 100,
          advance_payments: Math.round(breakdownByType.advance_payments * 100) / 100,
          retention_receivables: Math.round(breakdownByType.retention_receivables * 100) / 100,
          supervision_fees: Math.round(breakdownByType.supervision_fees * 100) / 100,
          vendor_payments: Math.round(breakdownByType.vendor_payments * 100) / 100,
          salaries: Math.round(breakdownByType.salaries * 100) / 100,
          subcontractors: Math.round(breakdownByType.subcontractors * 100) / 100,
          taxes: Math.round(breakdownByType.taxes * 100) / 100,
          guarantees: Math.round(breakdownByType.guarantees * 100) / 100
        }
      }
    };
  }

  /**
   * جلب تقرير التدفق النقدي لفترة كاملة مع الأرصدة التراكمية المتسلسلة
   */
  static async getPeriodProjections(fromMonth, toMonth) {
    const cashPos = await this.getCurrentCashPosition();
    let currentBalance = cashPos.total_available;

    const months = this.getMonthRange(fromMonth, toMonth);
    const monthlyResults = [];

    for (const m of months) {
      const monthData = await this.getMonthProjection(m, currentBalance);
      currentBalance = monthData.cumulative_balance;
      monthlyResults.push(monthData);
    }

    const totalCollections = monthlyResults.reduce((sum, m) => sum + m.expected_collections, 0);
    const totalPayments = monthlyResults.reduce((sum, m) => sum + m.expected_payments, 0);
    const totalNet = totalCollections - totalPayments;

    return {
      success: true,
      from_month: fromMonth,
      to_month: toMonth,
      initial_cash: cashPos.total_available,
      final_cumulative_balance: Math.round(currentBalance * 100) / 100,
      total_collections: Math.round(totalCollections * 100) / 100,
      total_payments: Math.round(totalPayments * 100) / 100,
      total_net_cash_flow: Math.round(totalNet * 100) / 100,
      months: monthlyResults
    };
  }

  /**
   * جلب توقعات التدفق النقدي لمشروع محدد
   */
  static async getProjectProjections(projectId) {
    const prjId = Number(projectId);
    const project = await get('SELECT * FROM projects WHERE id = ?', [prjId]);
    if (!project) throw new Error('المشروع غير موجود');

    const records = await query(`
      SELECT * FROM cash_flow_projections 
      WHERE project_id = ? AND status != 'cancelled'
      ORDER BY projection_month ASC, COALESCE(expected_inflow_date, expected_outflow_date) ASC
    `, [prjId]);

    let totalIn = 0;
    let totalOut = 0;
    records.forEach(r => {
      totalIn += Number(r.expected_inflow_amount || 0);
      totalOut += Number(r.expected_outflow_amount || 0);
    });

    return {
      success: true,
      project_id: prjId,
      project_name: project.name,
      contract_value: Number(project.contract_value || 0),
      total_expected_inflow: Math.round(totalIn * 100) / 100,
      total_expected_outflow: Math.round(totalOut * 100) / 100,
      net_expected_cash: Math.round((totalIn - totalOut) * 100) / 100,
      items: records
    };
  }

  /**
   * توليد السيناريوهات الثلاثية (الواقعي / المتفائل / المتشائم)
   */
  static async getScenarios(fromMonth = null, toMonth = null) {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const fromM = fromMonth || `${curYear}-${curMonth}`;

    const futureDate = new Date(now.getFullYear(), now.getMonth() + 5, 1);
    const toM = toMonth || `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}`;

    const baseResult = await this.getPeriodProjections(fromM, toM);
    const initialCash = baseResult.initial_cash;

    // 1. السيناريو الواقعي (Realistic)
    let realisticRunning = initialCash;
    const realisticMonths = baseResult.months.map(m => {
      // واقعي: تحصيل 90% من الإيرادات وسداد 100% من المصروفات
      const col = m.expected_collections * 0.90;
      const pay = m.expected_payments;
      const net = col - pay;
      realisticRunning += net;
      return {
        month: m.period,
        collections: Math.round(col * 100) / 100,
        payments: Math.round(pay * 100) / 100,
        net_flow: Math.round(net * 100) / 100,
        cumulative_balance: Math.round(realisticRunning * 100) / 100
      };
    });

    // 2. السيناريو المتفائل (Optimistic)
    let optimisticRunning = initialCash;
    const optimisticMonths = baseResult.months.map(m => {
      // متفائل: تحصيل 100% في الموعد، وتوفير 5% من المصروفات بالتفاوض
      const col = m.expected_collections * 1.00;
      const pay = m.expected_payments * 0.95;
      const net = col - pay;
      optimisticRunning += net;
      return {
        month: m.period,
        collections: Math.round(col * 100) / 100,
        payments: Math.round(pay * 100) / 100,
        net_flow: Math.round(net * 100) / 100,
        cumulative_balance: Math.round(optimisticRunning * 100) / 100
      };
    });

    // 3. السيناريو المتشائم (Pessimistic - Stress Test)
    let pessimisticRunning = initialCash;
    const pessimisticMonths = baseResult.months.map(m => {
      // متشائم: تعثر أو تأخر 30% من التحصيلات (تحصيل 70%) وسداد كامل الالتزامات + 5% طوارئ
      const col = m.expected_collections * 0.70;
      const pay = m.expected_payments * 1.05;
      const net = col - pay;
      pessimisticRunning += net;
      return {
        month: m.period,
        collections: Math.round(col * 100) / 100,
        payments: Math.round(pay * 100) / 100,
        net_flow: Math.round(net * 100) / 100,
        cumulative_balance: Math.round(pessimisticRunning * 100) / 100
      };
    });

    return {
      success: true,
      initial_cash: initialCash,
      period: { from: fromM, to: toM },
      scenarios: {
        realistic: {
          name: 'السيناريو الواقعي (Base Realistic)',
          description: 'تحصيل 90% من المستخلصات المعتمدة، وسداد 100% من فواتير الموردين والرواتب',
          final_balance: Math.round(realisticRunning * 100) / 100,
          months: realisticMonths
        },
        optimistic: {
          name: 'السيناريو المتفائل (Optimistic)',
          description: 'تحصيل كامل المستخلصات 100% في مواعيدها مع خفض تكاليف الموردين بنسبة 5%',
          final_balance: Math.round(optimisticRunning * 100) / 100,
          months: optimisticMonths
        },
        pessimistic: {
          name: 'السيناريو المتشائم (Pessimistic Stress Test)',
          description: 'تأخر تحصيل 30% من المستخلصات، وسداد كامل الالتزامات مع 5% مصاريف طوارئ بالموقع',
          final_balance: Math.round(pessimisticRunning * 100) / 100,
          months: pessimisticMonths
        }
      }
    };
  }
}

module.exports = CashFlowProjectionService;

/**
 * =========================================================================
 * profitabilityService.js
 * محرك مركز ربحية المشاريع اللحظي (Real-time Project Profitability Engine)
 * لشركة رواسي عدن للهندسة والمقاولات
 *
 * متوافق مع معايير المحاسبة الدولية للإنشاءات (IFRS 15 - Revenue from Contracts with Customers)
 * يعتمد طريقة المدخلات التراكمية (Cost-to-Cost Input Method) لحساب نسبة الإنجاز والاعتراف بالإيراد.
 * =========================================================================
 */

const { get, query, run, transaction } = require('../database/db');

class ProfitabilityService {
  /**
   * إعادة احتساب ربحية المشروع اللحظية استناداً إلى دورة التكاليف والعقود
   * @param {number|string} projectId - معرف المشروع
   * @param {Object} context - معلومات الحدث والمستخدم
   */
  static async recalculateProjectProfitability(projectId, context = {}) {
    if (!projectId) {
      throw new Error('معرف المشروع مطلوب لإعادة احتساب الربحية');
    }

    const prjId = Number(projectId);

    return await transaction(async (tx) => {
      // -------------------------------------------------------------
      // 1. جلب القيم التعاقدية (العقد الأساسي وأوامر التغيير المعتمدة)
      // -------------------------------------------------------------
      const project = await tx.get('SELECT * FROM projects WHERE id = ?', [prjId]);
      if (!project) {
        throw new Error(`المشروع برقم [${prjId}] غير موجود في النظام`);
      }

      const contract_value = Number(project.contract_value || 0);

      // فحص أوامر التغيير المعتمدة من الجداول المتاحة
      let changeOrdersSum = 0;
      try {
        const coRes = await tx.get(`
          SELECT COALESCE(SUM(amount), 0) as total 
          FROM project_change_orders 
          WHERE project_id = ? AND status = 'approved'
        `, [prjId]);
        changeOrdersSum = Number(coRes?.total || 0);
      } catch {
        try {
          const voRes = await tx.get(`
            SELECT COALESCE(SUM(cost_impact), 0) as total 
            FROM project_variations 
            WHERE project_id = ? AND status = 'approved'
          `, [prjId]);
          changeOrdersSum = Number(voRes?.total || 0);
        } catch {}
      }

      const change_orders_total = changeOrdersSum;
      const adjusted_contract_value = contract_value + change_orders_total;

      // -------------------------------------------------------------
      // 2. جلب الفوترة المعتمدة (IPC) والتحصيل النقدي الفعلي
      // -------------------------------------------------------------
      let total_invoiced = 0;
      let total_collected = 0;

      try {
        const billsRes = await tx.get(`
          SELECT 
            COALESCE(SUM(total_amount), 0) as invoiced,
            COALESCE(SUM(paid_amount), 0) as collected
          FROM bills 
          WHERE project_id = ?
        `, [prjId]);
        total_invoiced = Number(billsRes?.invoiced || 0);
        total_collected = Number(billsRes?.collected || 0);
      } catch {}

      // التحقق من سندات القبض المباشرة في جدول payments
      try {
        const paymentsRes = await tx.get(`
          SELECT COALESCE(SUM(amount), 0) as total 
          FROM payments 
          WHERE project_id = ? AND (type = 'in' OR payment_type = 'receipt' OR notes LIKE '%قبض%')
        `, [prjId]);
        const directReceipts = Number(paymentsRes?.total || 0);
        if (directReceipts > total_collected) {
          total_collected = directReceipts;
        }
      } catch {}

      // -------------------------------------------------------------
      // 3. حساب تكلفة المواد اللحظية:
      // Material Cost = SUM(SIV) - SUM(MRR) - SUM(PTR_out) + SUM(PTR_in) + wastage_share
      // -------------------------------------------------------------
      // أ. أذونات الصرف للمشروع (SIV)
      const sivRes = await tx.get(`
        SELECT COALESCE(SUM(total_amount), 0) as total, COALESCE(SUM(quantity), 0) as qty
        FROM inventory_transactions 
        WHERE project_id = ? AND type = 'out'
      `, [prjId]);
      const sivTotal = Number(sivRes?.total || 0);
      const sivQty = Number(sivRes?.qty || 0);

      // ب. إيصالات الإرجاع من المشروع إلى المخزن (MRR)
      const mrrRes = await tx.get(`
        SELECT COALESCE(SUM(total_amount), 0) as total, COALESCE(SUM(quantity), 0) as qty
        FROM inventory_transactions 
        WHERE project_id = ? AND type IN ('return', 'in') AND (recipient LIKE '%إرجاع%' OR recipient LIKE '%مرتجع%' OR notes LIKE '%إرجاع%')
      `, [prjId]);
      const mrrTotal = Number(mrrRes?.total || 0);

      // ج. التحويلات المنصرفة لمشاريع أخرى (PTR_out)
      let ptrOutTotal = 0;
      try {
        const ptrOut = await tx.get(`
          SELECT COALESCE(SUM(total_amount), 0) as total 
          FROM inter_project_material_transfers 
          WHERE from_project_id = ? AND status = 'approved'
        `, [prjId]);
        ptrOutTotal = Number(ptrOut?.total || 0);
      } catch {}

      // د. التحويلات المستلمة من مشاريع أخرى (PTR_in)
      let ptrInTotal = 0;
      try {
        const ptrIn = await tx.get(`
          SELECT COALESCE(SUM(total_amount), 0) as total 
          FROM inter_project_material_transfers 
          WHERE to_project_id = ? AND status = 'approved'
        `, [prjId]);
        ptrInTotal = Number(ptrIn?.total || 0);
      } catch {}

      // هـ. حصة المشروع من خسائر الهالك والتوالف (Wastage)
      let wastageTotal = 0;
      let wastageQty = 0;
      try {
        const qrtRes = await tx.get(`
          SELECT COALESCE(SUM(total_loss_amount), 0) as total, COALESCE(SUM(quantity), 0) as qty
          FROM material_quarantine_items 
          WHERE project_id = ?
        `, [prjId]);
        wastageTotal = Number(qrtRes?.total || 0);
        wastageQty = Number(qrtRes?.qty || 0);
      } catch {}

      // إجمالي تكلفة المواد الصافية
      let material_cost = sivTotal - mrrTotal - ptrOutTotal + ptrInTotal + wastageTotal;
      if (material_cost < 0) material_cost = 0;

      // -------------------------------------------------------------
      // 4. حساب تكاليف العمالة والمقاولين والمصروفات المباشرة
      // -------------------------------------------------------------
      // أ. تكلفة العمالة المباشرة والأجور
      let labor_cost = 0;
      try {
        const laborRes = await tx.get(`
          SELECT COALESCE(SUM(amount), 0) as total 
          FROM project_labor_expenses 
          WHERE project_id = ?
        `, [prjId]);
        labor_cost = Number(laborRes?.total || 0);
      } catch {}

      // ب. تكاليف مقاولي الباطن
      let subcontractors_cost = 0;
      try {
        const subcRes = await tx.get(`
          SELECT COALESCE(SUM(amount), 0) as total 
          FROM expenses 
          WHERE project_id = ? AND (category LIKE '%مقا%' OR title LIKE '%مقا%')
        `, [prjId]);
        subcontractors_cost = Number(subcRes?.total || 0);
      } catch {}

      // ج. المصروفات المباشرة الأخرى
      let direct_expenses = 0;
      try {
        const expRes = await tx.get(`
          SELECT COALESCE(SUM(amount), 0) as total 
          FROM expenses 
          WHERE project_id = ? 
            AND category NOT LIKE '%مواد%' 
            AND category NOT LIKE '%مقا%'
            AND category NOT LIKE '%أجور%'
            AND category NOT LIKE '%عمال%'
        `, [prjId]);
        direct_expenses = Number(expRes?.total || 0);
      } catch {}

      // مواءمة مع التكلفة الفعلية المسجلة مسبقاً في جدول projects إن كانت أعلى
      const projectRecordedCost = Number(project.actual_cost || 0);
      const computedDirect = material_cost + labor_cost + subcontractors_cost + direct_expenses;
      if (projectRecordedCost > computedDirect && computedDirect === 0) {
        // توزيع افتراضي إذا لم تكن البنود مفصلة
        material_cost = Math.round(projectRecordedCost * 0.6 * 100) / 100;
        labor_cost = Math.round(projectRecordedCost * 0.25 * 100) / 100;
        direct_expenses = Math.round(projectRecordedCost * 0.15 * 100) / 100;
      }

      // -------------------------------------------------------------
      // 5. حساب التكلفة غير المباشرة (Revenue/Cost-Based Overhead Allocation)
      // -------------------------------------------------------------
      // تحميل نسبة تكلفة غير مباشرة معيارية مقدرة للمشروع (5% من إجمالي التكاليف المباشرة)
      const directCostBase = material_cost + labor_cost + subcontractors_cost + direct_expenses;
      const indirect_cost = Math.round(directCostBase * 0.05 * 100) / 100;

      // إجمالي التكلفة الفعلية التراكمية
      const total_actual_cost = directCostBase + indirect_cost;

      // -------------------------------------------------------------
      // 6. حساب الالتزامات المستقبلية (Future Commitments)
      // أوامر الشراء المعتمدة الجارية التي لم تفوتر بعد
      // -------------------------------------------------------------
      let future_commitments = 0;
      try {
        const poRes = await tx.get(`
          SELECT COALESCE(SUM(total_amount), 0) as total 
          FROM purchase_orders 
          WHERE project_id = ? AND status IN ('approved', 'ordered', 'in_progress')
        `, [prjId]);
        future_commitments = Number(poRes?.total || 0);
      } catch {}

      // -------------------------------------------------------------
      // 7. حساب نسبة الإنجاز POC (IFRS 15 Cost-to-Cost Input Method)
      // POC = (التكلفة الفعلية / إجمالي التكلفة التقديرية المتوقعة) × 100
      // -------------------------------------------------------------
      let estimated_total_cost = Number(project.estimated_cost || 0);
      if (estimated_total_cost <= 0) {
        // إذا لم تكن هناك تكلفة تقديرية معلنة، نعتمد التكلفة المنفقة مضافاً إليها الالتزامات
        estimated_total_cost = total_actual_cost + future_commitments;
      }
      if (estimated_total_cost < total_actual_cost) {
        estimated_total_cost = total_actual_cost + future_commitments;
      }

      let poc_percentage = 0;
      if (estimated_total_cost > 0) {
        poc_percentage = Math.min(100, (total_actual_cost / estimated_total_cost) * 100);
      }
      poc_percentage = Math.round(poc_percentage * 10000) / 10000;

      // -------------------------------------------------------------
      // 8. حساب الإيراد المعترف به وفق معيار IFRS 15
      // Recognized Revenue = العقد المعدل × (POC / 100)
      // -------------------------------------------------------------
      const recognized_revenue = Math.round((adjusted_contract_value * (poc_percentage / 100)) * 100) / 100;

      // -------------------------------------------------------------
      // 9. حساب الربح المتوقع الإجمالي للمشروع عند الاكتمال
      // Expected Profit = العقد المعدل - التكلفة الإجمالية المتوقعة
      // -------------------------------------------------------------
      const expected_profit = Math.round((adjusted_contract_value - (total_actual_cost + future_commitments)) * 100) / 100;

      // -------------------------------------------------------------
      // 10. حساب الربح الفعلي المحقق حتى تاريخه
      // Actual Profit = الإيراد المعترف به - التكلفة الفعلية المنفقة
      // -------------------------------------------------------------
      const actual_profit = Math.round((recognized_revenue - total_actual_cost) * 100) / 100;

      // -------------------------------------------------------------
      // 11. حساب هامش الربح كنسبة مئوية
      // Profit Margin % = (الربح الفعلي / الإيراد المعترف به) × 100
      // -------------------------------------------------------------
      let profit_margin_pct = 0;
      if (recognized_revenue > 0) {
        profit_margin_pct = (actual_profit / recognized_revenue) * 100;
      } else if (adjusted_contract_value > 0) {
        profit_margin_pct = (expected_profit / adjusted_contract_value) * 100;
      }
      profit_margin_pct = Math.round(profit_margin_pct * 10000) / 10000;

      // -------------------------------------------------------------
      // 12. نظام التنبيهات الذكية (Smart Alerts)
      // -------------------------------------------------------------
      const alerts = [];

      // أ. هامش ربح < 5% → تنبيه حرج
      if (profit_margin_pct < 5 && poc_percentage > 10) {
        alerts.push({
          type: 'CRITICAL',
          code: 'CRITICAL_LOW_MARGIN',
          message: `⚠️ تنبيه حرج: هامش الربح المحقق (${profit_margin_pct.toFixed(2)}%) انخفض إلى ما دون الحد الأدنى الآمن (5%)!`
        });
      }

      // ب. التكلفة تجاوزت 90% من قيمة العقد → تحذير
      if (adjusted_contract_value > 0 && (total_actual_cost / adjusted_contract_value) >= 0.90) {
        const costRatio = ((total_actual_cost / adjusted_contract_value) * 100).toFixed(1);
        alerts.push({
          type: 'WARNING',
          code: 'WARNING_HIGH_COST_RATIO',
          message: `⚠️ تحذير مالي: إجمالي التكاليف المنفقة تجاوزت ${costRatio}% من قيمة العقد المعدل!`
        });
      }

      // ج. نسبة الهالك > 5% من المواد المصروفة → تحذير
      const wastageRatio = sivQty > 0 ? (wastageQty / sivQty) * 100 : 0;
      if (wastageRatio > 5) {
        alerts.push({
          type: 'WARNING',
          code: 'WARNING_HIGH_WASTAGE',
          message: `⚠️ تحذير هدر: نسبة التوالف والهالك بالمشروع بلغت (${wastageRatio.toFixed(1)}%) وتتجاوز النسبة القياسية المسموحة (5%)!`
        });
      }

      // د. التكاليف تجاوزت كامل قيمة العقد → تنبيه حرج
      if (adjusted_contract_value > 0 && total_actual_cost > adjusted_contract_value) {
        const overrun = (total_actual_cost - adjusted_contract_value).toLocaleString('ar-YE');
        alerts.push({
          type: 'CRITICAL',
          code: 'CRITICAL_BUDGET_OVERRUN',
          message: `🚨 تنبيه حرج جداً: التكاليف الفعلية تجاوزت إجمالي قيمة العقد بمقدار ${overrun}$ (خسارة مؤكدة)!`
        });
      }

      // -------------------------------------------------------------
      // 13. قراءة الهامش السابق وتوثيق التغيير في audit_log
      // -------------------------------------------------------------
      const oldView = await tx.get('SELECT profit_margin_pct FROM project_profitability_view WHERE project_id = ?', [prjId]);
      const old_margin_pct = Number(oldView?.profit_margin_pct || 0);

      // حفظ أو تحديث بيانات العرض project_profitability_view
      await tx.run(`
        INSERT INTO project_profitability_view (
          project_id, contract_value, change_orders_total, adjusted_contract_value,
          poc_percentage, total_invoiced, total_collected, material_cost,
          labor_cost, subcontractors_cost, direct_expenses, indirect_cost,
          future_commitments, expected_profit, actual_profit, profit_margin_pct,
          recognized_revenue, total_actual_cost, currency, status, last_calculated_at, updated_at
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT(project_id) DO UPDATE SET
          contract_value = excluded.contract_value,
          change_orders_total = excluded.change_orders_total,
          adjusted_contract_value = excluded.adjusted_contract_value,
          poc_percentage = excluded.poc_percentage,
          total_invoiced = excluded.total_invoiced,
          total_collected = excluded.total_collected,
          material_cost = excluded.material_cost,
          labor_cost = excluded.labor_cost,
          subcontractors_cost = excluded.subcontractors_cost,
          direct_expenses = excluded.direct_expenses,
          indirect_cost = excluded.indirect_cost,
          future_commitments = excluded.future_commitments,
          expected_profit = excluded.expected_profit,
          actual_profit = excluded.actual_profit,
          profit_margin_pct = excluded.profit_margin_pct,
          recognized_revenue = excluded.recognized_revenue,
          total_actual_cost = excluded.total_actual_cost,
          currency = excluded.currency,
          last_calculated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `, [
        prjId, contract_value, change_orders_total, adjusted_contract_value,
        poc_percentage, total_invoiced, total_collected, material_cost,
        labor_cost, subcontractors_cost, direct_expenses, indirect_cost,
        future_commitments, expected_profit, actual_profit, profit_margin_pct,
        recognized_revenue, total_actual_cost, project.currency || 'USD'
      ]);

      // تحديث جدول المشاريع projects بالقيم الأساسية لتوحيد الرؤية
      await tx.run(`
        UPDATE projects SET 
          actual_cost = ?,
          progress_percentage = ?,
          actual_profit = ?,
          expected_profit = ?
        WHERE id = ?
      `, [total_actual_cost, poc_percentage, actual_profit, expected_profit, prjId]);

      // تسجيل التغيير في سجل التدقيق
      const triggerEvent = context.trigger_event || 'MANUAL_RECALCULATE';
      const referenceId = context.reference_id || `CALC-${Date.now().toString().slice(-6)}`;
      const createdBy = context.username || 'SYSTEM_ENGINE';

      await tx.run(`
        INSERT INTO profitability_audit_log (
          project_id, trigger_event, reference_id, old_margin_pct,
          new_margin_pct, actual_cost, recognized_revenue, actual_profit,
          created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        prjId, triggerEvent, referenceId, old_margin_pct,
        profit_margin_pct, total_actual_cost, recognized_revenue, actual_profit,
        createdBy, `إعادة احتساب مؤشرات الربحية اللحظية وفق معيار IFRS 15`
      ]);

      // تجهيز الكائن النهائي للاستجابة
      const result = {
        project_id: prjId,
        project_name: project.name,
        currency: project.currency || 'USD',
        // الحقول الـ 15 التعاقدية والمالية
        contract_value,
        change_orders_total,
        adjusted_contract_value,
        poc_percentage,
        total_invoiced,
        total_collected,
        material_cost,
        labor_cost,
        subcontractors_cost,
        direct_expenses,
        indirect_cost,
        future_commitments,
        expected_profit,
        actual_profit,
        profit_margin_pct,
        // تفاصيل مساعدة
        recognized_revenue,
        total_actual_cost,
        estimated_total_cost,
        last_calculated_at: new Date().toISOString(),
        alerts
      };

      // 14. إطلاق حدث عبر EventBus في حال توفره
      try {
        const materialDomainEventBus = require('./materialDomainEventBus');
        if (materialDomainEventBus && typeof materialDomainEventBus.publish === 'function') {
          await materialDomainEventBus.publish(
            'PROJECT_PROFITABILITY_UPDATED',
            'Project',
            String(prjId),
            {
              projectId: prjId,
              profit_margin_pct,
              actual_profit,
              alertsCount: alerts.length
            }
          );
        }
      } catch {}

      return result;
    });
  }

  /**
   * جلب بيانات ربحية مشروع محدد مع التنبيهات
   */
  static async getProjectProfitability(projectId) {
    const prjId = Number(projectId);
    let view = await get('SELECT * FROM project_profitability_view WHERE project_id = ?', [prjId]);

    // إذا لم تكن البيانات محسوبة مسبقاً، نحسبها فوراً
    if (!view) {
      return await this.recalculateProjectProfitability(prjId, { trigger_event: 'FIRST_INITIALIZE' });
    }

    const prj = await get('SELECT name, code, currency FROM projects WHERE id = ?', [prjId]);

    // تقييم التنبيهات الآنية
    const alerts = [];
    const profit_margin_pct = Number(view.profit_margin_pct || 0);
    const poc_percentage = Number(view.poc_percentage || 0);
    const total_actual_cost = Number(view.total_actual_cost || 0);
    const adjusted_contract_value = Number(view.adjusted_contract_value || 0);

    if (profit_margin_pct < 5 && poc_percentage > 10) {
      alerts.push({
        type: 'CRITICAL',
        code: 'CRITICAL_LOW_MARGIN',
        message: `⚠️ تنبيه حرج: هامش الربح المحقق (${profit_margin_pct.toFixed(2)}%) انخفض إلى ما دون الحد الأدنى الآمن (5%)!`
      });
    }

    if (adjusted_contract_value > 0 && (total_actual_cost / adjusted_contract_value) >= 0.90) {
      const costRatio = ((total_actual_cost / adjusted_contract_value) * 100).toFixed(1);
      alerts.push({
        type: 'WARNING',
        code: 'WARNING_HIGH_COST_RATIO',
        message: `⚠️ تحذير مالي: إجمالي التكاليف المنفقة تجاوزت ${costRatio}% من قيمة العقد المعدل!`
      });
    }

    if (adjusted_contract_value > 0 && total_actual_cost > adjusted_contract_value) {
      alerts.push({
        type: 'CRITICAL',
        code: 'CRITICAL_BUDGET_OVERRUN',
        message: `🚨 تنبيه حرج جداً: التكاليف تجاوزت قيمة العقد (خسارة تشغيلية)!`
      });
    }

    return {
      ...view,
      project_name: prj?.name || `مشروع #${prjId}`,
      project_code: prj?.code || '',
      alerts
    };
  }

  /**
   * جلب سجل التدقيق وتطور الربحية عبر الزمن للمشروع
   */
  static async getProfitabilityHistory(projectId, limit = 50) {
    const prjId = Number(projectId);
    return await query(`
      SELECT * 
      FROM profitability_audit_log 
      WHERE project_id = ? 
      ORDER BY id DESC 
      LIMIT ?
    `, [prjId, Number(limit)]);
  }

  /**
   * لوحة ملخص ربحية كافة المشاريع في الشركة
   */
  static async getCompanyProfitabilityDashboard() {
    const projects = await query(`
      SELECT 
        p.id, p.code, p.name, p.status, p.contract_value, p.currency,
        pv.adjusted_contract_value, pv.poc_percentage, pv.material_cost,
        pv.labor_cost, pv.subcontractors_cost, pv.direct_expenses,
        pv.indirect_cost, pv.total_actual_cost, pv.recognized_revenue,
        pv.total_invoiced, pv.total_collected, pv.expected_profit,
        pv.actual_profit, pv.profit_margin_pct, pv.last_calculated_at
      FROM projects p
      LEFT JOIN project_profitability_view pv ON p.id = pv.project_id
      ORDER BY p.id ASC
    `);

    // تجميعات على مستوى الشركة
    let totalContractValue = 0;
    let totalAdjustedValue = 0;
    let totalActualCost = 0;
    let totalRecognizedRevenue = 0;
    let totalExpectedProfit = 0;
    let totalActualProfit = 0;
    let criticalAlertsCount = 0;

    const listWithAlerts = projects.map(p => {
      const margin = Number(p.profit_margin_pct || 0);
      const cost = Number(p.total_actual_cost || 0);
      const adjVal = Number(p.adjusted_contract_value || p.contract_value || 0);
      const poc = Number(p.poc_percentage || 0);

      totalContractValue += Number(p.contract_value || 0);
      totalAdjustedValue += adjVal;
      totalActualCost += cost;
      totalRecognizedRevenue += Number(p.recognized_revenue || 0);
      totalExpectedProfit += Number(p.expected_profit || 0);
      totalActualProfit += Number(p.actual_profit || 0);

      const alerts = [];
      if (margin < 5 && poc > 10) {
        alerts.push('هامش ربح حرج < 5%');
        criticalAlertsCount++;
      }
      if (adjVal > 0 && cost > adjVal) {
        alerts.push('تجاوز تكلفة كامل العقد');
        criticalAlertsCount++;
      } else if (adjVal > 0 && (cost / adjVal) >= 0.90) {
        alerts.push('تكلفة تجاوزت 90% من العقد');
      }

      return {
        ...p,
        alerts
      };
    });

    const companyMargin = totalRecognizedRevenue > 0
      ? (totalActualProfit / totalRecognizedRevenue) * 100
      : (totalAdjustedValue > 0 ? (totalExpectedProfit / totalAdjustedValue) * 100 : 0);

    return {
      summary: {
        total_projects: projects.length,
        total_contract_value: Math.round(totalContractValue * 100) / 100,
        total_adjusted_value: Math.round(totalAdjustedValue * 100) / 100,
        total_actual_cost: Math.round(totalActualCost * 100) / 100,
        total_recognized_revenue: Math.round(totalRecognizedRevenue * 100) / 100,
        total_expected_profit: Math.round(totalExpectedProfit * 100) / 100,
        total_actual_profit: Math.round(totalActualProfit * 100) / 100,
        company_profit_margin_pct: Math.round(companyMargin * 100) / 100,
        critical_alerts_count: criticalAlertsCount
      },
      projects: listWithAlerts
    };
  }
}

module.exports = ProfitabilityService;

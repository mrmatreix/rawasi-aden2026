/**
 * projectCloseoutService.js
 * 
 * وحدة إغلاق المشروع وتقارير التحليلات بنمط CQRS (Command Query Responsibility Segregation)
 * تفصل بشكل صارم بين نماذج الأوامر (Write Model) ونماذج الاستعلام (Read Models):
 * 
 * 1. أوامر الإغلاق (Commands - Write Side):
 *    - CloseProjectCommand: التحقق من جاهزية المشروع، إغلاق الحالة، وتوليد نماذج القراءة المحفوظة (Materialized Views) ضمن معاملة ذرية.
 *    - ReopenProjectCommand: إعادة فتح المشروع للاستدراك الرقابي بعد التحقق من الصلاحيات.
 * 
 * 2. نماذج القراءة (Read Models - Query Side):
 *    - نموذج قراءة مستخلص العميل (Client BoQ DTO):
 *      كائن مشذب ومحصن أمنياً (Sanitized DTO) لا يحتوي إلا على الكميات المنفذة المعتمدة للفوترة
 *      وأسعار فئات العقد وقيم الاستحقاق ومحتجز الضمان، مع حجب كامل لكافة التكاليف وأسعار المشتريات وهوامش الربح.
 *    - نموذج قراءة مستخلص الرقابة الداخلية والتدقيق (Internal Audit BoQ DTO):
 *      مسار تجميع شامل (ETL Aggregation Pipeline) يربط كشف الكميات بالمشتريات، والمستودع،
 *      وحركات الصرف الميداني، والاستهلاك الفعلي لحساب:
 *      (BaselineQuantity, PurchasedQuantity, ReceivedQuantity, IssuedQuantity, ConsumedQuantity, SiteStockBalance, RemainingBaseline)
 *      بالإضافة إلى حساب انحرافات التكلفة، الفاقد والهدر، وهوامش الربحية.
 */

const crypto = require('crypto');
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const materialDomainEventBus = require('./materialDomainEventBus');

const SECRET_CLOSEOUT_KEY = process.env.CLOSEOUT_SEAL_SECRET || 'rawasi-aden-closeout-seal-secret-2026';

const ProjectCloseoutService = {

  // =========================================================================
  // مسار تجميع البيانات الشامل (Data Pipeline Aggregation)
  // =========================================================================

  /**
   * استخراج وتجميع مؤشرات دورة حياة المواد والكميات لكافة بنود المشروع
   */
  async aggregateProjectData(projectId, tx = null) {
    const dbGet = tx ? tx.get.bind(tx) : get;
    const dbQuery = tx ? tx.query.bind(tx) : query;

    // 1. جلب بيانات المشروع والعميل
    const project = await dbGet(`
      SELECT p.*, c.name as client_name, c.phone as client_phone, c.address as client_address
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [projectId]);

    if (!project) {
      throw new Error(`المشروع برقم (${projectId}) غير موجود.`);
    }

    // 2. جلب بنود جدول الكميات الأساسي BOQ
    const boqItems = await dbQuery(`
      SELECT * FROM project_boq 
      WHERE project_id = ? 
      ORDER BY id ASC
    `, [projectId]);

    // 3. جلب مجاميع المشتريات الخاصة بالمشروع
    const poItems = await dbQuery(`
      SELECT poi.*, po.po_no, po.status as po_status
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.po_id = po.id
      WHERE po.project_id = ?
    `, [projectId]).catch(() => []);

    // 4. جلب مجاميع الاستلام المخزني الفعلي (GRN)
    const grnItems = await dbQuery(`
      SELECT gri.*
      FROM goods_receipt_items gri
      JOIN goods_receipt_notes grn ON gri.grn_id = grn.id
      WHERE grn.project_id = ?
    `, [projectId]).catch(() => []);

    // 5. جلب حركات المخزون المصروفة والموردة للمشروع
    const inventoryTxs = await dbQuery(`
      SELECT * FROM inventory_transactions
      WHERE project_id = ?
    `, [projectId]).catch(() => []);

    // 6. جلب مرتجعات الموقع المفحوصة بجودة (Site Returns)
    const siteReturns = await dbQuery(`
      SELECT * FROM site_material_returns
      WHERE project_id = ?
    `, [projectId]).catch(() => []);

    // 7. جلب المواد التالفة المحجوزة للمشروع (Quarantine)
    const quarantineItems = await dbQuery(`
      SELECT * FROM material_quarantine_items
      WHERE project_id = ?
         OR warehouse_id IN (SELECT id FROM warehouses WHERE name LIKE '%موقع%' OR name LIKE '%${project.name}%')
    `, [projectId]).catch(() => []);

    // 8. جلب مستخلصات وفواتير العميل السابقة المعتمدة
    const pastBills = await dbQuery(`
      SELECT * FROM bills
      WHERE project_id = ? AND status IN ('approved', 'paid', 'posted')
    `, [projectId]).catch(() => []);

    const totalPastBilled = pastBills.reduce((sum, b) => sum + Number(b.net_amount || b.amount || 0), 0);

    // تجميع تفصيلي لكل بند في كشف الكميات BoQ
    const auditBoqList = [];
    const clientBoqList = [];

    let totalContractValue = 0;
    let totalBillableAmount = 0;
    let totalActualCost = 0;
    let totalWastageCost = 0;
    let totalSiteStockValue = 0;

    for (const boq of boqItems) {
      const boqId = boq.id;
      const baselineQty = Number(boq.contract_qty || 0);
      const contractRate = Number(boq.unit_rate || 0);
      const consumedQty = Number(boq.executed_qty || 0);

      // أ. الكمية المشتراة (PurchasedQuantity)
      const matchedPO = poItems.filter(p => p.boq_item_id === boqId || (p.item_name && boq.description && boq.description.includes(p.item_name)));
      let purchasedQty = matchedPO.reduce((sum, p) => sum + Number(p.ordered_qty || 0), 0);

      // ب. الكمية المستلمة (ReceivedQuantity)
      const matchedGRN = grnItems.filter(g => g.item_name && boq.description && boq.description.includes(g.item_name));
      let receivedQty = matchedGRN.reduce((sum, g) => sum + Number(g.accepted_qty || g.received_qty || 0), 0);

      // ج. الكمية المصروفة للموقع (IssuedQuantity)
      const matchedOut = inventoryTxs.filter(t => t.type === 'out' && (t.boq_item_id === boqId || (t.notes && t.notes.includes(boq.item_no))));
      let issuedQty = matchedOut.reduce((sum, t) => sum + Number(t.quantity || 0), 0);

      // إذا كانت بيانات الصرف الميداني غير مفهرسة برقم البند، نعتمد الاستهلاك كحد أدنى للصرف الفعلي
      if (issuedQty === 0 && consumedQty > 0) {
        issuedQty = consumedQty;
      }
      if (receivedQty === 0 && issuedQty > 0) {
        receivedQty = issuedQty;
      }
      if (purchasedQty === 0 && receivedQty > 0) {
        purchasedQty = receivedQty;
      }

      // د. الكميات المرتجعة والتالفة
      const matchedReturns = siteReturns.filter(r => r.boq_item_id === boqId);
      const returnedQty = matchedReturns.reduce((sum, r) => sum + Number(r.quantity || 0), 0);

      const matchedQuarantine = quarantineItems.filter(q => 
        q.boq_item_id === boqId || 
        (q.project_id === projectId && (matchedOut.some(t => t.item_id === q.item_id) || matchedReturns.some(r => r.item_id === q.item_id)))
      );
      const damagedQty = matchedQuarantine.reduce((sum, q) => sum + Number(q.quantity || 0), 0);

      // هـ. الحسابات الدقيقة المطلوبة في السؤال:
      // SiteStockBalance (الرصيد بالموقع) = (IssuedQuantity - ConsumedQuantity)
      const siteStockBalance = Math.max(0, issuedQty - consumedQty - returnedQty);

      // RemainingBaseline (المتبقي من الأساسي) = (BaselineQuantity - ConsumedQuantity)
      const remainingBaseline = Math.max(0, baselineQty - consumedQty);

      // كمية الهدر والفاقد (WastageQuantity)
      const unreturnedVariance = Math.max(0, (issuedQty - returnedQty) - (consumedQty + siteStockBalance));
      const wastageQty = damagedQty + unreturnedVariance;
      const wastagePercent = issuedQty > 0 ? ((wastageQty / issuedQty) * 100) : 0;

      // التكاليف والأسعار
      // متوسط تكلفة الوحدة الفعلية من سجلات الشراء والمخزون
      let actualUnitCost = 0;
      if (matchedOut.length > 0) {
        const totalCostOut = matchedOut.reduce((sum, t) => sum + Number(t.total_amount || (t.quantity * t.unit_price) || 0), 0);
        actualUnitCost = issuedQty > 0 ? (totalCostOut / issuedQty) : 0;
      } else if (matchedPO.length > 0) {
        const totalPOCost = matchedPO.reduce((sum, p) => sum + Number(p.total_price || (p.ordered_qty * p.unit_price) || 0), 0);
        actualUnitCost = purchasedQty > 0 ? (totalPOCost / purchasedQty) : 0;
      }
      
      // التكلفة المقدرة للبند (افتراضياً 72% من سعر البيع كمعيار هندسي للمقاولات)
      const budgetedUnitCost = Math.round(contractRate * 0.72);
      if (actualUnitCost === 0) {
        actualUnitCost = budgetedUnitCost;
      }

      const budgetedCost = Math.round(baselineQty * budgetedUnitCost);
      const totalItemActualCost = Math.round((consumedQty + wastageQty) * actualUnitCost);
      const costVariance = budgetedCost - totalItemActualCost; // موجب: وفر، سالب: تجاوز للموازنة

      const contractRevenue = Math.round(consumedQty * contractRate);
      const grossProfit = contractRevenue - totalItemActualCost;
      const profitMarginPercent = contractRevenue > 0 ? ((grossProfit / contractRevenue) * 100) : 0;

      // مؤشر الرقابة والمخاطر
      let varianceStatus = 'NORMAL';
      if (costVariance < 0 && Math.abs(costVariance) > (budgetedCost * 0.05)) {
        varianceStatus = 'COST_OVERRUN';
      } else if (wastagePercent > 8) {
        varianceStatus = 'HIGH_WASTAGE';
      } else if (siteStockBalance > 0) {
        varianceStatus = 'SURPLUS_AT_SITE';
      } else if (profitMarginPercent >= 20) {
        varianceStatus = 'HEALTHY';
      }

      // حساب القيمة المالية للمواد المتبقية بالوقع والهدر
      totalSiteStockValue += (siteStockBalance * actualUnitCost);
      totalWastageCost += (wastageQty * actualUnitCost);
      totalContractValue += (baselineQty * contractRate);
      totalBillableAmount += contractRevenue;
      totalActualCost += totalItemActualCost;

      // -------------------------------------------------------------
      // 1. DTO مستخلص الرقابة والتدقيق الداخلي (Internal Audit BoQ)
      // -------------------------------------------------------------
      auditBoqList.push({
        boq_item_id: boqId,
        item_no: boq.item_no || String(boqId),
        item_name: boq.description,
        category: boq.category || 'أعمال هندسية',
        unit: boq.unit,
        baseline_qty: baselineQty,
        purchased_qty: purchasedQty,
        received_qty: receivedQty,
        issued_qty: issuedQty,
        consumed_qty: consumedQty,
        site_stock_balance: siteStockBalance,
        remaining_baseline: remainingBaseline,
        returned_qty: returnedQty,
        damaged_qty: damagedQty,
        wastage_qty: wastageQty,
        wastage_percent: Number(wastagePercent.toFixed(2)),
        budgeted_unit_cost: budgetedUnitCost,
        budgeted_cost: budgetedCost,
        actual_unit_cost: actualUnitCost,
        total_actual_cost: totalItemActualCost,
        cost_variance: costVariance,
        contract_unit_rate: contractRate,
        contract_revenue: contractRevenue,
        gross_profit: grossProfit,
        profit_margin_percent: Number(profitMarginPercent.toFixed(2)),
        variance_status: varianceStatus
      });

      // -------------------------------------------------------------
      // 2. DTO مستخلص العميل الخارجي (Client-Facing BoQ)
      // مشذب ومحصن أمنياً: لا تكاليف فعلية، لا أسعار شراء، لا هدر
      // -------------------------------------------------------------
      const itemBillable = contractRevenue;
      const retentionPercent = 5.0; // نسبة محتجز الضمان التعاقدي 5%
      const retentionAmount = Math.round((itemBillable * retentionPercent) / 100);
      const netPayable = itemBillable - retentionAmount;

      clientBoqList.push({
        boq_item_id: boqId,
        item_no: boq.item_no || String(boqId),
        description: boq.description,
        category: boq.category || 'أعمال تنفيذية',
        unit: boq.unit,
        contract_qty: baselineQty,
        billed_qty: consumedQty,
        contract_unit_rate: contractRate,
        billable_amount: itemBillable,
        previous_billed_amount: 0,
        current_billed_amount: itemBillable,
        retention_percent: retentionPercent,
        retention_amount: retentionAmount,
        net_payable: netPayable
      });
    }

    const overallGrossProfit = totalBillableAmount - totalActualCost;
    const overallMarginPercent = totalBillableAmount > 0 
      ? Number(((overallGrossProfit / totalBillableAmount) * 100).toFixed(2)) 
      : 0;

    const totalRetention = Math.round((totalBillableAmount * 5.0) / 100);
    const netClientPayable = totalBillableAmount - totalRetention;

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        client_name: project.client_name || 'العميل المعتمد',
        client_phone: project.client_phone,
        client_address: project.client_address,
        contract_value: project.contract_value || totalContractValue,
        status: project.status
      },
      summary: {
        total_contract_value: totalContractValue,
        total_billed_amount: totalBillableAmount,
        total_actual_cost: totalActualCost,
        gross_profit: overallGrossProfit,
        profit_margin_percent: overallMarginPercent,
        total_wastage_cost: totalWastageCost,
        site_stock_value: totalSiteStockValue,
        retention_amount: totalRetention,
        net_client_payable: netClientPayable,
        total_past_billed: totalPastBilled
      },
      clientBoqList,
      auditBoqList
    };
  },

  // =========================================================================
  // 1. جانب الأوامر (Commands - Write Side)
  // =========================================================================

  /**
   * أمر إغلاق المشروع وتوليد نماذج القراءة المشتقة (CloseProjectCommand)
   */
  async closeProject(command, user = {}) {
    const { projectId, closeoutDate, notes, closedByName, forceClose = false } = command;

    if (!projectId) {
      throw new Error('رقم المشروع (projectId) مطلوب لتنفيذ أمر الإغلاق.');
    }

    const closeDate = closeoutDate || new Date().toISOString().split('T')[0];
    const closerName = closedByName || user.username || 'مدير المشاريع';
    const closerId = user.id || 1;

    return await transaction(async (tx) => {
      // 1. التحقق من وجود المشروع وحالته الحالية
      const project = await tx.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) {
        throw new Error(`المشروع برقم (${projectId}) غير موجود.`);
      }

      if (project.status === 'completed' || project.status === 'closed') {
        const existing = await tx.get('SELECT * FROM project_closeouts WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
        if (existing && !forceClose) {
          throw new Error(`المشروع مغلق مسبقاً بموجب محضر الإغلاق رقم (${existing.closeout_no}).`);
        }
      }

      // 2. التحقق من القواعد الرقابية قبل الإغلاق (Pre-closeout Invariants)
      if (!forceClose) {
        // فحص التحويلات المعلقة
        const pendingTransfers = await tx.query(`
          SELECT * FROM inter_project_material_transfers
          WHERE (from_project_id = ? OR to_project_id = ?) AND status = 'requested'
        `, [projectId, projectId]).catch(() => []);

        if (pendingTransfers.length > 0) {
          throw new Error(`لا يمكن إغلاق المشروع لوجود (${pendingTransfers.length}) تحويلات مواد معلقة بانتظار الاعتماد المزدوج.`);
        }
      }

      // 3. تشغيل مسار تجميع المؤشرات الشامل (Pipeline Aggregation)
      const data = await this.aggregateProjectData(projectId, tx);

      // 4. توليد رقم الإغلاق والختم التشفيري لسلامة السجل
      const closeoutNo = `CLOSEOUT-PRJ-${projectId}-${Date.now().toString(36).toUpperCase()}`;
      const payloadString = JSON.stringify({
        projectId,
        closeoutNo,
        closeDate,
        summary: data.summary,
        itemCount: data.auditBoqList.length
      });

      const hashSignature = crypto
        .createHmac('sha256', SECRET_CLOSEOUT_KEY)
        .update(payloadString)
        .digest('hex');

      // 5. حفظ السجل الرئيسي للإغلاق (project_closeouts)
      const closeoutRes = await tx.run(`
        INSERT INTO project_closeouts (
          project_id, closeout_no, closeout_date, closed_by, closed_by_name,
          status, total_contract_value, total_billed_amount, total_actual_cost,
          gross_profit, profit_margin_percent, total_wastage_cost, site_stock_value,
          retention_amount, net_client_payable, notes, hash_signature
        ) VALUES (?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, closeoutNo, closeDate, closerId, closerName,
        data.summary.total_contract_value, data.summary.total_billed_amount, data.summary.total_actual_cost,
        data.summary.gross_profit, data.summary.profit_margin_percent, data.summary.total_wastage_cost,
        data.summary.site_stock_value, data.summary.retention_amount, data.summary.net_client_payable,
        notes || 'إغلاق وتسليم ختامي للمشروع مع توليد نماذج القراءة CQRS', hashSignature
      ]);

      const closeoutId = closeoutRes.lastInsertRowid;

      // 6. مادية نموذج قراءة مستخلص العميل (Client BoQ Read Model Materialization)
      for (const cb of data.clientBoqList) {
        await tx.run(`
          INSERT INTO project_closeout_client_boq (
            closeout_id, project_id, boq_item_id, item_no, description, category,
            unit, contract_qty, billed_qty, contract_unit_rate, billable_amount,
            previous_billed_amount, current_billed_amount, retention_percent,
            retention_amount, net_payable, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          closeoutId, projectId, cb.boq_item_id, cb.item_no, cb.description, cb.category,
          cb.unit, cb.contract_qty, cb.billed_qty, cb.contract_unit_rate, cb.billable_amount,
          cb.previous_billed_amount, cb.current_billed_amount, cb.retention_percent,
          cb.retention_amount, cb.net_payable, ''
        ]);
      }

      // 7. مادية نموذج قراءة الرقابة الداخلية (Internal Audit BoQ Read Model Materialization)
      for (const ab of data.auditBoqList) {
        await tx.run(`
          INSERT INTO project_closeout_internal_audit_boq (
            closeout_id, project_id, boq_item_id, item_no, item_name, category,
            unit, baseline_qty, purchased_qty, received_qty, issued_qty, consumed_qty,
            site_stock_balance, remaining_baseline, returned_qty, damaged_qty,
            wastage_qty, wastage_percent, budgeted_unit_cost, budgeted_cost,
            actual_unit_cost, total_actual_cost, cost_variance, contract_unit_rate,
            contract_revenue, gross_profit, profit_margin_percent, variance_status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          closeoutId, projectId, ab.boq_item_id, ab.item_no, ab.item_name, ab.category,
          ab.unit, ab.baseline_qty, ab.purchased_qty, ab.received_qty, ab.issued_qty, ab.consumed_qty,
          ab.site_stock_balance, ab.remaining_baseline, ab.returned_qty, ab.damaged_qty,
          ab.wastage_qty, ab.wastage_percent, ab.budgeted_unit_cost, ab.budgeted_cost,
          ab.actual_unit_cost, ab.total_actual_cost, ab.cost_variance, ab.contract_unit_rate,
          ab.contract_revenue, ab.gross_profit, ab.profit_margin_percent, ab.variance_status, ''
        ]);
      }

      // 8. تحديث حالة المشروع في جدول المشاريع الرئيسي
      await tx.run(`
        UPDATE projects
        SET status = 'completed', end_date = ?
        WHERE id = ?
      `, [closeDate, projectId]);

      // 9. نشر حدث المجال المشفر إلى ناقل الأحداث (EDA Event Bus)
      await materialDomainEventBus.publish(
        'PROJECT_CLOSED',
        'Project',
        projectId,
        {
          closeoutId,
          closeoutNo,
          closeDate,
          closedBy: closerName,
          totalRevenue: data.summary.total_billed_amount,
          totalCost: data.summary.total_actual_cost,
          margin: data.summary.profit_margin_percent,
          hashSignature
        },
        { id: closerId, username: closerName }
      );

      // توثيق العملية في سجل التدقيق
      await logAudit(null, {
        action: 'PROJECT_CLOSEOUT_CQRS',
        entity_type: 'Project',
        entity_id: projectId,
        details: {
          closeoutId,
          closeoutNo,
          totalRevenue: data.summary.total_billed_amount,
          totalCost: data.summary.total_actual_cost,
          profitMargin: data.summary.profit_margin_percent
        }
      });

      return {
        success: true,
        message: `تم إغلاق المشروع بنجاح وتوليد نماذج القراءة المحصنة (محضر رقم: ${closeoutNo})`,
        data: {
          closeoutId,
          closeoutNo,
          closeDate,
          hashSignature,
          summary: data.summary
        }
      };
    });
  },

  /**
   * أمر إعادة فتح المشروع بعد الإغلاق للاستدراك الرقابي (ReopenProjectCommand)
   */
  async reopenProject(command, user = {}) {
    const { projectId, reason } = command;
    if (!projectId) throw new Error('رقم المشروع مطلوب لإعادة الفتح.');

    return await transaction(async (tx) => {
      const project = await tx.get('SELECT * FROM projects WHERE id = ?', [projectId]);
      if (!project) throw new Error(`المشروع (${projectId}) غير موجود.`);
      if (project.status !== 'completed' && project.status !== 'closed') {
        throw new Error('المشروع ليس في حالة إغلاق.');
      }

      // تحديث حالة السجل في project_closeouts
      await tx.run(`
        UPDATE project_closeouts
        SET status = 'reopened', notes = notes || ' | تم إعادة الفتح: ' || ?
        WHERE project_id = ? AND status = 'closed'
      `, [reason || 'إعادة فتح للاستدراك المالي', projectId]);

      // إعادة حالة المشروع إلى قيد التنفيذ النشط
      await tx.run(`
        UPDATE projects
        SET status = 'active'
        WHERE id = ?
      `, [projectId]);

      const reopenerName = user.username || 'مدير النظام';
      const reopenerId = user.id || 1;

      await materialDomainEventBus.publish(
        'PROJECT_REOPENED',
        'Project',
        projectId,
        { reason, reopenedBy: reopenerName },
        { id: reopenerId, username: reopenerName }
      );

      return {
        success: true,
        message: `تمت إعادة فتح المشروع (${project.name}) بنجاح للاستدراك والمراجعة.`
      };
    });
  },

  // =========================================================================
  // 2. جانب الاستعلامات ونماذج القراءة (Queries - Read Side)
  // =========================================================================

  /**
   * استعلام تقرير كشف الكميات الموجه للعميل (GetClientBoQReportQuery)
   * 
   * 🛡️ أمان وسرية البيانات: يمنح العميل فقط ما يتعلق بالكميات المنفذة وسعر العقد.
   * خالي تماماً من أي تسريب للتكاليف الفعلية أو أسعار الشراء أو نسب الهدر الداخلية.
   */
  async getClientBoQReport(projectId) {
    // 1. فحص وجود إغلاق محفوظ مسبقاً في نموذج القراءة المادي
    const closeout = await get(`
      SELECT * FROM project_closeouts 
      WHERE project_id = ? 
      ORDER BY id DESC LIMIT 1
    `, [projectId]);

    const project = await get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone, c.address as client_address
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [projectId]);

    if (!project) throw new Error('المشروع غير موجود.');

    let items = [];
    let totals = {};

    if (closeout && closeout.status === 'closed') {
      // القراءة مباشرة من النموذج المادي المحفوظ (Fast Materialized View Read)
      const rows = await query(`
        SELECT 
          item_no, description, category, unit, contract_qty,
          billed_qty, contract_unit_rate, billable_amount,
          previous_billed_amount, current_billed_amount,
          retention_percent, retention_amount, net_payable
        FROM project_closeout_client_boq
        WHERE closeout_id = ?
        ORDER BY id ASC
      `, [closeout.id]);

      items = rows;
      totals = {
        contract_value: closeout.total_contract_value,
        total_billed: closeout.total_billed_amount,
        retention_amount: closeout.retention_amount,
        net_payable: closeout.net_client_payable,
        closeout_no: closeout.closeout_no,
        closeout_date: closeout.closeout_date,
        hash_signature: closeout.hash_signature,
        is_materialized: true
      };
    } else {
      // مسودة حية (Live Preview Draft) للمشروع المفتوح
      const live = await this.aggregateProjectData(projectId);
      items = live.clientBoqList;
      totals = {
        contract_value: live.summary.total_contract_value,
        total_billed: live.summary.total_billed_amount,
        retention_amount: live.summary.retention_amount,
        net_payable: live.summary.net_client_payable,
        closeout_no: 'DRAFT-PREVIEW',
        closeout_date: new Date().toISOString().split('T')[0],
        hash_signature: null,
        is_materialized: false
      };
    }

    // تعقيم إضافي صارم (Sanitization DTO Wrapper)
    // منع خروج أي خاصية داخلية بالخطأ
    const sanitizedItems = items.map(it => ({
      item_no: it.item_no,
      description: it.description,
      category: it.category,
      unit: it.unit,
      contract_qty: Number(it.contract_qty),
      billed_qty: Number(it.billed_qty),
      contract_unit_rate: Number(it.contract_unit_rate),
      billable_amount: Number(it.billable_amount),
      retention_percent: Number(it.retention_percent || 5.0),
      retention_amount: Number(it.retention_amount),
      net_payable: Number(it.net_payable)
    }));

    return {
      report_type: 'CLIENT_FINAL_BILLING_BOQ',
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        client_name: project.client_name || 'السادة / عميل المشروع المحترمون',
        client_phone: project.client_phone,
        client_address: project.client_address
      },
      totals,
      items: sanitizedItems
    };
  },

  /**
   * استعلام تقرير كشف الكميات للرقابة الداخلية والتدقيق (GetInternalAuditBoQReportQuery)
   * 
   * يعرض كامل المؤشرات السبعة لدورة حياة المواد، والتباين المالي، وتحليل الربحية
   */
  async getInternalAuditBoQReport(projectId) {
    const closeout = await get(`
      SELECT * FROM project_closeouts 
      WHERE project_id = ? 
      ORDER BY id DESC LIMIT 1
    `, [projectId]);

    const project = await get(`SELECT * FROM projects WHERE id = ?`, [projectId]);
    if (!project) throw new Error('المشروع غير موجود.');

    let items = [];
    let summary = {};

    if (closeout && closeout.status === 'closed') {
      items = await query(`
        SELECT * FROM project_closeout_internal_audit_boq
        WHERE closeout_id = ?
        ORDER BY id ASC
      `, [closeout.id]);

      summary = {
        total_contract_value: closeout.total_contract_value,
        total_billed_amount: closeout.total_billed_amount,
        total_actual_cost: closeout.total_actual_cost,
        gross_profit: closeout.gross_profit,
        profit_margin_percent: closeout.profit_margin_percent,
        total_wastage_cost: closeout.total_wastage_cost,
        site_stock_value: closeout.site_stock_value,
        retention_amount: closeout.retention_amount,
        net_client_payable: closeout.net_client_payable,
        closeout_no: closeout.closeout_no,
        closeout_date: closeout.closeout_date,
        hash_signature: closeout.hash_signature,
        is_materialized: true
      };
    } else {
      const live = await this.aggregateProjectData(projectId);
      items = live.auditBoqList;
      summary = {
        ...live.summary,
        closeout_no: 'DRAFT-PREVIEW',
        closeout_date: new Date().toISOString().split('T')[0],
        hash_signature: null,
        is_materialized: false
      };
    }

    return {
      report_type: 'INTERNAL_AUDIT_CONTROL_BOQ',
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status
      },
      summary,
      items: items.map(it => ({
        boq_item_id: it.boq_item_id,
        item_no: it.item_no,
        item_name: it.item_name,
        category: it.category,
        unit: it.unit,
        // الحقول السبعة الأساسية المحددة في الطلب
        BaselineQuantity: Number(it.baseline_qty),
        PurchasedQuantity: Number(it.purchased_qty),
        ReceivedQuantity: Number(it.received_qty),
        IssuedQuantity: Number(it.issued_qty),
        ConsumedQuantity: Number(it.consumed_qty),
        SiteStockBalance: Number(it.site_stock_balance),
        RemainingBaseline: Number(it.remaining_baseline),
        // مؤشرات الهدر والفاقد
        ReturnedQuantity: Number(it.returned_qty || 0),
        DamagedQuantity: Number(it.damaged_qty || 0),
        WastageQuantity: Number(it.wastage_qty || 0),
        WastagePercent: Number(it.wastage_percent || 0),
        // مؤشرات التحليل المالي والتباين
        BudgetedCost: Number(it.budgeted_cost || 0),
        ActualUnitCost: Number(it.actual_unit_cost || 0),
        TotalActualCost: Number(it.total_actual_cost || 0),
        CostVariance: Number(it.cost_variance || 0),
        ContractUnitRate: Number(it.contract_unit_rate || 0),
        ContractRevenue: Number(it.contract_revenue || 0),
        GrossProfit: Number(it.gross_profit || 0),
        ProfitMarginPercent: Number(it.profit_margin_percent || 0),
        VarianceStatus: it.variance_status || 'NORMAL'
      }))
    };
  },

  /**
   * استعلام ملخص الأداء التنفيذي للإغلاق (GetProjectCloseoutSummaryQuery)
   */
  async getCloseoutSummary(projectId) {
    const live = await this.aggregateProjectData(projectId);
    const closeout = await get(`
      SELECT * FROM project_closeouts 
      WHERE project_id = ? AND status = 'closed'
      ORDER BY id DESC LIMIT 1
    `, [projectId]);

    return {
      is_closed: !!closeout,
      closeout_record: closeout || null,
      project: live.project,
      financials: live.summary,
      material_metrics: {
        total_items_count: live.auditBoqList.length,
        items_with_site_surplus: live.auditBoqList.filter(i => i.site_stock_balance > 0).length,
        items_with_high_waste: live.auditBoqList.filter(i => i.wastage_percent > 8).length,
        items_over_budget: live.auditBoqList.filter(i => i.cost_variance < 0).length,
        healthy_items: live.auditBoqList.filter(i => i.variance_status === 'HEALTHY' || i.variance_status === 'NORMAL').length
      }
    };
  },

  /**
   * قائمة بكافة المشاريع المغلقة وتاريخ إغلاقها
   */
  async listClosedProjects() {
    return await query(`
      SELECT c.*, p.name as project_name, p.code as project_code, cl.name as client_name
      FROM project_closeouts c
      JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      ORDER BY c.closeout_date DESC, c.id DESC
    `);
  }
};

module.exports = ProjectCloseoutService;

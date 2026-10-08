/**
 * materialManagementService.js
 * 
 * نظام إدارة المواد للمشاريع والمستودعات (Project & Warehouse Material Management System)
 * مبني استناداً إلى مبادئ التصميم القائم على المجال (DDD) والبنية القائمة على الأحداث (EDA)
 * 
 * يغطي:
 *  1. وحدة الجرد والتسويات (Inventory Auditing Module):
 *     - الجرد الدوري (Periodic Auditing) عبر المهام المجدولة واليدوية مع لقطة تجميد المخزون.
 *     - الجرد المفاجئ (Spot/Surprise Auditing) عند الطلب ودون إشعار مسبق من قبل المدققين.
 *     - محضر الجرد غير القابل للتعديل (Immutable Audit Minutes) مع التوقيع الرقمي وختم HMAC-SHA256.
 *     - معالجة الفروقات وحساب الفائض (Overage) والنقص (Shortage) وقيمتها المالية.
 *     - تسوية المخزون التلقائية (Stock Reconciliation) بامتثال صارم لمعايير ACID وتوليد قيود دفتر الأستاذ.
 * 
 *  2. حركة ودورة حياة المواد (Material Movement & Lifecycle):
 *     - المواد التالفة (Damaged Materials) وعزلها في صندوق افتراضي "خردة/حجر صحي" مع إثبات الخسائر.
 *     - إدارة معالجة مواد الحجر (إتلاف، بيع خردة، أو إعادة تأهيل).
 *     - المواد المعادة من الموقع للمخزن (Site-to-Warehouse Return) مع فحص الجودة (QC Inspection).
 *     - التحويلات بين المشاريع (Inter-Project Transfers) وفق قواعد توجيه صارمة والرقابة الثنائية (Maker-Checker).
 */

const crypto = require('crypto');
const { query, get, run, transaction } = require('../database/db');
const { assertPeriodOpen, resolveValidUserId, assertMakerChecker } = require('./financialControlService');
const { INVENTORY_ACCOUNTS } = require('./inventoryValuationService');
const materialDomainEventBus = require('./materialDomainEventBus');
const { logAudit } = require('./auditService');

const AUDIT_STATUS = {
  DRAFT: 'draft',
  IN_PROGRESS: 'in_progress',
  MINUTES_SEALED: 'minutes_sealed',
  RECONCILED: 'reconciled',
  CANCELLED: 'cancelled'
};

const QUARANTINE_STATUS = {
  QUARANTINED: 'quarantined',
  SCRAPPED: 'scrapped',
  REFURBISHED: 'refurbished',
  DISPOSED: 'disposed'
};

const TRANSFER_STATUS = {
  REQUESTED: 'requested',
  APPROVED: 'approved',
  IN_TRANSIT: 'in_transit',
  RECEIVED: 'received',
  REJECTED: 'rejected'
};

const SECRET_SEAL_KEY = process.env.AUDIT_SEAL_SECRET || 'rawasi-aden-audit-seal-key-2026';

const MaterialManagementService = {
  AUDIT_STATUS,
  QUARANTINE_STATUS,
  TRANSFER_STATUS,

  // =========================================================================
  // 1. وحدة الجرد والتسويات (Inventory Auditing Module)
  // =========================================================================

  /**
   * إنشاء جلسة جرد دوري قياسي للمستودع مع لقطة تجميد الرصيد الدفتري (Periodic Audit)
   */
  async createPeriodicAudit(data, user) {
    const {
      warehouse_id,
      auditor_name,
      scheduled_date = new Date().toISOString().split('T')[0],
      notes
    } = data;

    if (!warehouse_id) throw new Error('يرجى تحديد المستودع المراد جرده');
    if (!auditor_name) throw new Error('اسم رئيس لجنة الجرد / المدقق إلزامي');

    const warehouse = await get('SELECT * FROM warehouses WHERE id = ?', [warehouse_id]);
    if (!warehouse) throw new Error(`المستودع رقم (${warehouse_id}) غير موجود في النظام`);

    const userId = await resolveValidUserId(user?.id);
    const countRes = await get("SELECT COUNT(*) as cnt FROM inventory_audits WHERE audit_type = 'periodic'");
    const audit_no = `AUD-PER-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    return await transaction(async (tx) => {
      // 1. أخذ لقطة تجميد رصيد المستودع الحالي (Frozen Stock Snapshot)
      const stocks = await tx.query(`
        SELECT ws.item_id, ws.quantity as system_qty, 
               COALESCE(ws.average_cost, ws.last_cost, i.unit_price, 0) as unit_cost,
               i.name as item_name, i.code as item_code, i.unit
        FROM warehouse_stocks ws
        JOIN items i ON ws.item_id = i.id
        WHERE ws.warehouse_id = ?
        ORDER BY i.id ASC
      `, [warehouse_id]);

      // 2. إدراج رأس محضر الجرد
      const auditRes = await tx.run(`
        INSERT INTO inventory_audits (
          audit_no, warehouse_id, audit_type, status, scheduled_at,
          snapshot_taken_at, initiated_by, auditor_id, auditor_name,
          total_items_audited, notes
        ) VALUES (?, ?, 'periodic', 'in_progress', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
      `, [
        audit_no, warehouse_id, scheduled_date,
        userId, userId, stocks.length, notes || 'جرد دوري مجدول للمخزون'
      ]);

      const auditId = auditRes.lastInsertRowid || auditRes.insertId;

      // 3. إدراج بنود الجرد مع الرصيد الدفتري المجمد
      for (const st of stocks) {
        await tx.run(`
          INSERT INTO inventory_audit_items (
            audit_id, item_id, system_qty, physical_qty, diff_qty,
            unit_cost, diff_amount, discrepancy_type, condition_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'match', 'good')
        `, [
          auditId, st.item_id, Number(st.system_qty) || 0, Number(st.system_qty) || 0,
          0, Number(st.unit_cost) || 0, 0
        ]);
      }

      // 4. بث حدث المجال عبر ناقل الأحداث
      await materialDomainEventBus.publish('AUDIT_SCHEDULED', 'inventory_audit', audit_no, {
        auditId,
        audit_no,
        warehouse_id,
        warehouse_name: warehouse.name,
        audit_type: 'periodic',
        item_count: stocks.length,
        scheduled_date,
        auditor_name
      }, user);

      return {
        id: auditId,
        audit_no,
        warehouse_id,
        warehouse_name: warehouse.name,
        audit_type: 'periodic',
        status: 'in_progress',
        item_count: stocks.length,
        scheduled_date
      };
    });
  },

  /**
   * تشغيل جرد مفاجئ دون إشعار مسبق من قبل المدققين (Spot / Surprise Audit)
   * يأخذ لقطة فورية متزامنة ويسمح بالفلترة حسب التصنيف
   */
  async triggerSpotAudit(data, user) {
    const {
      warehouse_id,
      auditor_name,
      category_filter = null,
      notes
    } = data;

    if (!warehouse_id) throw new Error('يرجى تحديد المستودع للجرد المفاجئ');
    if (!auditor_name) throw new Error('اسم المدقق المنفذ للجرد المفاجئ إلزامي');

    const warehouse = await get('SELECT * FROM warehouses WHERE id = ?', [warehouse_id]);
    if (!warehouse) throw new Error(`المستودع رقم (${warehouse_id}) غير موجود`);

    const userId = await resolveValidUserId(user?.id);
    const countRes = await get("SELECT COUNT(*) as cnt FROM inventory_audits WHERE audit_type = 'spot_surprise'");
    const audit_no = `AUD-SPT-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    return await transaction(async (tx) => {
      let sql = `
        SELECT ws.item_id, ws.quantity as system_qty,
               COALESCE(ws.average_cost, ws.last_cost, i.unit_price, 0) as unit_cost,
               i.name as item_name, i.code as item_code, i.unit, i.category
        FROM warehouse_stocks ws
        JOIN items i ON ws.item_id = i.id
        WHERE ws.warehouse_id = ?
      `;
      const params = [warehouse_id];

      if (category_filter) {
        sql += ' AND i.category = ?';
        params.push(category_filter);
      }
      sql += ' ORDER BY i.id ASC';

      const stocks = await tx.query(sql, params);

      const auditRes = await tx.run(`
        INSERT INTO inventory_audits (
          audit_no, warehouse_id, audit_type, status, scheduled_at, executed_at,
          snapshot_taken_at, initiated_by, auditor_id, auditor_name,
          category_filter, total_items_audited, notes
        ) VALUES (?, ?, 'spot_surprise', 'in_progress', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
      `, [
        audit_no, warehouse_id, userId, userId, auditor_name,
        category_filter, stocks.length, notes || 'جرد مفاجئ وفحص فوري للمخزون'
      ]);

      const auditId = auditRes.lastInsertRowid || auditRes.insertId;

      for (const st of stocks) {
        // في الجرد المفاجئ نترك الكمية الفعلية فارغة في البداية ليدخلها المدقق بنفسه
        await tx.run(`
          INSERT INTO inventory_audit_items (
            audit_id, item_id, system_qty, physical_qty, diff_qty,
            unit_cost, diff_amount, discrepancy_type, condition_status
          ) VALUES (?, ?, ?, 0, ?, ?, ?, 'shortage', 'good')
        `, [
          auditId, st.item_id, Number(st.system_qty) || 0,
          -Number(st.system_qty) || 0, Number(st.unit_cost) || 0,
          (-Number(st.system_qty) || 0) * (Number(st.unit_cost) || 0)
        ]);
      }

      await materialDomainEventBus.publish('SPOT_AUDIT_TRIGGERED', 'inventory_audit', audit_no, {
        auditId,
        audit_no,
        warehouse_id,
        warehouse_name: warehouse.name,
        audit_type: 'spot_surprise',
        item_count: stocks.length,
        category_filter,
        auditor_name
      }, user);

      return {
        id: auditId,
        audit_no,
        warehouse_id,
        warehouse_name: warehouse.name,
        audit_type: 'spot_surprise',
        status: 'in_progress',
        item_count: stocks.length,
        category_filter,
        executed_at: new Date().toISOString()
      };
    });
  },

  /**
   * تسجيل نتائج العد الفعلي للأصناف وحساب الفروقات آلياً (Discrepancy Calculation)
   */
  async recordPhysicalCounts(audit_id, countItems, user) {
    if (!audit_id) throw new Error('معرف الجرد مطلوب');
    if (!Array.isArray(countItems) || countItems.length === 0) {
      throw new Error('يرجى تزويد قائمة الأصناف والكميات المحصورة فعلياً');
    }

    const audit = await get('SELECT * FROM inventory_audits WHERE id = ?', [audit_id]);
    if (!audit) throw new Error('محضر الجرد غير موجود');
    if (audit.status === AUDIT_STATUS.MINUTES_SEALED || audit.status === AUDIT_STATUS.RECONCILED) {
      throw new Error('لا يمكن تعديل كميات الجرد: المحضر مختوم أو تم ترحيل تسويته مسبقاً');
    }

    return await transaction(async (tx) => {
      let totalOverageQty = 0;
      let totalShortageQty = 0;
      let totalOverageAmount = 0;
      let totalShortageAmount = 0;

      for (const row of countItems) {
        const { item_id, physical_qty, condition_status = 'good', auditor_notes } = row;
        if (!item_id || physical_qty === undefined || Number(physical_qty) < 0) {
          throw new Error(`كمية العد للصنف (${item_id}) غير صالحة، يجب أن تكون 0 أو أكبر`);
        }

        const auditItem = await tx.get(`
          SELECT * FROM inventory_audit_items 
          WHERE audit_id = ? AND item_id = ?
        `, [audit_id, item_id]);

        if (!auditItem) continue;

        const systemQty = Number(auditItem.system_qty) || 0;
        const physicalQty = Number(physical_qty);
        const unitCost = Number(auditItem.unit_cost) || 0;
        const diffQty = physicalQty - systemQty;
        const diffAmount = Math.abs(diffQty) * unitCost;

        let discrepancyType = 'match';
        if (diffQty > 0.0001) {
          discrepancyType = 'overage'; // فائض
          totalOverageQty += diffQty;
          totalOverageAmount += diffAmount;
        } else if (diffQty < -0.0001) {
          discrepancyType = 'shortage'; // عجز
          totalShortageQty += Math.abs(diffQty);
          totalShortageAmount += diffAmount;
        }

        await tx.run(`
          UPDATE inventory_audit_items SET
            physical_qty = ?,
            diff_qty = ?,
            diff_amount = ?,
            discrepancy_type = ?,
            condition_status = ?,
            auditor_notes = ?
          WHERE id = ?
        `, [
          physicalQty, diffQty, diffAmount, discrepancyType,
          condition_status, auditor_notes || '', auditItem.id
        ]);
      }

      // تحديث ملخص رأس محضر الجرد
      const netVarianceAmount = totalOverageAmount - totalShortageAmount;
      await tx.run(`
        UPDATE inventory_audits SET
          total_overage_qty = ?,
          total_shortage_qty = ?,
          total_overage_amount = ?,
          total_shortage_amount = ?,
          net_variance_amount = ?,
          executed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        totalOverageQty, totalShortageQty,
        totalOverageAmount, totalShortageAmount,
        netVarianceAmount, audit_id
      ]);

      await materialDomainEventBus.publish('AUDIT_COUNT_RECORDED', 'inventory_audit', audit.audit_no, {
        auditId: audit_id,
        audit_no: audit.audit_no,
        totalOverageQty,
        totalShortageQty,
        totalOverageAmount,
        totalShortageAmount,
        netVarianceAmount
      }, user);

      return {
        audit_id,
        audit_no: audit.audit_no,
        total_overage_qty: totalOverageQty,
        total_shortage_qty: totalShortageQty,
        total_overage_amount: totalOverageAmount,
        total_shortage_amount: totalShortageAmount,
        net_variance_amount: netVarianceAmount,
        status: 'in_progress'
      };
    });
  },

  /**
   * اعتماد وختم محضر الجرد النهائي بتوقيع رقمي وتشفير HMAC (Seal Audit Minutes)
   * ينشئ وثيقة غير قابلة للتعديل لضمان الامتثال والمساءلة
   */
  async sealAuditMinutes(audit_id, sealData, user) {
    const {
      auditor_name,
      witness_name,
      digital_signature,
      notes
    } = sealData;

    if (!audit_id) throw new Error('معرف الجرد مطلوب');
    if (!auditor_name) throw new Error('اسم المدقق المعتمد إلزامي لختم المحضر');
    if (!digital_signature) throw new Error('التوقيع الرقمي للمدقق إلزامي لضمان عدم الإنكار');

    const audit = await get(`
      SELECT a.*, w.name as warehouse_name, w.code as warehouse_code
      FROM inventory_audits a
      JOIN warehouses w ON a.warehouse_id = w.id
      WHERE a.id = ?
    `, [audit_id]);

    if (!audit) throw new Error('محضر الجرد غير موجود');
    if (audit.status === AUDIT_STATUS.MINUTES_SEALED || audit.status === AUDIT_STATUS.RECONCILED) {
      throw new Error('محضر الجرد مختوم أو مرحل مسبقاً');
    }

    const items = await query(`
      SELECT ai.*, i.name as item_name, i.code as item_code, i.unit
      FROM inventory_audit_items ai
      JOIN items i ON ai.item_id = i.id
      WHERE ai.audit_id = ?
      ORDER BY ai.id ASC
    `, [audit_id]);

    const timestamp = new Date().toISOString();

    // 1. توليد الوثيقة المعيارية لمحضر الجرد (Canonical Audit Minutes Document)
    const minutesPayload = {
      header: {
        audit_no: audit.audit_no,
        audit_type: audit.audit_type,
        warehouse_id: audit.warehouse_id,
        warehouse_name: audit.warehouse_name,
        warehouse_code: audit.warehouse_code,
        snapshot_taken_at: audit.snapshot_taken_at,
        sealed_at: timestamp,
        auditor_name,
        witness_name: witness_name || 'أمين المستودع',
        notes: notes || audit.notes
      },
      summary: {
        total_items: items.length,
        total_overage_qty: audit.total_overage_qty,
        total_shortage_qty: audit.total_shortage_qty,
        total_overage_amount: audit.total_overage_amount,
        total_shortage_amount: audit.total_shortage_amount,
        net_variance_amount: audit.net_variance_amount
      },
      items: items.map(it => ({
        item_id: it.item_id,
        code: it.item_code,
        name: it.item_name,
        unit: it.unit,
        system_qty: it.system_qty,
        physical_qty: it.physical_qty,
        diff_qty: it.diff_qty,
        unit_cost: it.unit_cost,
        diff_amount: it.diff_amount,
        discrepancy_type: it.discrepancy_type,
        condition_status: it.condition_status,
        notes: it.auditor_notes
      })),
      signer: {
        auditor_name,
        witness_name: witness_name || '',
        digital_signature,
        signature_time: timestamp
      }
    };

    // 2. حساب الختم الرقمي المشفر HMAC-SHA256
    const canonicalString = JSON.stringify(minutesPayload);
    const hashSignature = crypto
      .createHmac('sha256', SECRET_SEAL_KEY)
      .update(canonicalString)
      .digest('hex');

    minutesPayload.security_seal = {
      algorithm: 'HMAC-SHA256',
      hash_signature: hashSignature,
      immutable: true
    };

    const minutesDocJson = JSON.stringify(minutesPayload);

    await run(`
      UPDATE inventory_audits SET
        status = 'minutes_sealed',
        auditor_name = ?,
        witness_name = ?,
        digital_signature = ?,
        hash_signature = ?,
        minutes_doc = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      auditor_name, witness_name || '', digital_signature,
      hashSignature, minutesDocJson, audit_id
    ]);

    await materialDomainEventBus.publish('AUDIT_MINUTES_SEALED', 'inventory_audit', audit.audit_no, {
      auditId: audit_id,
      audit_no: audit.audit_no,
      auditor_name,
      hashSignature,
      netVarianceAmount: audit.net_variance_amount
    }, user);

    return {
      audit_id,
      audit_no: audit.audit_no,
      status: 'minutes_sealed',
      hash_signature: hashSignature,
      sealed_at: timestamp,
      minutes_document: minutesPayload
    };
  },

  /**
   * تسوية المخزون التلقائية بامتثال ACID وتحديث دفتر الأستاذ العام (Stock Reconciliation)
   * يطبق القيود المحاسبية المتزنة ويحدّث الأرصدة دفعة واحدة
   */
  async reconcileStockAudit(audit_id, user, req = null) {
    if (!audit_id) throw new Error('معرف الجرد مطلوب للتسوية');

    const audit = await get(`
      SELECT a.*, w.name as warehouse_name
      FROM inventory_audits a
      JOIN warehouses w ON a.warehouse_id = w.id
      WHERE a.id = ?
    `, [audit_id]);

    if (!audit) throw new Error('محضر الجرد غير موجود');
    if (audit.status === AUDIT_STATUS.RECONCILED) {
      throw new Error(`محضر الجرد [${audit.audit_no}] تم ترحيل تسويته واعتماده محاسبياً بالفعل`);
    }
    if (audit.status !== AUDIT_STATUS.MINUTES_SEALED) {
      throw new Error('لا يمكن تسوية الجرد إلا بعد اعتماد وختم المحضر الرقمي أولاً (Minutes Sealed)');
    }

    const todayDate = new Date().toISOString().split('T')[0];
    await assertPeriodOpen(todayDate);

    const userId = await resolveValidUserId(user?.id);

    return await transaction(async (tx) => {
      const items = await tx.query(`
        SELECT ai.*, i.name as item_name, i.code as item_code
        FROM inventory_audit_items ai
        JOIN items i ON ai.item_id = i.id
        WHERE ai.audit_id = ? AND ai.discrepancy_type != 'match'
      `, [audit_id]);

      let totalShortageAmount = 0;
      let totalOverageAmount = 0;

      // 1. تحديث الأرصدة المخزنية في جدول الأصناف وجدول أرصدة المستودعات
      for (const it of items) {
        const diffQty = Number(it.diff_qty);
        const unitCost = Number(it.unit_cost);
        const amount = Math.abs(diffQty) * unitCost;

        if (diffQty > 0) totalOverageAmount += amount;
        else if (diffQty < 0) totalShortageAmount += amount;

        // تعديل رصيد الصنف الإجمالي
        await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [diffQty, it.item_id]);

        // تعديل رصيد الصنف بالمستودع المحدد
        await tx.run(`
          INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
            quantity = quantity + excluded.quantity,
            updated_at = CURRENT_TIMESTAMP
        `, [audit.warehouse_id, it.item_id, diffQty, unitCost, unitCost]);

        // تسجيل حركة تسوية في سجل الحركات المخزنية
        await tx.run(`
          INSERT INTO inventory_transactions (
            item_id, warehouse_id, type, quantity, unit_price,
            total_amount, reference_no, date, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          it.item_id, audit.warehouse_id,
          diffQty > 0 ? 'in' : 'out',
          Math.abs(diffQty), unitCost, amount,
          audit.audit_no, todayDate,
          `تسوية جرد معتمد (${audit.audit_no}) - ${diffQty > 0 ? 'فائض مخزني' : 'عجز مخزني'} للصنف [${it.item_name}]`
        ]);
      }

      // 2. إنشاء القيد المحاسبي المتزن لدفتر الأستاذ (GL Journal Entry)
      let journalEntryId = null;
      let entry_no = null;
      const totalAdjustmentDebit = totalShortageAmount + totalOverageAmount;

      if (totalAdjustmentDebit > 0.0001) {
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

        const jvRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, total_debit, total_credit,
            status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          ) VALUES (?, ?, ?, 'تسوية جرد', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entry_no, todayDate,
          `قيد تسوية محضر الجرد (${audit.audit_no}) لمستودع [${audit.warehouse_name}]`,
          totalAdjustmentDebit, totalAdjustmentDebit,
          userId, user?.username || 'مدير الحسابات',
          userId, user?.username || 'مدير الحسابات'
        ]);

        journalEntryId = jvRes.lastInsertRowid || jvRes.insertId;

        // سطر العجز: مدين بحساب خسائر وعجز المخزون (5105 / 27)
        if (totalShortageAmount > 0) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
            VALUES (?, ?, ?, 0, ?)
          `, [journalEntryId, INVENTORY_ACCOUNTS.INVENTORY_LOSS_SHRINKAGE, totalShortageAmount, `مدين: إثبات خسائر وعجز الجرد بموجب محضر ${audit.audit_no}`]);

          // دائن بحساب المخزون (11) لتخفيض الأصل
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
            VALUES (?, ?, 0, ?, ?)
          `, [journalEntryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, totalShortageAmount, `دائن: تخفيض رصيد أصل المخزون بالعجز المثبت في ${audit.audit_no}`]);
        }

        // سطر الفائض: مدين بحساب المخزون (11) لزيادة الأصل
        if (totalOverageAmount > 0) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
            VALUES (?, ?, ?, 0, ?)
          `, [journalEntryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, totalOverageAmount, `مدين: زيادة رصيد أصل المخزون بالفائض المثبت في ${audit.audit_no}`]);

          // دائن بحساب أرباح وفائض المخزون (4205 / 28)
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
            VALUES (?, ?, 0, ?, ?)
          `, [journalEntryId, INVENTORY_ACCOUNTS.INVENTORY_GAIN_SURPLUS, totalOverageAmount, `دائن: إثبات إيرادات وفائض الجرد بموجب ${audit.audit_no}`]);
        }
      }

      // 3. تحديث حالة محضر الجرد إلى مُرحل ومُسوى (Reconciled)
      await tx.run(`
        UPDATE inventory_audits SET
          status = 'reconciled',
          reconciled_at = CURRENT_TIMESTAMP,
          reconciled_by = ?,
          journal_entry_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [userId, journalEntryId, audit_id]);

      // 4. بث حدث المجال
      await materialDomainEventBus.publish('STOCK_RECONCILED', 'inventory_audit', audit.audit_no, {
        auditId: audit_id,
        audit_no: audit.audit_no,
        warehouse_id: audit.warehouse_id,
        itemsAdjustedCount: items.length,
        totalShortageAmount,
        totalOverageAmount,
        journalEntryNo: entry_no
      }, user);

      if (req) {
        await logAudit(req, {
          action: 'RECONCILE_AUDIT',
          entity_type: 'inventory_audit',
          entity_id: audit.audit_no,
          details: { audit_id, journal_entry_no: entry_no, totalShortageAmount, totalOverageAmount }
        });
      }

      return {
        success: true,
        audit_id,
        audit_no: audit.audit_no,
        status: 'reconciled',
        items_adjusted_count: items.length,
        total_shortage_amount: totalShortageAmount,
        total_overage_amount: totalOverageAmount,
        journal_entry_no: entry_no,
        journal_entry_id: journalEntryId
      };
    });
  },

  // =========================================================================
  // 2. حركة ودورة حياة المواد (Material Movement & Lifecycle)
  // =========================================================================

  /**
   * عزل المواد التالفة ونقلها إلى صندوق افتراضي "خردة/حجر صحي" مع إثبات خسائر التلف (Damaged Materials)
   */
  async quarantineDamagedMaterial(data, user, req = null) {
    const {
      warehouse_id,
      item_id,
      quantity,
      reason,
      inspection_notes,
      project_id = null,
      bin_location = 'QUARANTINE_BIN_01',
      date = new Date().toISOString().split('T')[0]
    } = data;

    if (!warehouse_id || !item_id || Number(quantity) <= 0) {
      throw new Error('يرجى تحديد المستودع والصنف والكمية التالفة الموجبة');
    }
    if (!reason) throw new Error('سبب التلف وتقرير المعاينة إلزامي لعزل المواد');

    await assertPeriodOpen(date);

    // صمام الأمان: منع الرصيد السالب
    const { assertNoNegativeStock } = require('./inventoryValuationService');
    await assertNoNegativeStock(warehouse_id, item_id, quantity);

    const userId = await resolveValidUserId(user?.id);
    const parsedQty = Number(quantity);

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      const whStock = await tx.get('SELECT * FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [warehouse_id, item_id]);
      const unitCost = Number(whStock?.average_cost || whStock?.last_cost || item.unit_price || 0);
      const totalLossAmount = parsedQty * unitCost;

      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM material_quarantine_items');
      const quarantine_no = `QRT-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // 1. خصم الكمية من رصيد المستودع الصالح للاستخدام
      await tx.run('UPDATE items SET current_quantity = current_quantity - ? WHERE id = ?', [parsedQty, item_id]);
      await tx.run('UPDATE warehouse_stocks SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ? AND item_id = ?', [parsedQty, warehouse_id, item_id]);

      // 2. إنشاء القيد المحاسبي لخسائر التلف: من حـ/ خسائر عجز وتلف المخزون (5105) إلى حـ/ أصل المخزون (11)
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'تلف مخزني', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, date, `قيد إثبات تلف وعزل مواد (${quarantine_no}) للصنف [${item.name}] - ${reason}`,
        totalLossAmount, totalLossAmount,
        userId, user?.username || 'المحاسب',
        userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?)
      `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_LOSS_SHRINKAGE, totalLossAmount, `مدين: خسائر تلف مخزني بموجب مستند ${quarantine_no}`]);

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, 0, ?, ?)
      `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, totalLossAmount, `دائن: تخفيض أصل المخزون بالعزل للتلف ${quarantine_no}`]);

      // 3. إدراج سجل الحجر والتوالف
      const qrtRes = await tx.run(`
        INSERT INTO material_quarantine_items (
          quarantine_no, item_id, warehouse_id, project_id, quantity, unit_cost,
          total_loss_amount, reason, inspection_notes, bin_location, status,
          quarantined_by, journal_entry_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', ?, ?)
      `, [
        quarantine_no, item_id, warehouse_id, project_id, parsedQty, unitCost,
        totalLossAmount, reason, inspection_notes || '', bin_location, userId, entryId
      ]);

      const quarantineId = qrtRes.lastInsertRowid || qrtRes.insertId;

      // 4. بث حدث المجال
      await materialDomainEventBus.publish('MATERIAL_QUARANTINED', 'material_quarantine', quarantine_no, {
        quarantineId,
        quarantine_no,
        item_id,
        item_name: item.name,
        quantity: parsedQty,
        totalLossAmount,
        bin_location,
        reason
      }, user);

      if (req) {
        await logAudit(req, {
          action: 'QUARANTINE_MATERIAL',
          entity_type: 'material_quarantine',
          entity_id: quarantine_no,
          details: { quarantine_no, item_id, quantity: parsedQty, totalLossAmount, entry_no }
        });
      }

      return {
        id: quarantineId,
        quarantine_no,
        item_id,
        quantity: parsedQty,
        total_loss_amount: totalLossAmount,
        bin_location,
        status: 'quarantined',
        journal_entry_no: entry_no
      };
    });
  },

  /**
   * معالجة مواد الحجر (إتلاف نهائي / خردة Scrapped أو إعادة تأهيل Refurbished)
   */
  async resolveQuarantinedMaterial(quarantine_id, data, user, req = null) {
    const { action, resolution_notes, salvage_value = 0 } = data;
    if (!quarantine_id) throw new Error('معرف سجل الحجر مطلوب');
    if (!['scrapped', 'refurbished', 'disposed'].includes(action)) {
      throw new Error("إجراء المعالجة غير صالح، يجب أن يكون: 'scrapped' أو 'refurbished' أو 'disposed'");
    }

    const qrt = await get('SELECT * FROM material_quarantine_items WHERE id = ?', [quarantine_id]);
    if (!qrt) throw new Error('سجل الحجر غير موجود');
    if (qrt.status !== QUARANTINE_STATUS.QUARANTINED) {
      throw new Error(`سجل الحجر [${qrt.quarantine_no}] معالج مسبقاً بحالة (${qrt.status})`);
    }

    const userId = await resolveValidUserId(user?.id);

    return await transaction(async (tx) => {
      // إذا تمت إعادة التأهيل (Refurbished)، نعيد المواد للمخزن بقيمة استردادية
      if (action === 'refurbished') {
        const salvageCost = Number(salvage_value) || Number(qrt.unit_cost) || 0;
        await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [qrt.quantity, qrt.item_id]);
        await tx.run(`
          INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
            quantity = quantity + excluded.quantity,
            updated_at = CURRENT_TIMESTAMP
        `, [qrt.warehouse_id, qrt.item_id, qrt.quantity, salvageCost, salvageCost]);
      }

      await tx.run(`
        UPDATE material_quarantine_items SET
          status = ?,
          resolution_date = CURRENT_TIMESTAMP,
          resolution_notes = ?,
          resolved_by = ?
        WHERE id = ?
      `, [action, resolution_notes || '', userId, quarantine_id]);

      await materialDomainEventBus.publish('MATERIAL_RESOLVED', 'material_quarantine', qrt.quarantine_no, {
        quarantineId: quarantine_id,
        quarantine_no: qrt.quarantine_no,
        action,
        resolution_notes
      }, user);

      return {
        id: quarantine_id,
        quarantine_no: qrt.quarantine_no,
        status: action,
        resolution_notes
      };
    });
  },

  /**
   * توثيق إيصالات المواد المعادة من الموقع للمخزن وفحص الجودة (Site-to-Warehouse Return with QC)
   * يطبق أفضل الممارسات: فحص الجودة (صالح، قابل للإصلاح، أو تالف/خردة) مع تخفيض تكلفة المشروع
   */
  async processSiteMaterialReturnWithQC(data, user, req = null) {
    const {
      project_id,
      warehouse_id,
      item_id,
      quantity,
      boq_item_id = null,
      condition_status = 'good', // 'good' | 'refurbishable' | 'damaged_scrap'
      qc_inspector_name,
      qc_notes,
      salvage_percentage = 100, // نسبة القيمة المستردة (100% للصالح، مثلاً 70% للقابل للتأهيل)
      date = new Date().toISOString().split('T')[0]
    } = data;

    if (!project_id || !warehouse_id || !item_id || Number(quantity) <= 0) {
      throw new Error('يرجى تحديد المشروع والمستودع والصنف والكمية المرتجعة');
    }
    if (!qc_inspector_name) throw new Error('اسم مهندس فحص الجودة (QC Inspector) إلزامي لتوثيق إيصال الإرجاع');

    await assertPeriodOpen(date);

    const userId = await resolveValidUserId(user?.id);
    const parsedQty = Number(quantity);
    const pct = Math.max(0, Math.min(100, Number(salvage_percentage) || 100)) / 100;

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      const project = await tx.get('SELECT * FROM projects WHERE id = ?', [project_id]);
      if (!item || !project) throw new Error('الصنف أو المشروع المحدد غير موجود');

      const unitPrice = Number(item.unit_price) || 0;
      const totalAmount = parsedQty * unitPrice;
      const creditedAmount = totalAmount * pct;
      const scrapLossAmount = totalAmount - creditedAmount;

      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM site_material_returns');
      const return_no = `MRR-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      let journalEntryId = null;
      let quarantineId = null;

      // أ. إذا كانت المادة صالحة أو قابلة لإعادة التأهيل: نعيدها للمخزن ونخفض تكلفة المشروع
      if (condition_status === 'good' || condition_status === 'refurbishable') {
        await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [parsedQty, item_id]);
        await tx.run(`
          INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
            quantity = quantity + excluded.quantity,
            updated_at = CURRENT_TIMESTAMP
        `, [warehouse_id, item_id, parsedQty, unitPrice * pct, unitPrice * pct]);

        // تخفيض التكلفة الفعلية للمشروع بالقيمة المستردة
        await tx.run('UPDATE projects SET actual_cost = MAX(0, actual_cost - ?) WHERE id = ?', [creditedAmount, project_id]);

        // قيد محاسبي: من حـ/ المخزون إلى حـ/ تكاليف المشروع
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

        const jvRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, total_debit, total_credit,
            status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          ) VALUES (?, ?, ?, 'مرتجع موقع معتمد QC', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entry_no, date,
          `قيد مرتجع مواد بموجب محضر فحص الجودة (${return_no}) لمشروع [${project.name}]`,
          creditedAmount, creditedAmount,
          userId, user?.username || 'المحاسب',
          userId, user?.username || 'المحاسب'
        ]);

        journalEntryId = jvRes.lastInsertRowid || jvRes.insertId;

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?)
        `, [journalEntryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, creditedAmount, `مدين: استعادة أصل المخزون بموجب ${return_no}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?, ?)
        `, [journalEntryId, INVENTORY_ACCOUNTS.PROJECT_EXPENSES, project_id, creditedAmount, `دائن: تخفيض تكلفة المشروع [${project.name}] بموجب ${return_no}`]);
      } else {
        // ب. إذا كانت تالفة/خردة (damaged_scrap): تحول مباشرة إلى حجر التوالف
        const qrtRes = await MaterialManagementService.quarantineDamagedMaterial({
          warehouse_id,
          item_id,
          quantity: parsedQty,
          reason: `مادة تالفة معادة من موقع مشروع [${project.name}]: ${qc_notes || ''}`,
          inspection_notes: `معاينة استلام موقع بواسطة: ${qc_inspector_name}`,
          project_id
        }, user, req);
        quarantineId = qrtRes.id;
      }

      // تسجيل إيصال الإرجاع والفحص
      const mrrRes = await tx.run(`
        INSERT INTO site_material_returns (
          return_no, project_id, warehouse_id, boq_item_id, item_id,
          quantity, unit_price, total_amount, condition_status,
          qc_inspector_id, qc_inspector_name, qc_notes, qc_passed,
          salvage_percentage, credited_amount, scrap_loss_amount,
          return_date, status, journal_entry_id, quarantine_id, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reconciled', ?, ?, ?)
      `, [
        return_no, project_id, warehouse_id, boq_item_id, item_id,
        parsedQty, unitPrice, totalAmount, condition_status,
        userId, qc_inspector_name, qc_notes || '',
        condition_status === 'damaged_scrap' ? 0 : 1,
        pct * 100, creditedAmount, scrapLossAmount,
        date, journalEntryId, quarantineId, userId
      ]);

      await materialDomainEventBus.publish('SITE_RETURN_QC_INSPECTED', 'site_material_return', return_no, {
        returnId: mrrRes.lastInsertRowid || mrrRes.insertId,
        return_no,
        project_id,
        item_id,
        quantity: parsedQty,
        condition_status,
        creditedAmount,
        qc_inspector_name
      }, user);

      return {
        id: mrrRes.lastInsertRowid || mrrRes.insertId,
        return_no,
        project_id,
        condition_status,
        quantity: parsedQty,
        credited_amount: creditedAmount,
        scrap_loss_amount: scrapLossAmount,
        qc_passed: condition_status !== 'damaged_scrap',
        status: 'reconciled'
      };
    });
  },

  /**
   * طلب تحويل مواد بين المشاريع وفق قواعد توجيه صارمة (Inter-Project Transfer Request)
   */
  async requestInterProjectTransfer(data, user, req = null) {
    const {
      from_project_id,
      to_project_id,
      from_warehouse_id,
      to_warehouse_id,
      item_id,
      quantity,
      from_boq_item_id = null,
      to_boq_item_id = null,
      notes,
      transfer_date = new Date().toISOString().split('T')[0]
    } = data;

    if (!from_project_id || !to_project_id) throw new Error('يرجى تحديد المشروع المصدر والمشروع المستلم');
    if (String(from_project_id) === String(to_project_id)) throw new Error('لا يمكن التحويل لنفس المشروع');
    if (!from_warehouse_id || !to_warehouse_id) throw new Error('يرجى تحديد مستودعات التحويل');
    if (!item_id || Number(quantity) <= 0) throw new Error('يرجى تحديد الصنف والكمية الإيجابية');

    await assertPeriodOpen(transfer_date);

    // صمام الأمان: التأكد من توفر الرصيد بالمستودع المصدر
    const { assertNoNegativeStock } = require('./inventoryValuationService');
    await assertNoNegativeStock(from_warehouse_id, item_id, quantity);

    const fromProject = await get('SELECT * FROM projects WHERE id = ?', [from_project_id]);
    const toProject = await get('SELECT * FROM projects WHERE id = ?', [to_project_id]);
    if (!fromProject) throw new Error(`المشروع المصدر رقم (${from_project_id}) غير موجود`);
    if (!toProject) throw new Error(`المشروع المستلم رقم (${to_project_id}) غير موجود`);

    if (toProject.status === 'completed' || toProject.status === 'cancelled') {
      throw new Error(`⛔ حظر التحويل: المشروع المستلم [${toProject.name}] منتهي أو ملغي ولا يمكن تحويل مواد إليه`);
    }

    const item = await get('SELECT * FROM items WHERE id = ?', [item_id]);
    const unitCost = Number(item.unit_price) || 0;
    const parsedQty = Number(quantity);
    const totalAmount = parsedQty * unitCost;

    // توثيق قواعد التوجيه المطبقة (Routing Rules Summary)
    const routingRules = {
      donor_project_verified: true,
      donor_project_name: fromProject.name,
      recipient_project_active: true,
      recipient_project_name: toProject.name,
      source_stock_verified: true,
      maker_checker_required: true,
      boq_bound: Boolean(to_boq_item_id)
    };

    const userId = await resolveValidUserId(user?.id);
    const countRes = await get('SELECT COUNT(*) as cnt FROM inter_project_material_transfers');
    const transfer_no = `IPT-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    const trfRes = await run(`
      INSERT INTO inter_project_material_transfers (
        transfer_no, from_project_id, to_project_id, from_warehouse_id, to_warehouse_id,
        item_id, quantity, unit_cost, total_amount, from_boq_item_id, to_boq_item_id,
        routing_rules_applied, status, requested_by, requested_by_name, transfer_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)
    `, [
      transfer_no, from_project_id, to_project_id, from_warehouse_id, to_warehouse_id,
      item_id, parsedQty, unitCost, totalAmount, from_boq_item_id, to_boq_item_id,
      JSON.stringify(routingRules), userId, user?.username || 'مهندس الموقع', transfer_date
    ]);

    const transferId = trfRes.lastInsertRowid || trfRes.insertId;

    await materialDomainEventBus.publish('INTER_PROJECT_TRANSFER_REQUESTED', 'inter_project_transfer', transfer_no, {
      transferId,
      transfer_no,
      from_project_id,
      to_project_id,
      item_id,
      quantity: parsedQty,
      totalAmount
    }, user);

    return {
      id: transferId,
      transfer_no,
      from_project_name: fromProject.name,
      to_project_name: toProject.name,
      quantity: parsedQty,
      total_amount: totalAmount,
      status: 'requested'
    };
  },

  /**
   * اعتماد وإعادة توجيه تكلفة التحويل بين المشاريع مع تطبيق الرقابة الثنائية الصارمة (Maker-Checker)
   */
  async approveInterProjectTransfer(transfer_id, approvalData, user, req = null) {
    const { approved = true, rejection_reason = '' } = approvalData;
    if (!transfer_id) throw new Error('معرف التحويل مطلوب');

    const transfer = await get(`
      SELECT t.*, 
             fp.name as from_project_name, tp.name as to_project_name,
             i.name as item_name
      FROM inter_project_material_transfers t
      JOIN projects fp ON t.from_project_id = fp.id
      JOIN projects tp ON t.to_project_id = tp.id
      JOIN items i ON t.item_id = i.id
      WHERE t.id = ?
    `, [transfer_id]);

    if (!transfer) throw new Error('طلب التحويل غير موجود');
    if (transfer.status !== TRANSFER_STATUS.REQUESTED) {
      throw new Error(`طلب التحويل [${transfer.transfer_no}] بحالة (${transfer.status}) ولا يمكن اعتماده ثانية`);
    }

    // 🔒 صمام الأمان والرقابة الثنائية: منع منشئ طلب التحويل من اعتماده بنفسه (Maker-Checker)
    assertMakerChecker({
      created_by: transfer.requested_by,
      created_by_name: transfer.requested_by_name
    }, user, 'اعتماد تحويل المواد بين المشاريع');

    const userId = await resolveValidUserId(user?.id);
    const todayDate = new Date().toISOString().split('T')[0];
    await assertPeriodOpen(todayDate);

    if (!approved) {
      await run(`
        UPDATE inter_project_material_transfers SET
          status = 'rejected',
          approved_by = ?,
          approved_by_name = ?,
          rejection_reason = ?
        WHERE id = ?
      `, [userId, user?.username || 'المدير المالي', rejection_reason || 'تم رفض التحويل من قبل الإدارة', transfer_id]);

      await materialDomainEventBus.publish('INTER_PROJECT_TRANSFER_REJECTED', 'inter_project_transfer', transfer.transfer_no, {
        transferId: transfer_id,
        transfer_no: transfer.transfer_no,
        rejection_reason
      }, user);

      return { id: transfer_id, transfer_no: transfer.transfer_no, status: 'rejected' };
    }

    return await transaction(async (tx) => {
      const parsedQty = Number(transfer.quantity);
      const totalAmount = Number(transfer.total_amount);

      // 1. تحريك الكمية بين المستودعات
      await tx.run('UPDATE warehouse_stocks SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ? AND item_id = ?', [parsedQty, transfer.from_warehouse_id, transfer.item_id]);
      await tx.run(`
        INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `, [transfer.to_warehouse_id, transfer.item_id, parsedQty, transfer.unit_cost, transfer.unit_cost]);

      // 2. إعادة توجيه التكلفة الفعلية بين المشروعين في قاعدة البيانات
      await tx.run('UPDATE projects SET actual_cost = MAX(0, actual_cost - ?) WHERE id = ?', [totalAmount, transfer.from_project_id]);
      await tx.run('UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?', [totalAmount, transfer.to_project_id]);

      // 3. إنشاء قيد محاسبي متزن لإعادة توجيه التكلفة في دفتر الأستاذ العام
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'تحويل مواد بين مشاريع', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, todayDate,
        `قيد تحويل تكلفة مواد (${transfer.transfer_no}) من مشروع [${transfer.from_project_name}] إلى [${transfer.to_project_name}]`,
        totalAmount, totalAmount,
        userId, user?.username || 'المدير المالي',
        userId, user?.username || 'المدير المالي'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // مدين: تكاليف ومصروفات المشروع المستلم
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?)
      `, [entryId, INVENTORY_ACCOUNTS.PROJECT_EXPENSES, transfer.to_project_id, totalAmount, `مدين: تكلفة مواد محولة من مشروع ${transfer.from_project_name}`]);

      // دائن: تخفيض تكاليف ومصروفات المشروع المصدر
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?, ?)
      `, [entryId, INVENTORY_ACCOUNTS.PROJECT_EXPENSES, transfer.from_project_id, totalAmount, `دائن: تخفيض تكلفة مواد محولة إلى مشروع ${transfer.to_project_name}`]);

      // 4. تحديث حالة طلب التحويل
      await tx.run(`
        UPDATE inter_project_material_transfers SET
          status = 'approved',
          approved_by = ?,
          approved_by_name = ?,
          journal_entry_id = ?
        WHERE id = ?
      `, [userId, user?.username || 'المدير المالي', entryId, transfer_id]);

      await materialDomainEventBus.publish('INTER_PROJECT_TRANSFER_APPROVED', 'inter_project_transfer', transfer.transfer_no, {
        transferId: transfer_id,
        transfer_no: transfer.transfer_no,
        from_project_id: transfer.from_project_id,
        to_project_id: transfer.to_project_id,
        totalAmount,
        journal_entry_no: entry_no
      }, user);

      if (req) {
        await logAudit(req, {
          action: 'APPROVE_PROJECT_TRANSFER',
          entity_type: 'inter_project_transfer',
          entity_id: transfer.transfer_no,
          details: { transfer_no: transfer.transfer_no, from_project: transfer.from_project_name, to_project: transfer.to_project_name, totalAmount, entry_no }
        });
      }

      return {
        id: transfer_id,
        transfer_no: transfer.transfer_no,
        status: 'approved',
        journal_entry_no: entry_no
      };
    });
  },

  /**
   * تأكيد الاستلام الفعلي في موقع المشروع المستلم (Receive Inter-Project Transfer)
   */
  async receiveInterProjectTransfer(transfer_id, user, req = null) {
    const transfer = await get('SELECT * FROM inter_project_material_transfers WHERE id = ?', [transfer_id]);
    if (!transfer) throw new Error('طلب التحويل غير موجود');
    if (transfer.status !== TRANSFER_STATUS.APPROVED) {
      throw new Error(`لا يمكن استلام التحويل وهو بحالة (${transfer.status})`);
    }

    const userId = await resolveValidUserId(user?.id);
    await run(`
      UPDATE inter_project_material_transfers SET
        status = 'received',
        received_by = ?,
        received_by_name = ?
      WHERE id = ?
    `, [userId, user?.username || 'مهندس الموقع المستلم', transfer_id]);

    await materialDomainEventBus.publish('INTER_PROJECT_TRANSFER_RECEIVED', 'inter_project_transfer', transfer.transfer_no, {
      transferId: transfer_id,
      transfer_no: transfer.transfer_no
    }, user);

    return { id: transfer_id, transfer_no: transfer.transfer_no, status: 'received' };
  },

  // =========================================================================
  // 3. التحقق الرقمي واسترجاع الوثائق (Integrity & Document Retrieval)
  // =========================================================================

  /**
   * التحقق الرياضي والمشفر من عدم التلاعب بمحضر الجرد (Verify Audit Minutes Integrity)
   */
  async verifyAuditMinutesIntegrity(audit_id) {
    const audit = await get('SELECT * FROM inventory_audits WHERE id = ?', [audit_id]);
    if (!audit) throw new Error('محضر الجرد غير موجود');
    if (!audit.hash_signature || !audit.minutes_doc) {
      return { isValid: false, message: 'المحضر لم يتم ختمه رقمياً بعد' };
    }

    let parsedDoc = null;
    try {
      parsedDoc = JSON.parse(audit.minutes_doc);
    } catch {
      return { isValid: false, message: 'وثيقة المحضر المخزنة تالفة أو غير صالحة' };
    }

    // نسخ الوثيقة بدون حقل الختم الأمني لحساب الهاش الأصلي
    const { security_seal, ...canonicalData } = parsedDoc;
    const computedHash = crypto
      .createHmac('sha256', SECRET_SEAL_KEY)
      .update(JSON.stringify(canonicalData))
      .digest('hex');

    const isValid = computedHash === audit.hash_signature;

    return {
      isValid,
      audit_no: audit.audit_no,
      stored_hash: audit.hash_signature,
      computed_hash: computedHash,
      sealed_at: parsedDoc?.header?.sealed_at,
      auditor_name: audit.auditor_name,
      digital_signature: audit.digital_signature,
      message: isValid
        ? '✓ تم التحقق بنجاح: محضر الجرد مطابق للختم الرقمي ولم يتعرض لأي تعديل أو تلاعب.'
        : '⛔ تنبيه أمني: تم اكتشاف اختلاف بين الهاش المشفر ومحتوى محضر الجرد! هناك شبهة تلاعب بالبيانات.'
    };
  }
};

module.exports = MaterialManagementService;

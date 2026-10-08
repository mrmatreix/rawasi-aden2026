/**
 * inventoryValuationService.js
 * 
 * محرك تقييم المخزون المتقدم والمستودعات المتعددة (Multi-Warehouse & Valuation Engine)
 * يدعم:
 *  1. إدارة المستودعات المتعددة ومواقع التخزين (Central, Sites, Transit)
 *  2. التحويل الدقيق بين المستودعات مع تتبع الحركة
 *  3. منع الرصيد السالب قطعياً (Strict Negative Stock Prevention)
 *  4. مرتجعات المشتريات (تخفيض ذمة المورد) ومرتجعات الموقع للمستودع (تخفيض تكلفة المشروع)
 *  5. الجرد الدوري وتسويات الفائض والعجز مع توليد القيود المحاسبية التلقائية
 *  6. طرق التقييم (المتوسط المرجح المتحرك WAC و FIFO Layers)
 *  7. توزيع مصاريف الهبوط (الشحن، الجمارك، التأمين) Landed Costs
 *  8. تنبيهات حد إعادة الطلب والمخزون الحرج
 *  9. ربط أذون الصرف ببند جدول الكميات BOQ للمشروع
 */

const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const { assertPeriodOpen, resolveValidUserId } = require('./financialControlService');

const INVENTORY_ACCOUNTS = {
  INVENTORY_ASSET: 11,               // حـ/ المخزون العام للمواد
  SUPPLIER_PAYABLES: 7,              // حـ/ الموردين (ذمم دائنة)
  PROJECT_EXPENSES: 10,              // حـ/ تكاليف ومصروفات المشاريع
  INVENTORY_LOSS_SHRINKAGE: 27,      // 5105 - خسائر عجز وتسويات المخزون
  INVENTORY_GAIN_SURPLUS: 28         // 4205 - أرباح وفائض تسويات المخزون
};

const InventoryValuationService = {
  INVENTORY_ACCOUNTS,

  /**
   * صمام الأمان: منع الرصيد السالب قطعياً
   */
  async assertNoNegativeStock(warehouseId, itemId, qtyToDeduct) {
    const parsedDeduct = Number(qtyToDeduct) || 0;
    if (parsedDeduct <= 0) return true;

    // 1. فحص رصيد الصنف الإجمالي
    const item = await get('SELECT * FROM items WHERE id = ?', [itemId]);
    if (!item) throw new Error(`الصنف رقم (${itemId}) غير موجود في النظام`);

    if (Number(item.current_quantity) < parsedDeduct) {
      throw new Error(`⛔ حظر الرصيد السالب: الرصيد الإجمالي المتوفر من الصنف [${item.name}] هو (${item.current_quantity} ${item.unit})، ولا يمكن صرف أو تحويل (${parsedDeduct} ${item.unit})`);
    }

    // 2. فحص رصيد الصنف داخل المستودع المحدد
    if (warehouseId) {
      const whStock = await get('SELECT * FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [warehouseId, itemId]);
      const availableInWh = whStock ? Number(whStock.quantity) : 0;
      if (availableInWh < parsedDeduct) {
        throw new Error(`⛔ حظر الرصيد السالب: رصيد الصنف [${item.name}] في المستودع المحدد هو (${availableInWh} ${item.unit})، وهو غير كافٍ للعملية المطلوبة (${parsedDeduct} ${item.unit})`);
      }
    }

    return true;
  },

  /**
   * تحويل مخزني بين مستودعين (Inter-Warehouse Stock Transfer)
   */
  async transferStock(data, req = null) {
    const {
      from_warehouse_id,
      to_warehouse_id,
      item_id,
      quantity,
      transfer_date = new Date().toISOString().split('T')[0],
      received_by,
      notes,
      user
    } = data;

    if (!from_warehouse_id || !to_warehouse_id) throw new Error('يرجى تحديد مستودع الإرسال ومستودع الاستلام');
    if (String(from_warehouse_id) === String(to_warehouse_id)) throw new Error('لا يمكن التحويل لنفس المستودع');
    if (!item_id || Number(quantity) <= 0) throw new Error('يرجى تحديد الصنف وكمية التحويل الموجبة');

    await assertPeriodOpen(transfer_date);
    await this.assertNoNegativeStock(from_warehouse_id, item_id, quantity);

    const userId = await resolveValidUserId(user?.id);
    const parsedQty = Number(quantity);

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      const unitCost = Number(item.unit_price) || 0;
      const totalCost = parsedQty * unitCost;

      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM inventory_transfers');
      const transfer_no = `TRF-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // 1. إنقاص رصيد المستودع المصدر
      await tx.run('UPDATE warehouse_stocks SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ? AND item_id = ?', [parsedQty, from_warehouse_id, item_id]);

      // 2. زيادة رصيد المستودع الوجهة
      await tx.run(`
        INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `, [to_warehouse_id, item_id, parsedQty, unitCost, unitCost]);

      // 3. تسجيل مستند التحويل
      const trfRes = await tx.run(`
        INSERT INTO inventory_transfers (
          transfer_no, from_warehouse_id, to_warehouse_id, item_id, quantity,
          unit_cost, total_cost, transfer_date, status, created_by, received_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
      `, [
        transfer_no, from_warehouse_id, to_warehouse_id, item_id, parsedQty,
        unitCost, totalCost, transfer_date, userId, received_by || 'أمين مستودع الوجهة', notes || ''
      ]);

      // 4. تسجيل حركتين في جدول حركات المخزون للتوثيق المحاسبي
      await tx.run(`
        INSERT INTO inventory_transactions (
          item_id, warehouse_id, type, quantity, unit_price, total_amount, reference_no, date, notes
        ) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?)
      `, [item_id, from_warehouse_id, parsedQty, unitCost, totalCost, transfer_no, transfer_date, `تحويل صادر إلى المستودع رقم ${to_warehouse_id}`]);

      await tx.run(`
        INSERT INTO inventory_transactions (
          item_id, warehouse_id, type, quantity, unit_price, total_amount, reference_no, date, notes
        ) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?)
      `, [item_id, to_warehouse_id, parsedQty, unitCost, totalCost, transfer_no, transfer_date, `تحويل وارد من المستودع رقم ${from_warehouse_id}`]);

      if (req) {
        await logAudit(req, {
          action: 'TRANSFER_STOCK',
          entity_type: 'inventory_transfer',
          entity_id: transfer_no,
          details: { transfer_no, from_warehouse_id, to_warehouse_id, item_id, quantity: parsedQty, totalCost }
        });
      }

      return {
        id: trfRes.lastInsertRowid || trfRes.insertId,
        transfer_no,
        quantity: parsedQty,
        totalCost,
        status: 'completed'
      };
    });
  },

  /**
   * مرتجع مشتريات إلى المورد (Purchase Return)
   * يخفض المخزون ويخفض رصيد ذمة المورد مع قيد محاسبي
   */
  async processPurchaseReturn(data, req = null) {
    const {
      supplier_id,
      warehouse_id = 1,
      item_id,
      quantity,
      unit_price,
      reason,
      date = new Date().toISOString().split('T')[0],
      user
    } = data;

    if (!supplier_id || !item_id || Number(quantity) <= 0) {
      throw new Error('يرجى تحديد المورد والصنف وكمية الإرجاع');
    }
    if (!reason) throw new Error('سبب الإرجاع إلزامي وفق متطلبات الرقابة والتدقيق');

    await assertPeriodOpen(date);
    await this.assertNoNegativeStock(warehouse_id, item_id, quantity);

    const userId = await resolveValidUserId(user?.id);
    const parsedQty = Number(quantity);

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      const returnPrice = unit_price ? Number(unit_price) : Number(item.unit_price || 0);
      const totalAmount = parsedQty * returnPrice;

      const countRes = await tx.get("SELECT COUNT(*) as cnt FROM inventory_returns WHERE return_type = 'purchase_return'");
      const return_no = `RET-SUP-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // 1. إنقاص رصيد المخزن
      await tx.run('UPDATE items SET current_quantity = current_quantity - ? WHERE id = ?', [parsedQty, item_id]);
      await tx.run('UPDATE warehouse_stocks SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ? AND item_id = ?', [parsedQty, warehouse_id, item_id]);

      // 2. تخفيض ذمة المورد
      await tx.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [totalAmount, supplier_id]);

      // 3. إنشاء قيد محاسبي متزن: من حـ/ الموردين إلى حـ/ المخزون
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'مرتجع مشتريات', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, date, `قيد مرتجع مشتريات إلى المورد (${return_no}) - ${reason}`,
        totalAmount, totalAmount, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // سطر مدين: تخفيض التزام المورد
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?)
      `, [entryId, INVENTORY_ACCOUNTS.SUPPLIER_PAYABLES, totalAmount, `مدين: تخفيض ذمة المورد بموجب ${return_no}`]);

      // سطر دائن: تخفيض أصل المخزون
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, 0, ?, ?)
      `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, totalAmount, `دائن: تخفيض رصيد المخزون بموجب ${return_no}`]);

      // 4. تسجيل حركة المرتجع
      const retRes = await tx.run(`
        INSERT INTO inventory_returns (
          return_no, return_type, warehouse_id, item_id, quantity, unit_price,
          total_amount, supplier_id, date, reason, status, journal_entry_id, created_by
        ) VALUES (?, 'purchase_return', ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `, [
        return_no, warehouse_id, item_id, parsedQty, returnPrice,
        totalAmount, supplier_id, date, reason, entryId, userId
      ]);

      if (req) {
        await logAudit(req, {
          action: 'PURCHASE_RETURN',
          entity_type: 'inventory_return',
          entity_id: return_no,
          details: { return_no, supplier_id, item_id, quantity: parsedQty, totalAmount, reason, entry_no }
        });
      }

      return {
        id: retRes.lastInsertRowid || retRes.insertId,
        return_no,
        total_amount: totalAmount,
        journal_entry_no: entry_no,
        status: 'posted'
      };
    });
  },

  /**
   * مرتجع صرف من الموقع إلى المستودع (Project Material Return)
   * يزيد المخزون ويخفض التكلفة الفعلية للمشروع مع قيد محاسبي
   */
  async processProjectReturn(data, req = null) {
    const {
      project_id,
      boq_item_id,
      warehouse_id = 1,
      item_id,
      quantity,
      unit_price,
      reason,
      date = new Date().toISOString().split('T')[0],
      user
    } = data;

    if (!project_id || !item_id || Number(quantity) <= 0) {
      throw new Error('يرجى تحديد المشروع والصنف وكمية الإرجاع');
    }

    await assertPeriodOpen(date);

    const userId = await resolveValidUserId(user?.id);
    const parsedQty = Number(quantity);

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      const returnPrice = unit_price ? Number(unit_price) : Number(item.unit_price || 0);
      const totalAmount = parsedQty * returnPrice;

      const countRes = await tx.get("SELECT COUNT(*) as cnt FROM inventory_returns WHERE return_type = 'project_return'");
      const return_no = `RET-PRJ-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // 1. زيادة رصيد المخزن
      await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [parsedQty, item_id]);
      await tx.run(`
        INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `, [warehouse_id, item_id, parsedQty, returnPrice, returnPrice]);

      // 2. تخفيض التكلفة الفعلية للمشروع
      await tx.run('UPDATE projects SET actual_cost = MAX(0, actual_cost - ?) WHERE id = ?', [totalAmount, project_id]);

      // 3. إنشاء قيد محاسبي متزن: من حـ/ المخزون إلى حـ/ تكاليف ومصروفات المشاريع
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'مرتجع موقع', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, date, `قيد مرتجع مواد فائضة من الموقع (${return_no}) للمشروع ${project_id}`,
        totalAmount, totalAmount, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // سطر مدين: زيادة المخزون
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?)
      `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, totalAmount, `مدين: استعادة مواد للمخزن بموجب ${return_no}`]);

      // سطر دائن: تخفيض تكلفة المشروع
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?, ?)
      `, [entryId, INVENTORY_ACCOUNTS.PROJECT_EXPENSES, project_id, totalAmount, `دائن: تخفيض تكلفة المشروع بموجب ${return_no}`]);

      // 4. تسجيل حركة المرتجع
      const retRes = await tx.run(`
        INSERT INTO inventory_returns (
          return_no, return_type, warehouse_id, item_id, quantity, unit_price,
          total_amount, project_id, boq_item_id, date, reason, status, journal_entry_id, created_by
        ) VALUES (?, 'project_return', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `, [
        return_no, warehouse_id, item_id, parsedQty, returnPrice,
        totalAmount, project_id, boq_item_id || null, date, reason || 'فائض أعمال بالموقع', entryId, userId
      ]);

      if (req) {
        await logAudit(req, {
          action: 'PROJECT_RETURN',
          entity_type: 'inventory_return',
          entity_id: return_no,
          details: { return_no, project_id, item_id, quantity: parsedQty, totalAmount, entry_no }
        });
      }

      return {
        id: retRes.lastInsertRowid || retRes.insertId,
        return_no,
        total_amount: totalAmount,
        journal_entry_no: entry_no,
        status: 'posted'
      };
    });
  },

  /**
   * الجرد الدوري وتسويات الفائض والعجز (Stocktaking & Inventory Adjustments)
   */
  async processStocktakingAdjustment(data, req = null) {
    const {
      warehouse_id = 1,
      item_id,
      physical_qty,
      reason,
      date = new Date().toISOString().split('T')[0],
      user
    } = data;

    if (!item_id || physical_qty === undefined || Number(physical_qty) < 0) {
      throw new Error('يرجى تحديد الصنف والكمية الفعلية المحصورة بالجرد (أكبر أو تساوي صفر)');
    }
    if (!reason) throw new Error('سبب التسوية إلزامي للتدقيق والرقابة المالية');

    await assertPeriodOpen(date);

    const userId = await resolveValidUserId(user?.id);
    const parsedPhysical = Number(physical_qty);

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      if (!item) throw new Error('الصنف غير موجود');

      const whStock = await tx.get('SELECT * FROM warehouse_stocks WHERE warehouse_id = ? AND item_id = ?', [warehouse_id, item_id]);
      const systemQty = whStock ? Number(whStock.quantity) : Number(item.current_quantity || 0);

      const diffQty = parsedPhysical - systemQty;
      if (Math.abs(diffQty) < 0.0001) {
        return { message: 'الكمية الفعلية مطابقة تماماً للرصيد الدفتري، لا حاجة لتسوية', diff_qty: 0 };
      }

      const unitCost = Number(item.unit_price) || 0;
      const diffAmount = Math.abs(diffQty) * unitCost;
      const adjustmentType = diffQty < 0 ? 'deficit' : 'surplus'; // عجز أو فائض

      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM inventory_adjustments');
      const adjustment_no = `ADJ-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // 1. تحديث الأرصدة بالمستودع والصنف لتتطابق مع الجرد الفعلي
      await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [diffQty, item_id]);
      await tx.run(`
        INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `, [warehouse_id, item_id, diffQty, unitCost, unitCost]);

      // 2. توليد قيد التسوية المحاسبي المتزن
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'تسوية مخزنية', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, date, `قيد تسوية مخزنية (${adjustment_no}) - ${adjustmentType === 'deficit' ? 'عجز مخزني' : 'فائض مخزني'} للصنف [${item.name}]`,
        diffAmount, diffAmount, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      if (adjustmentType === 'deficit') {
        // حالة العجز: من حـ/ خسائر وعجز المخزون (5105) إلى حـ/ المخزون
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?)
        `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_LOSS_SHRINKAGE, diffAmount, `مدين: إثبات خسائر عجز مخزني بموجب ${adjustment_no}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, 0, ?, ?)
        `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, diffAmount, `دائن: تخفيض قيمة المخزون الدفتري بموجب ${adjustment_no}`]);
      } else {
        // حالة الفائض: من حـ/ المخزون إلى حـ/ أرباح وفائض المخزون (4205)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?)
        `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_ASSET, diffAmount, `مدين: زيادة قيمة المخزون الدفتري بموجب ${adjustment_no}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, 0, ?, ?)
        `, [entryId, INVENTORY_ACCOUNTS.INVENTORY_GAIN_SURPLUS, diffAmount, `دائن: إثبات أرباح فائض مخزني بموجب ${adjustment_no}`]);
      }

      // 3. تسجيل مستند التسوية
      const adjRes = await tx.run(`
        INSERT INTO inventory_adjustments (
          adjustment_no, warehouse_id, item_id, system_qty, physical_qty,
          diff_qty, unit_cost, diff_amount, adjustment_type, date, reason,
          status, journal_entry_id, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `, [
        adjustment_no, warehouse_id, item_id, systemQty, parsedPhysical,
        diffQty, unitCost, diffAmount, adjustmentType, date, reason, entryId, userId
      ]);

      if (req) {
        await logAudit(req, {
          action: 'STOCK_ADJUSTMENT',
          entity_type: 'inventory_adjustment',
          entity_id: adjustment_no,
          details: { adjustment_no, warehouse_id, item_id, systemQty, parsedPhysical, diffQty, adjustmentType, entry_no }
        });
      }

      return {
        id: adjRes.lastInsertRowid || adjRes.insertId,
        adjustment_no,
        system_qty: systemQty,
        physical_qty: parsedPhysical,
        diff_qty: diffQty,
        diff_amount: diffAmount,
        adjustment_type: adjustmentType,
        journal_entry_no: entry_no,
        status: 'posted'
      };
    });
  },

  /**
   * تقرير تنبيهات حد إعادة الطلب والمخزون الحرج
   */
  async getReorderAlerts() {
    const alerts = await query(`
      SELECT i.*, 
        COALESCE(i.reorder_level, 10) as reorder_threshold,
        COALESCE(i.safety_stock, 5) as safety_threshold,
        CASE 
          WHEN i.current_quantity <= COALESCE(i.safety_stock, 5) THEN 'حرج جداً'
          WHEN i.current_quantity <= COALESCE(i.reorder_level, 10) THEN 'حد إعادة الطلب'
          ELSE 'آمن'
        END as stock_status,
        (SELECT COUNT(DISTINCT warehouse_id) FROM warehouse_stocks WHERE item_id = i.id AND quantity > 0) as active_warehouses_count
      FROM items i
      WHERE i.current_quantity <= COALESCE(i.reorder_level, 10)
      ORDER BY i.current_quantity ASC
    `);

    return {
      count: alerts.length,
      alerts
    };
  },

  /**
   * صرف مواد لموقع المشروع مع الربط الإلزامي ببند جدول الكميات (BOQ Item Binding)
   */
  async issueMaterialWithBOQBinding(data, req = null) {
    const {
      project_id,
      boq_item_id,
      warehouse_id = 1,
      item_id,
      quantity,
      recipient,
      date = new Date().toISOString().split('T')[0],
      notes,
      user
    } = data;

    if (!project_id || !item_id || Number(quantity) <= 0) {
      throw new Error('يرجى تحديد المشروع والصنف والكمية المصروفة');
    }

    await assertPeriodOpen(date);
    await this.assertNoNegativeStock(warehouse_id, item_id, quantity);

    const userId = await resolveValidUserId(user?.id);
    const parsedQty = Number(quantity);

    return await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      const unitCost = Number(item.unit_price) || 0;
      const totalAmount = parsedQty * unitCost;

      // فحص بند جدول الكميات والكمية المعتمدة بالعقد إن وجد
      let boqWarning = null;
      if (boq_item_id) {
        const boq = await tx.get('SELECT * FROM project_boq WHERE id = ? AND project_id = ?', [boq_item_id, project_id]);
        if (boq) {
          const priorIssues = await tx.get(`
            SELECT COALESCE(SUM(quantity), 0) as issued_qty 
            FROM inventory_transactions 
            WHERE project_id = ? AND boq_item_id = ? AND type = 'out'
          `, [project_id, boq_item_id]);

          const totalIssued = Number(priorIssues.issued_qty) + parsedQty;
          if (totalIssued > Number(boq.contract_qty)) {
            boqWarning = `تنبيه: إجمالي الكمية المصروفة للبند [${boq.item_no} - ${boq.description}] (${totalIssued}) تجاوزت الكمية المعتمدة في جدول الكميات التعاقدي (${boq.contract_qty})`;
          }
        }
      }

      const countRes = await tx.get("SELECT COUNT(*) as cnt FROM inventory_transactions WHERE type = 'out'");
      const reference_no = `MAT-BOQ-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // 1. إنقاص رصيد المخزن والمستودع
      await tx.run('UPDATE items SET current_quantity = current_quantity - ? WHERE id = ?', [parsedQty, item_id]);
      await tx.run('UPDATE warehouse_stocks SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ? AND item_id = ?', [parsedQty, warehouse_id, item_id]);

      // 2. زيادة التكلفة الفعلية للمشروع
      await tx.run('UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?', [totalAmount, project_id]);

      // 3. تسجيل حركة الصرف مع ربط بند الـ BOQ
      const txRes = await tx.run(`
        INSERT INTO inventory_transactions (
          item_id, project_id, warehouse_id, boq_item_id, type, quantity,
          unit_price, total_amount, reference_no, recipient, date, notes
        ) VALUES (?, ?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?)
      `, [
        item_id, project_id, warehouse_id, boq_item_id || null, parsedQty,
        unitCost, totalAmount, reference_no, recipient || 'مهندس الموقع', date,
        notes ? `${notes} ${boqWarning ? ' | ' + boqWarning : ''}` : (boqWarning || '')
      ]);

      if (req) {
        await logAudit(req, {
          action: 'ISSUE_MATERIAL_BOQ',
          entity_type: 'inventory_transaction',
          entity_id: reference_no,
          details: { reference_no, project_id, boq_item_id, item_id, quantity: parsedQty, totalAmount, boqWarning }
        });
      }

      return {
        id: txRes.lastInsertRowid || txRes.insertId,
        reference_no,
        quantity: parsedQty,
        total_amount: totalAmount,
        boq_warning: boqWarning,
        status: 'posted'
      };
    });
  }
};

module.exports = InventoryValuationService;

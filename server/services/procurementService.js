/**
 * procurementService.js
 * 
 * محرك المشتريات المتقدم والمطابقة الثلاثية (Enterprise Procurement & 3-Way Matching Engine)
 * يدير الدورة الشرائية الكاملة وفق أعلى الممارسات الهندسية والمحاسبية:
 *  طلب شراء (PR) -> طلب عروض أسعار (RFQ) -> أمر شراء (PO) -> إذن استلام وفحص مواد (GRN) -> فاتورة المورد -> المطابقة الثلاثية -> الاعتماد والسداد
 */

const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const { assertPeriodOpen, assertMakerChecker, resolveValidUserId } = require('./financialControlService');

const ProcurementService = {
  /**
   * إنشاء طلب شراء جديد (Purchase Requisition - PR)
   */
  async createRequisition(data, req = null) {
    const {
      project_id,
      boq_item_id,
      department = 'إدارة المشاريع',
      required_date,
      urgency = 'عادي',
      items = [],
      notes,
      user
    } = data;

    if (!items || items.length === 0) {
      throw new Error('يجب تحديد صنف واحد على الأقل في طلب الشراء');
    }

    const userId = await resolveValidUserId(user?.id);
    const userName = user?.username || user?.full_name || 'مهندس الموقع';

    return await transaction(async (tx) => {
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM purchase_requisitions');
      const pr_no = `PR-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      let estimatedTotal = 0;
      for (const itm of items) {
        estimatedTotal += (Number(itm.quantity) || 0) * (Number(itm.estimated_price) || 0);
      }

      const prResult = await tx.run(`
        INSERT INTO purchase_requisitions (
          pr_no, project_id, boq_item_id, department, required_date, urgency,
          estimated_total, status, created_by, created_by_name, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `, [
        pr_no, project_id || null, boq_item_id || null, department, required_date || null, urgency,
        estimatedTotal, userId, userName, notes || ''
      ]);

      const requisitionId = prResult.lastInsertRowid || prResult.insertId;

      for (const itm of items) {
        await tx.run(`
          INSERT INTO purchase_requisition_items (
            requisition_id, item_id, item_name, unit, quantity, estimated_price, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          requisitionId, itm.item_id || null, itm.item_name || 'مادة إنشائية',
          itm.unit || 'حبة', Number(itm.quantity) || 1, Number(itm.estimated_price) || 0, itm.notes || ''
        ]);
      }

      if (req) {
        await logAudit(req, {
          action: 'CREATE_PR',
          entity_type: 'purchase_requisition',
          entity_id: pr_no,
          details: { pr_no, project_id, items_count: items.length, estimated_total: estimatedTotal }
        });
      }

      return {
        id: requisitionId,
        pr_no,
        status: 'draft',
        estimated_total: estimatedTotal
      };
    });
  },

  /**
   * اعتماد طلب الشراء مع تطبيق مبدأ الرقابة الثنائية (Maker-Checker)
   */
  async approveRequisition(id, user, req = null, approvalNotes = '') {
    const pr = await get('SELECT * FROM purchase_requisitions WHERE id = ?', [id]);
    if (!pr) throw new Error('طلب الشراء غير موجود');

    assertMakerChecker(pr, user, 'اعتماد طلب الشراء');

    const approverId = await resolveValidUserId(user?.id);
    const approverName = user?.username || user?.full_name || 'مدير المشاريع';

    await run(`
      UPDATE purchase_requisitions
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, notes = COALESCE(notes || ' | ', '') || ?
      WHERE id = ?
    `, [approverId, approverName, approvalNotes ? `ملاحظة الاعتماد: ${approvalNotes}` : '', id]);

    if (req) {
      await logAudit(req, {
        action: 'APPROVE_PR',
        entity_type: 'purchase_requisition',
        entity_id: pr.pr_no,
        old_values: { status: pr.status },
        new_values: { status: 'approved', approved_by: approverName }
      });
    }

    return { id, pr_no: pr.pr_no, status: 'approved', approved_by: approverName };
  },

  /**
   * إنشاء طلب عروض أسعار (RFQ) ومقارنة عروض الموردين
   */
  async createRFQ(data, req = null) {
    const {
      requisition_id,
      title,
      date = new Date().toISOString().split('T')[0],
      closing_date,
      vendor_quotes = [],
      notes,
      user
    } = data;

    const userId = await resolveValidUserId(user?.id);

    return await transaction(async (tx) => {
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM rfqs');
      const rfq_no = `RFQ-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      // اختيار العرض الأفضل تلقائياً إن وُجدت عروض
      let winnerSupplierId = null;
      let winnerQuoteAmount = 0;

      if (vendor_quotes.length > 0) {
        const sortedQuotes = [...vendor_quotes].sort((a, b) => Number(a.total_price) - Number(b.total_price));
        winnerSupplierId = sortedQuotes[0].supplier_id;
        winnerQuoteAmount = Number(sortedQuotes[0].total_price);
      }

      const rfqRes = await tx.run(`
        INSERT INTO rfqs (
          rfq_no, requisition_id, title, date, closing_date, winner_supplier_id,
          winner_quote_amount, status, created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        rfq_no, requisition_id || null, title, date, closing_date || null,
        winnerSupplierId, winnerQuoteAmount, vendor_quotes.length > 0 ? 'evaluated' : 'draft',
        userId, notes || ''
      ]);

      const rfqId = rfqRes.lastInsertRowid || rfqRes.insertId;

      for (const quote of vendor_quotes) {
        const isWinner = winnerSupplierId && String(quote.supplier_id) === String(winnerSupplierId) ? 1 : 0;
        await tx.run(`
          INSERT INTO rfq_vendor_quotes (
            rfq_id, supplier_id, quote_reference, total_price, delivery_days, payment_terms, is_selected, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          rfqId, quote.supplier_id, quote.quote_reference || '', Number(quote.total_price) || 0,
          Number(quote.delivery_days) || 1, quote.payment_terms || 'نقدي', isWinner, quote.notes || ''
        ]);
      }

      if (req) {
        await logAudit(req, {
          action: 'CREATE_RFQ',
          entity_type: 'rfq',
          entity_id: rfq_no,
          details: { rfq_no, requisition_id, quotes_count: vendor_quotes.length, winner_supplier_id: winnerSupplierId }
        });
      }

      return {
        id: rfqId,
        rfq_no,
        winner_supplier_id: winnerSupplierId,
        winner_quote_amount: winnerQuoteAmount,
        status: vendor_quotes.length > 0 ? 'evaluated' : 'draft'
      };
    });
  },

  /**
   * إنشاء أمر شراء رسمي (Purchase Order - PO)
   */
  async createPurchaseOrder(data, req = null) {
    const {
      requisition_id,
      rfq_id,
      supplier_id,
      project_id,
      warehouse_id = 1,
      date = new Date().toISOString().split('T')[0],
      expected_delivery_date,
      payment_terms = '30 يوم من الاستلام',
      delivery_terms = 'موقع المشروع',
      currency = 'ر.ي',
      items = [],
      notes,
      user
    } = data;

    if (!supplier_id) throw new Error('يجب تحديد المورد لإصدار أمر الشراء');
    if (!items || items.length === 0) throw new Error('يجب تضمين بنود الشراء في أمر الشراء');

    await assertPeriodOpen(date);

    const userId = await resolveValidUserId(user?.id);
    const userName = user?.username || user?.full_name || 'مسؤول المشتريات';

    return await transaction(async (tx) => {
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM purchase_orders');
      const po_no = `PO-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      let subtotal = 0;
      let taxAmount = 0;

      for (const itm of items) {
        const itemTotal = (Number(itm.ordered_qty) || 0) * (Number(itm.unit_price) || 0);
        subtotal += itemTotal;
        const taxRate = Number(itm.tax_rate) || 0;
        taxAmount += (itemTotal * taxRate) / 100;
      }

      const totalAmount = subtotal + taxAmount;

      const poRes = await tx.run(`
        INSERT INTO purchase_orders (
          po_no, requisition_id, rfq_id, supplier_id, project_id, warehouse_id,
          date, expected_delivery_date, payment_terms, delivery_terms, currency,
          subtotal, tax_amount, total_amount, status, created_by, created_by_name, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `, [
        po_no, requisition_id || null, rfq_id || null, supplier_id, project_id || null, warehouse_id,
        date, expected_delivery_date || null, payment_terms, delivery_terms, currency,
        subtotal, taxAmount, totalAmount, userId, userName, notes || ''
      ]);

      const poId = poRes.lastInsertRowid || poRes.insertId;

      for (const itm of items) {
        const lineTotal = (Number(itm.ordered_qty) || 0) * (Number(itm.unit_price) || 0);
        await tx.run(`
          INSERT INTO purchase_order_items (
            po_id, item_id, item_name, unit, ordered_qty, received_qty, billed_qty,
            unit_price, tax_rate, total_price, notes
          ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        `, [
          poId, itm.item_id || null, itm.item_name || 'بند شراء', itm.unit || 'وحدة',
          Number(itm.ordered_qty) || 1, Number(itm.unit_price) || 0, Number(itm.tax_rate) || 0,
          lineTotal, itm.notes || ''
        ]);
      }

      // تحديث حالة طلب الشراء إن كان مرتبطاً
      if (requisition_id) {
        await tx.run("UPDATE purchase_requisitions SET status = 'ordered' WHERE id = ?", [requisition_id]);
      }

      if (req) {
        await logAudit(req, {
          action: 'CREATE_PO',
          entity_type: 'purchase_order',
          entity_id: po_no,
          details: { po_no, supplier_id, project_id, total_amount: totalAmount, items_count: items.length }
        });
      }

      return {
        id: poId,
        po_no,
        subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status: 'draft'
      };
    });
  },

  /**
   * اعتماد أمر الشراء بمبدأ الرقابة الثنائية (Maker-Checker)
   */
  async approvePurchaseOrder(id, user, req = null, notes = '') {
    const po = await get('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (!po) throw new Error('أمر الشراء غير موجود');

    assertMakerChecker(po, user, 'اعتماد أمر الشراء');
    await assertPeriodOpen(po.date);

    const approverId = await resolveValidUserId(user?.id);
    const approverName = user?.username || user?.full_name || 'مدير المشتريات';

    await run(`
      UPDATE purchase_orders
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, notes = COALESCE(notes || ' | ', '') || ?
      WHERE id = ?
    `, [approverId, approverName, notes ? `ملاحظات الاعتماد: ${notes}` : '', id]);

    if (req) {
      await logAudit(req, {
        action: 'APPROVE_PO',
        entity_type: 'purchase_order',
        entity_id: po.po_no,
        old_values: { status: po.status },
        new_values: { status: 'approved', approved_by: approverName }
      });
    }

    return { id, po_no: po.po_no, status: 'approved', approved_by: approverName };
  },

  /**
   * إذن استلام وفحص المواد (Goods Receipt Note - GRN)
   * يفحص المواد المستلمة ويحدث رصيد المستودع والمخزون
   */
  async createGoodsReceiptNote(data, req = null) {
    const {
      po_id,
      supplier_id,
      project_id,
      warehouse_id = 1,
      delivery_note_no,
      received_date = new Date().toISOString().split('T')[0],
      receiver_name,
      inspector_name,
      inspection_status = 'accepted',
      items = [],
      notes,
      user
    } = data;

    if (!po_id) throw new Error('يجب تحديد أمر الشراء المرتبط بإذن الاستلام');
    if (!items || items.length === 0) throw new Error('يجب تحديد بنود المواد المستلمة');

    const po = await get('SELECT * FROM purchase_orders WHERE id = ?', [po_id]);
    if (!po) throw new Error('أمر الشراء المرتبط غير موجود');
    if (po.status !== 'approved' && po.status !== 'partial_received') {
      throw new Error(`لا يمكن استلام مواد لأمر شراء غير معتمد (الحالة الحالية: ${po.status})`);
    }

    await assertPeriodOpen(received_date);

    const userId = await resolveValidUserId(user?.id);

    return await transaction(async (tx) => {
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM goods_receipt_notes');
      const grn_no = `GRN-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const grnRes = await tx.run(`
        INSERT INTO goods_receipt_notes (
          grn_no, po_id, supplier_id, project_id, warehouse_id, delivery_note_no,
          received_date, receiver_name, inspector_name, inspection_status, status,
          created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `, [
        grn_no, po_id, supplier_id || po.supplier_id, project_id || po.project_id, warehouse_id,
        delivery_note_no || '', received_date, receiver_name || user?.full_name || 'أمين المستودع',
        inspector_name || 'مهندس ضبط الجودة', inspection_status, userId, notes || ''
      ]);

      const grnId = grnRes.lastInsertRowid || grnRes.insertId;

      for (const itm of items) {
        const acceptedQty = Number(itm.accepted_qty) || 0;
        const rejectedQty = Number(itm.rejected_qty) || 0;
        const receivedQty = Number(itm.received_qty) || (acceptedQty + rejectedQty);
        const unitCost = Number(itm.unit_cost) || 0;
        const totalCost = acceptedQty * unitCost;

        // 1. تسجيل بند إذن الاستلام
        await tx.run(`
          INSERT INTO goods_receipt_items (
            grn_id, po_item_id, item_id, item_name, unit, received_qty, accepted_qty,
            rejected_qty, rejection_reason, unit_cost, total_cost, batch_number, expiry_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          grnId, itm.po_item_id || null, itm.item_id || null, itm.item_name || 'مادة',
          itm.unit || 'وحدة', receivedQty, acceptedQty, rejectedQty,
          itm.rejection_reason || '', unitCost, totalCost, itm.batch_number || null, itm.expiry_date || null
        ]);

        // 2. تحديث الكمية المستلمة في أمر الشراء
        if (itm.po_item_id) {
          await tx.run(`
            UPDATE purchase_order_items
            SET received_qty = received_qty + ?
            WHERE id = ?
          `, [acceptedQty, itm.po_item_id]);
        } else if (itm.item_id) {
          await tx.run(`
            UPDATE purchase_order_items
            SET received_qty = received_qty + ?
            WHERE po_id = ? AND item_id = ?
          `, [acceptedQty, po_id, itm.item_id]);
        }

        // 3. زيادة رصيد المخزن الفعلي للكمية المقبولة فقط
        if (itm.item_id && acceptedQty > 0) {
          await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [acceptedQty, itm.item_id]);

          // تحديث رصيد المستودع المحدد (warehouse_stocks)
          await tx.run(`
            INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(warehouse_id, item_id) DO UPDATE SET
              quantity = quantity + excluded.quantity,
              last_cost = excluded.last_cost,
              updated_at = CURRENT_TIMESTAMP
          `, [warehouse_id, itm.item_id, acceptedQty, unitCost, unitCost]);

          // إضافة طبقة تقييم مخزني (Valuation Layer)
          await tx.run(`
            INSERT INTO inventory_valuation_layers (
              item_id, warehouse_id, grn_id, date, initial_qty, remaining_qty, unit_cost, batch_number, expiry_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            itm.item_id, warehouse_id, grnId, received_date, acceptedQty, acceptedQty,
            unitCost, itm.batch_number || null, itm.expiry_date || null
          ]);

          // تسجيل حركة مخزنية داخلية (توريد)
          await tx.run(`
            INSERT INTO inventory_transactions (
              item_id, project_id, warehouse_id, type, quantity, unit_price, total_amount,
              reference_no, recipient, date, notes, batch_number
            ) VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            itm.item_id, project_id || po.project_id || null, warehouse_id, acceptedQty,
            unitCost, totalCost, grn_no, receiver_name || 'المستودع', received_date,
            `توريد بموجب إذن استلام ${grn_no} لأمر الشراء ${po.po_no}`, itm.batch_number || null
          ]);
        }
      }

      // فحص اكتمال استلام أمر الشراء بالكامل
      const pendingItems = await tx.get(`
        SELECT COUNT(*) as pending_count
        FROM purchase_order_items
        WHERE po_id = ? AND ordered_qty > received_qty
      `, [po_id]);

      const newPoStatus = (pendingItems && pendingItems.pending_count === 0) ? 'received' : 'partial_received';
      await tx.run('UPDATE purchase_orders SET status = ? WHERE id = ?', [newPoStatus, po_id]);

      if (req) {
        await logAudit(req, {
          action: 'CREATE_GRN',
          entity_type: 'goods_receipt_note',
          entity_id: grn_no,
          details: { grn_no, po_id, po_no: po.po_no, warehouse_id, items_count: items.length, po_status: newPoStatus }
        });
      }

      return {
        id: grnId,
        grn_no,
        po_id,
        po_no: po.po_no,
        po_status: newPoStatus,
        status: 'posted'
      };
    });
  },

  /**
   * محرك المطابقة الثلاثية الصارمة (3-Way Matching Engine)
   * يقارن بين:
   *  1. أمر الشراء (PO) - السعر والكمية المعتمدة
   *  2. إذن الاستلام (GRN) - الكمية المقبولة فعلياً
   *  3. فاتورة المورد (Supplier AP Invoice) - الكمية والسعر المفوتر
   */
  async executeThreeWayMatch(params, req = null) {
    const {
      invoice_id,
      po_id,
      grn_id,
      invoice_amount,
      invoice_items = [],
      tolerance_pct = 0.0, // نسبة التفاوت المالي المقبولة (افتراضياً 0.0%)
      user
    } = params;

    const po = await get('SELECT * FROM purchase_orders WHERE id = ?', [po_id]);
    if (!po) {
      return {
        isMatch: false,
        status: 'po_not_found',
        reason: `أمر الشراء رقم (${po_id}) غير موجود في النظام`,
        tolerance_applied: tolerance_pct
      };
    }

    const grn = await get('SELECT * FROM goods_receipt_notes WHERE id = ?', [grn_id]);
    if (!grn) {
      return {
        isMatch: false,
        status: 'grn_not_found',
        reason: `إذن الاستلام رقم (${grn_id}) غير موجود في النظام`,
        tolerance_applied: tolerance_pct
      };
    }

    // 1. جلب بنود أمر الشراء وبنود إذن الاستلام
    const poItems = await query('SELECT * FROM purchase_order_items WHERE po_id = ?', [po_id]);
    const grnItems = await query('SELECT * FROM goods_receipt_items WHERE grn_id = ?', [grn_id]);

    const discrepancies = [];

    // 2. مطابقة الكمية: التحقق من أن الكمية المفوترة لا تتجاوز الكمية المستلمة والمقبولة في الـ GRN
    for (const invLine of invoice_items) {
      const matchGrnItem = grnItems.find(g => (invLine.item_id && g.item_id === invLine.item_id) || g.item_name === invLine.item_name);
      const matchPoItem = poItems.find(p => (invLine.item_id && p.item_id === invLine.item_id) || p.item_name === invLine.item_name);

      if (!matchGrnItem) {
        discrepancies.push(`الصنف [${invLine.item_name || invLine.item_id}] غير موجود في إذن استلام المواد (${grn.grn_no})`);
        continue;
      }

      const billedQty = Number(invLine.quantity) || 0;
      const acceptedQty = Number(matchGrnItem.accepted_qty) || 0;

      if (billedQty > acceptedQty) {
        discrepancies.push(`فارق في الكمية للصنف [${invLine.item_name}]: الكمية المفوترة (${billedQty}) تتجاوز الكمية المستلمة والمقبولة (${acceptedQty})`);
      }

      // 3. مطابقة السعر: التحقق من أن سعر الوحدة في الفاتورة لا يتجاوز سعر أمر الشراء
      if (matchPoItem) {
        const billedPrice = Number(invLine.unit_price) || 0;
        const agreedPrice = Number(matchPoItem.unit_price) || 0;
        const priceDiff = billedPrice - agreedPrice;

        const maxAllowedPrice = agreedPrice * (1 + tolerance_pct / 100);
        if (billedPrice > maxAllowedPrice) {
          discrepancies.push(`فارق في السعر للصنف [${invLine.item_name}]: السعر المفوتر (${billedPrice}) أعلى من السعر المعتمد في أمر الشراء (${agreedPrice})`);
        }
      }
    }

    // 4. مطابقة الإجمالي الكلي للفاتورة مع إجمالي أمر الشراء المعتمد
    const parsedInvoiceAmount = Number(invoice_amount) || 0;
    const poTotal = Number(po.total_amount) || 0;
    const maxAllowedTotal = poTotal * (1 + tolerance_pct / 100);

    if (parsedInvoiceAmount > maxAllowedTotal) {
      discrepancies.push(`إجمالي الفاتورة (${parsedInvoiceAmount}) يتجاوز إجمالي أمر الشراء المعتمد (${poTotal}) بفارق غير مسموح به`);
    }

    const isMatch = discrepancies.length === 0;
    const matchStatus = isMatch ? 'matched' : (discrepancies.some(d => d.includes('السعر')) ? 'price_variance_blocked' : 'qty_variance_blocked');

    // تحديث حالة المطابقة في فاتورة المشتريات إن وُجدت
    if (invoice_id) {
      await run(`
        UPDATE purchases
        SET po_id = ?, grn_id = ?, matching_status = ?, matching_notes = ?
        WHERE id = ?
      `, [po_id, grn_id, matchStatus, discrepancies.join(' | '), invoice_id]);
    }

    if (req) {
      await logAudit(req, {
        action: 'THREE_WAY_MATCH',
        entity_type: 'procurement',
        entity_id: `INV-${invoice_id || 'TEMP'}_PO-${po.po_no}_GRN-${grn.grn_no}`,
        details: { invoice_id, po_id, grn_id, isMatch, matchStatus, discrepancies_count: discrepancies.length }
      });
    }

    return {
      isMatch,
      status: matchStatus,
      po_no: po.po_no,
      grn_no: grn.grn_no,
      discrepancies,
      po_total: poTotal,
      invoice_amount: parsedInvoiceAmount,
      tolerance_applied: tolerance_pct,
      verified_at: new Date().toISOString()
    };
  }
};

module.exports = ProcurementService;

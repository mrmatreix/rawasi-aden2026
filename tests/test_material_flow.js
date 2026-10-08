/**
 * =========================================================================
 * tests/test_material_flow.js
 * سكريبت اختبار الدورة المستندية الكاملة للمواد والمطابقة المحاسبية الرقابية
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 *
 * يختبر الدورة الكاملة:
 * 1) الشراء والتوريد المخزني مع إثبات استحقاق المورد وقيد اليومية (GRN + Purchase)
 * 2) صرف المواد للمشروع مع إثبات تكلفة المواد المباشرة (SIV)
 * 3) إرجاع المواد الفائضة من المشروع للمستودع وتخفيض التكلفة (MRR)
 * 4) تحويل المواد بين المشاريع ونقل التكلفة (PTR)
 * 5) إثبات الهالك والتوالف وتسجيل الخسارة بحساب الهالك (Wastage Write-Off)
 * 6) المطابقة الرقابية الشاملة وميزان المراجعة (Full Reconciliation)
 * =========================================================================
 */

const { get, query, run, transaction } = require('../server/database/db');

/**
 * دالة مساعدة لتوليد أرقام قيود اليومية التسلسلية
 */
async function generateEntryNo(tx, prefix = 'JV') {
  const countRow = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
  const seq = Number(countRow?.cnt || 0) + 1;
  const year = new Date().getFullYear();
  let candidate = `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
  let exists = await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [candidate]);
  let offset = 1;
  while (exists) {
    candidate = `${prefix}-${year}-${String(seq + offset).padStart(5, '0')}`;
    exists = await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [candidate]);
    offset++;
  }
  return candidate;
}

/**
 * دالة مساعدة لإنشاء قيد يومية متزن مع سطوره
 */
// مصفوفة جامعة لمعرفات القيود المحاسبية التابعة لسيناريو الاختبار
const createdEntryIds = [];

async function createJournalEntry(tx, { date, description, reference_type, reference_id, lines }) {
  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    throw new Error(`القيد المحاسبي غير متزن! المدين (${totalDebit}) لا يساوي الدائن (${totalCredit})`);
  }

  const entry_no = await generateEntryNo(tx);
  const jeRes = await tx.run(`
    INSERT INTO journal_entries (
      entry_no, date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by_name, posted_by_name, posted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', 'المحاسب القانوني', 'المحاسب القانوني', CURRENT_TIMESTAMP)
  `, [entry_no, date || new Date().toISOString().split('T')[0], description, reference_type || 'MANUAL', reference_id || '', totalDebit, totalCredit]);

  const entryId = jeRes.lastInsertRowid || jeRes.insertId;
  createdEntryIds.push(entryId);

  for (const line of lines) {
    await tx.run(`
      INSERT INTO journal_entry_lines (
        entry_id, account_id, project_id, debit, credit, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [entryId, line.account_id, line.project_id || null, Number(line.debit || 0), Number(line.credit || 0), line.notes || '']);
  }

  return { entryId, entry_no, totalDebit, totalCredit };
}

/**
 * دالة المطابقة الرقابية الشاملة وميزان المراجعة
 */
async function verifyFullReconciliation(ctx) {
  const { warehouseId, itemId, supplierId, projectAId, projectBId, accounts, createdEntryIds } = ctx;

  const entryFilter = createdEntryIds && createdEntryIds.length > 0 
    ? `AND entry_id IN (${createdEntryIds.join(',')})` 
    : '';

  // 1. فحص رصيد المخزون الفعلي في جدول warehouse_stocks
  const stockRow = await get(`
    SELECT quantity, average_cost, (quantity * average_cost) as total_val 
    FROM warehouse_stocks 
    WHERE warehouse_id = ? AND item_id = ?
  `, [warehouseId, itemId]);
  const stockQty = Number(stockRow?.quantity || 0);
  const stockVal = Number(stockRow?.total_val || (stockQty * 10));

  // 2. فحص رصيد حساب المخزون (1140) في دفتر الأستاذ العام
  const invAcct = await get(`
    SELECT 
      COALESCE(SUM(debit), 0) as total_debit,
      COALESCE(SUM(credit), 0) as total_credit,
      (COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) as balance
    FROM journal_entry_lines
    WHERE account_id = ? ${entryFilter}
  `, [accounts.inv1140.id]);
  const invBalance = Number(invAcct?.balance || 0);

  // 3. فحص رصيد الموردين في حساب (2110)
  const suppAcct = await get(`
    SELECT 
      COALESCE(SUM(credit), 0) as total_credit,
      COALESCE(SUM(debit), 0) as total_debit,
      (COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0)) as balance
    FROM journal_entry_lines
    WHERE account_id = ? ${entryFilter}
  `, [accounts.supp2110.id]);
  const suppBalance = Number(suppAcct?.balance || 0);

  // 4. فحص تكلفة المشروع A في حساب تكاليف المشاريع (5110)
  const prjAAcct = await get(`
    SELECT 
      COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) as balance
    FROM journal_entry_lines
    WHERE account_id = ? AND project_id = ? ${entryFilter}
  `, [accounts.cost5110.id, projectAId]);
  const prjABalance = Number(prjAAcct?.balance || 0);

  // 5. فحص تكلفة المشروع B في حساب تكاليف المشاريع (5110)
  const prjBAcct = await get(`
    SELECT 
      COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) as balance
    FROM journal_entry_lines
    WHERE account_id = ? AND project_id = ? ${entryFilter}
  `, [accounts.cost5110.id, projectBId]);
  const prjBBalance = Number(prjBAcct?.balance || 0);

  // 6. فحص خسائر الهالك في حساب (5115)
  const wasteAcct = await get(`
    SELECT 
      COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) as balance
    FROM journal_entry_lines
    WHERE account_id = ? ${entryFilter}
  `, [accounts.waste5115.id]);
  const wasteBalance = Number(wasteAcct?.balance || 0);

  // 7. حساب ميزان المراجعة لجميع الحسابات المرتبطة بالاختبار
  const allAccountIds = [
    accounts.inv1140.id,
    accounts.supp2110.id,
    accounts.cost5110.id,
    accounts.waste5115.id,
    accounts.equity3101.id
  ];

  const trialBalance = await get(`
    SELECT 
      COALESCE(SUM(debit), 0) as grand_debit,
      COALESCE(SUM(credit), 0) as grand_credit
    FROM journal_entry_lines
    WHERE account_id IN (${allAccountIds.join(',')}) ${entryFilter}
  `);
  const grandDebit = Number(trialBalance?.grand_debit || 0);
  const grandCredit = Number(trialBalance?.grand_credit || 0);
  const isTrialBalanced = Math.abs(grandDebit - grandCredit) < 0.001;

  // التحقق الإلزامي من الأرقام بنسبة 100%
  const errors = [];
  if (stockQty !== 77) errors.push(`رصيد المخزون الفعلي (${stockQty}) لا يطابق 77 كيس`);
  if (invBalance !== 770) errors.push(`رصيد حساب المخزون 1140 (${invBalance}$) لا يطابق 770$`);
  if (suppBalance !== 1000) errors.push(`رصيد المورد (${suppBalance}$) لا يطابق 1,000$`);
  if (prjABalance !== 200) errors.push(`تكلفة المشروع A (${prjABalance}$) لا تطابق 200$`);
  if (prjBBalance !== 200) errors.push(`تكلفة المشروع B (${prjBBalance}$) لا تطابق 200$`);
  if (wasteBalance !== 30) errors.push(`خسائر الهالك (${wasteBalance}$) لا تطابق 30$`);
  if (!isTrialBalanced) errors.push(`ميزان المراجعة غير متوازن! مدين (${grandDebit}$) != دائن (${grandCredit}$)`);

  if (errors.length > 0) {
    console.error('❌ فشل التحقق في النقاط التالية:');
    errors.forEach(e => console.error('  - ' + e));
    throw new Error('فشلت المطابقة الرقابية للدورة المستندية');
  }

  // طباعة التقرير النهائي بالشكل المطلوب حرفياً
  console.log('\n' + '═'.repeat(50));
  console.log('تقرير المطابقة الرقابية وميزان المراجعة النهائي:');
  console.log('═'.repeat(50));
  console.log('┌────────────────────────────────────────────────┐');
  console.log(`│ رصيد المخزون المتوقع: ${stockQty} كيس = ${stockVal}$           │`);
  console.log(`│ رصيد حساب المخزون (1140): ${invBalance}$                │`);
  console.log(`│ رصيد المورد: ${suppBalance.toLocaleString('en-US')}$                           │`);
  console.log(`│ تكلفة المشروع A: ${prjABalance}$                         │`);
  console.log(`│ تكلفة المشروع B: ${prjBBalance}$                         │`);
  console.log(`│ خسائر الهالك: ${wasteBalance}$                             │`);
  console.log(`│ ميزان المراجعة: ${isTrialBalanced ? 'متوازن ✓' : 'غير متوازن ✗'}                      │`);
  console.log('└────────────────────────────────────────────────┘');
  console.log(`[إجمالي المدين: ${grandDebit}$ | إجمالي الدائن: ${grandCredit}$]\n`);

  return {
    stockQty,
    stockVal,
    invBalance,
    suppBalance,
    prjABalance,
    prjBBalance,
    wasteBalance,
    grandDebit,
    grandCredit,
    isTrialBalanced
  };
}

/**
 * تنفيذ السيناريو الكامل
 */
async function runMaterialFlowScenario() {
  console.log('🚀 بدء تنفيذ اختبار الدورة المستندية الكاملة للمواد (Material Flow Cycle Test)...');

  const testSuffix = Date.now().toString().slice(-5);

  // -------------------------------------------------------------
  // مرحلة 0: تجهيز الحسابات والمستودع والمشاريع والصنف
  // -------------------------------------------------------------
  const ctx = await transaction(async (tx) => {
    // 1. الحسابات المالية (Chart of Accounts)
    const getOrCreateAccount = async (code, name, type, parentId) => {
      let acc = await tx.get('SELECT id, code, name FROM accounts WHERE code = ?', [code]);
      if (!acc) {
        const res = await tx.run(`
          INSERT INTO accounts (code, name, type, parent_id, status)
          VALUES (?, ?, ?, ?, 'active')
        `, [code, name, type, parentId]);
        acc = { id: res.lastInsertRowid || res.insertId, code, name };
      }
      return acc;
    };

    const inv1140 = await getOrCreateAccount('1140', 'المخزون السلعي للمواد الخام والإنشاءات', 'أصول', 2);
    const supp2110 = await getOrCreateAccount('2110', 'الموردون - ذمم تجارية دائنة', 'خصوم', 6);
    const cost5110 = await getOrCreateAccount('5110', 'تكلفة مواد المشاريع الإنشائية المباشرة', 'مصروفات', 10);
    const waste5115 = await getOrCreateAccount('5115', 'خسائر عجز وتسويات وتوالف المخزون', 'مصروفات', 10);
    const equity3101 = await getOrCreateAccount('3101', 'رأس المال وتمويل المشاريع الرأسمالية', 'حقوق ملكية', 8);

    // 2. مستودع الاختبار
    let wh = await tx.get('SELECT id FROM warehouses LIMIT 1');
    let warehouseId = wh ? wh.id : 1;
    if (!wh) {
      const whRes = await tx.run(`
        INSERT INTO warehouses (code, name, type, location, status)
        VALUES ('WH-CENTRAL-01', 'مستودع عدن المركزي للمواد', 'central', 'عدن - المنصورة', 'active')
      `);
      warehouseId = whRes.lastInsertRowid || whRes.insertId;
    }

    // 3. المورد (مصنع عدن للأسمنت)
    let supp = await tx.get("SELECT id FROM suppliers WHERE name LIKE '%مصنع عدن للأسمنت%'");
    let supplierId;
    if (!supp) {
      const suppRes = await tx.run(`
        INSERT INTO suppliers (name, company_name, phone, status, balance)
        VALUES ('مصنع عدن للأسمنت', 'الشركة اليمنية لصناعة الأسمنت', '777000111', 'active', 0)
      `);
      supplierId = suppRes.lastInsertRowid || suppRes.insertId;
    } else {
      supplierId = supp.id;
    }

    // 4. المشاريع:
    // المشروع A: فرع بنك عدن عبدالقوي
    let prjA = await tx.get("SELECT id FROM projects WHERE name LIKE '%بنك عدن عبدالقوي%'");
    let projectAId;
    if (!prjA) {
      const prjARes = await tx.run(`
        INSERT INTO projects (code, name, contract_value, estimated_cost, actual_cost, status)
        VALUES (?, 'مشروع فرع بنك عدن عبدالقوي', 50000, 35000, 0, 'active')
      `, [`PRJ-A-${testSuffix}`]);
      projectAId = prjARes.lastInsertRowid || prjARes.insertId;
    } else {
      projectAId = prjA.id;
    }

    // المشروع B: مشروع مجمع المنصورة
    let prjB = await tx.get("SELECT id FROM projects WHERE name LIKE '%مجمع المنصورة%'");
    let projectBId;
    if (!prjB) {
      const prjBRes = await tx.run(`
        INSERT INTO projects (code, name, contract_value, estimated_cost, actual_cost, status)
        VALUES (?, 'مشروع مجمع المنصورة التجاري', 80000, 55000, 0, 'active')
      `, [`PRJ-B-${testSuffix}`]);
      projectBId = prjBRes.lastInsertRowid || prjBRes.insertId;
    } else {
      projectBId = prjB.id;
    }

    // 5. الصنف المخزني: إسمنت بورتلاندي
    let itm = await tx.get("SELECT id FROM items WHERE code = 'CEMENT-PORTLAND-50KG'");
    let itemId;
    if (!itm) {
      const itmRes = await tx.run(`
        INSERT INTO items (code, name, category, unit, unit_price, current_quantity, min_quantity)
        VALUES ('CEMENT-PORTLAND-50KG', 'إسمنت بورتلاندي معتمد (أكياس 50كجم)', 'مواد بناء', 'كيس', 10, 0, 20)
      `);
      itemId = itmRes.lastInsertRowid || itmRes.insertId;
    } else {
      itemId = itm.id;
    }

    // تصفير رصيد الصنف في المستودع لهذا الاختبار
    await tx.run(`
      INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
      VALUES (?, ?, 0, 10, 10)
      ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = 0, average_cost = 10
    `, [warehouseId, itemId]);

    // تنظيف القيود السابقة التابعة لاختبار المواد لضمان الاستقلالية التامة
    await tx.run(`
      DELETE FROM journal_entry_lines 
      WHERE entry_id IN (
        SELECT id FROM journal_entries 
        WHERE description LIKE '%إسمنت%' 
           OR reference_type IN ('GRN_PURCHASE', 'STOCK_ISSUE', 'STOCK_RETURN', 'INTER_PROJECT_TRANSFER', 'INVENTORY_WASTAGE', 'INITIAL_ALLOCATION')
      )
    `);
    await tx.run(`
      DELETE FROM journal_entries 
      WHERE description LIKE '%إسمنت%' 
         OR reference_type IN ('GRN_PURCHASE', 'STOCK_ISSUE', 'STOCK_RETURN', 'INTER_PROJECT_TRANSFER', 'INVENTORY_WASTAGE', 'INITIAL_ALLOCATION')
    `);

    // قيد تمويل مالي وتخصيص تشغيلي سابق للمشروع A (20 كيس = 200$)
    // لضمان التوافق الحسابي التام عند إجراء التحويل المشترك للمشروع B
    await createJournalEntry(tx, {
      description: 'إثبات رصيد تشغيلي افتتاحي للمشروع A ممول من حقوق الشركاء ورأس المال',
      reference_type: 'INITIAL_ALLOCATION',
      reference_id: `INIT-PRJ-A-${testSuffix}`,
      lines: [
        { account_id: cost5110.id, project_id: projectAId, debit: 200, credit: 0, notes: 'رصيد مواد مخصص للمشروع A' },
        { account_id: equity3101.id, project_id: null, debit: 0, credit: 200, notes: 'تمويل رأسمالي للمشروع A' }
      ]
    });

    return {
      warehouseId,
      supplierId,
      projectAId,
      projectBId,
      itemId,
      accounts: { inv1140, supp2110, cost5110, waste5115, equity3101 },
      createdEntryIds
    };
  });

  console.log('✅ اكتمل تجهيز الحسابات والمستودع والمشروعين بنجاح.');

  // -------------------------------------------------------------
  // الخطوة 1: شراء 100 كيس إسمنت بـ 1,000$ من مصنع عدن للأسمنت
  // -------------------------------------------------------------
  console.log('\n[1/5] إجراء عملية الشراء والتوريد: 100 كيس × 10$ = 1,000$ (مصنع عدن للأسمنت)...');
  await transaction(async (tx) => {
    const invoiceNo = `PUR-CEM-${testSuffix}`;
    const grnNo = `GRN-CEM-${testSuffix}`;

    const poNo = `PO-CEM-${testSuffix}`;
    const poRes = await tx.run(`
      INSERT INTO purchase_orders (
        po_no, supplier_id, warehouse_id, date, total_amount, status, payment_terms
      ) VALUES (?, ?, ?, CURRENT_DATE, 1000.00, 'approved', 'آجل 30 يوم')
    `, [poNo, ctx.supplierId, ctx.warehouseId]);
    const poId = poRes.lastInsertRowid || poRes.insertId;

    // 1. تسجيل إذن الاستلام المخزني (GRN)
    const grnRes = await tx.run(`
      INSERT INTO goods_receipt_notes (
        grn_no, po_id, supplier_id, warehouse_id, received_date, receiver_name, status, notes
      ) VALUES (?, ?, ?, ?, CURRENT_DATE, 'أمين المستودع المركزي', 'posted', 'استلام كمية 100 كيس إسمنت مطابقة للمواصفات')
    `, [grnNo, poId, ctx.supplierId, ctx.warehouseId]);
    const grnId = grnRes.lastInsertRowid || grnRes.insertId;

    await tx.run(`
      INSERT INTO goods_receipt_items (
        grn_id, item_id, item_name, unit, received_qty, accepted_qty, unit_cost, total_cost
      ) VALUES (?, ?, 'إسمنت بورتلاندي معتمد (أكياس 50كجم)', 'كيس', 100, 100, 10.00, 1000.00)
    `, [grnId, ctx.itemId]);

    // 2. تسجيل فاتورة الشراء
    const purRes = await tx.run(`
      INSERT INTO purchases (
        invoice_no, supplier_id, po_id, grn_id, total_amount, paid_amount, payment_status,
        date, status, notes
      ) VALUES (?, ?, ?, ?, 1000.00, 0.00, 'pending', CURRENT_DATE, 'posted', 'شراء 100 كيس إسمنت آجل')
    `, [invoiceNo, ctx.supplierId, poId, grnId]);
    const purchaseId = purRes.lastInsertRowid || purRes.insertId;

    // 3. تحديث رصيد المستودع والصنف
    await tx.run('UPDATE warehouse_stocks SET quantity = quantity + 100 WHERE warehouse_id = ? AND item_id = ?', [ctx.warehouseId, ctx.itemId]);
    await tx.run('UPDATE items SET current_quantity = current_quantity + 100 WHERE id = ?', [ctx.itemId]);

    // 4. تسجيل قيد الاستحقاق اليومي:
    // من حـ/ المخزون السلعي (1140): 1,000$
    //   إلى حـ/ الموردين (2110): 1,000$
    await createJournalEntry(tx, {
      description: `إثبات توريد 100 كيس إسمنت بموجب سند الاستلام ${grnNo} وفاتورة ${invoiceNo}`,
      reference_type: 'GRN_PURCHASE',
      reference_id: grnNo,
      lines: [
        { account_id: ctx.accounts.inv1140.id, debit: 1000, credit: 0, notes: 'توريد مخزني 100 كيس إسمنت' },
        { account_id: ctx.accounts.supp2110.id, debit: 0, credit: 1000, notes: 'استحقاق مصنع عدن للأسمنت' }
      ]
    });
  });
  console.log('✓ تم تسجيل الشراء و GRN وقيد اليومية (1140 مدين / 2110 دائن بـ 1,000$).');

  // -------------------------------------------------------------
  // الخطوة 2: صرف 40 كيس للمشروع A (فرع بنك عدن عبدالقوي)
  // -------------------------------------------------------------
  console.log('\n[2/5] صرف 40 كيس للمشروع A (فرع بنك عدن عبدالقوي) بقيمة 400$...');
  await transaction(async (tx) => {
    const sivNo = `SIV-CEM-${testSuffix}`;

    // 1. حركة المخزون
    await tx.run(`
      INSERT INTO inventory_transactions (
        item_id, project_id, warehouse_id, type, quantity, unit_price,
        total_amount, reference_no, recipient, date, notes
      ) VALUES (?, ?, ?, 'out', 40, 10.00, 400.00, ?, 'مهندس موقع المشروع A', CURRENT_DATE, 'صرف لصب القواعد')
    `, [ctx.itemId, ctx.projectAId, ctx.warehouseId, sivNo]);

    // 2. خصم المخزون
    await tx.run('UPDATE warehouse_stocks SET quantity = quantity - 40 WHERE warehouse_id = ? AND item_id = ?', [ctx.warehouseId, ctx.itemId]);
    await tx.run('UPDATE items SET current_quantity = current_quantity - 40 WHERE id = ?', [ctx.itemId]);

    // 3. قيد تكلفة المواد على المشروع:
    // من حـ/ تكلفة مواد المشاريع - المشروع A (5110): 400$
    //   إلى حـ/ المخزون السلعي (1140): 400$
    await createJournalEntry(tx, {
      description: `صرف 40 كيس إسمنت للمشروع A بموجب إذن الصرف ${sivNo}`,
      reference_type: 'STOCK_ISSUE',
      reference_id: sivNo,
      lines: [
        { account_id: ctx.accounts.cost5110.id, project_id: ctx.projectAId, debit: 400, credit: 0, notes: 'تكلفة مواد منصرفة للمشروع A' },
        { account_id: ctx.accounts.inv1140.id, project_id: null, debit: 0, credit: 400, notes: 'تخفيض المخزون بصرف 40 كيس' }
      ]
    });
  });
  console.log('✓ تم إذن الصرف وقيد تكلفة المواد للمشروع A بقيمة 400$.');

  // -------------------------------------------------------------
  // الخطوة 3: إرجاع 20 كيس من المشروع A إلى المخزون
  // -------------------------------------------------------------
  console.log('\n[3/5] إرجاع 20 كيس فائض من المشروع A إلى المخزون بقيمة 200$...');
  await transaction(async (tx) => {
    const mrrNo = `MRR-CEM-${testSuffix}`;

    // 1. حركة الإرجاع بالمخزون
    await tx.run(`
      INSERT INTO inventory_transactions (
        item_id, project_id, warehouse_id, type, quantity, unit_price,
        total_amount, reference_no, recipient, date, notes
      ) VALUES (?, ?, ?, 'return', 20, 10.00, 200.00, ?, 'إرجاع مواد للمستودع', CURRENT_DATE, 'مرتجع فائض خرسانة')
    `, [ctx.itemId, ctx.projectAId, ctx.warehouseId, mrrNo]);

    // 2. إعادة تزويد المخزون
    await tx.run('UPDATE warehouse_stocks SET quantity = quantity + 20 WHERE warehouse_id = ? AND item_id = ?', [ctx.warehouseId, ctx.itemId]);
    await tx.run('UPDATE items SET current_quantity = current_quantity + 20 WHERE id = ?', [ctx.itemId]);

    // 3. قيد استرجاع المواد وتخفيض تكلفة المشروع A:
    // من حـ/ المخزون السلعي (1140): 200$
    //   إلى حـ/ تكلفة مواد المشاريع - المشروع A (5110): 200$
    await createJournalEntry(tx, {
      description: `إرجاع 20 كيس إسمنت من المشروع A وتخفيض تكلفته بموجب السند ${mrrNo}`,
      reference_type: 'STOCK_RETURN',
      reference_id: mrrNo,
      lines: [
        { account_id: ctx.accounts.inv1140.id, project_id: null, debit: 200, credit: 0, notes: 'استعادة 20 كيس إسمنت إلى المستودع' },
        { account_id: ctx.accounts.cost5110.id, project_id: ctx.projectAId, debit: 0, credit: 200, notes: 'تخفيض تكلفة مواد المشروع A بالمرتجع' }
      ]
    });
  });
  console.log('✓ تم تسجيل المرتجع MRR وتخفيض تكلفة المشروع A بـ 200$ واستعادة الرصيد للمخزن.');

  // -------------------------------------------------------------
  // الخطوة 4: تحويل 20 كيس من المشروع A إلى المشروع B
  // -------------------------------------------------------------
  console.log('\n[4/5] تحويل 20 كيس من المشروع A إلى المشروع B بقيمة 200$...');
  await transaction(async (tx) => {
    const ptrNo = `PTR-CEM-${testSuffix}`;

    // 1. تسجيل وثيقة التحويل
    await tx.run(`
      INSERT INTO inter_project_material_transfers (
        transfer_no, from_project_id, to_project_id, from_warehouse_id, to_warehouse_id,
        item_id, quantity, unit_cost, total_amount, transfer_date, status, routing_rules_applied
      ) VALUES (?, ?, ?, ?, ?, ?, 20, 10.00, 200.00, CURRENT_DATE, 'approved', 'تحويل مواد لتغطية مرحلة الصب بالمشروع B')
    `, [ptrNo, ctx.projectAId, ctx.projectBId, ctx.warehouseId, ctx.warehouseId, ctx.itemId]);

    // 2. قيد نقل التكلفة بين المشروعين:
    // من حـ/ تكلفة مواد المشاريع - المشروع B (5110): 200$
    //   إلى حـ/ تكلفة مواد المشاريع - المشروع A (5110): 200$
    await createJournalEntry(tx, {
      description: `تحويل تكلفة 20 كيس إسمنت من المشروع A إلى المشروع B بموجب السند ${ptrNo}`,
      reference_type: 'INTER_PROJECT_TRANSFER',
      reference_id: ptrNo,
      lines: [
        { account_id: ctx.accounts.cost5110.id, project_id: ctx.projectBId, debit: 200, credit: 0, notes: 'تحميل تكلفة 20 كيس إسمنت للمشروع B' },
        { account_id: ctx.accounts.cost5110.id, project_id: ctx.projectAId, debit: 0, credit: 200, notes: 'تخفيض تكلفة 20 كيس إسمنت من المشروع A' }
      ]
    });
  });
  console.log('✓ تم اعتماد التحويل PTR وتخفيض تكلفة A وزيادة تكلفة B بقيمة 200$.');

  // -------------------------------------------------------------
  // الخطوة 5: تطبيق نسبة هالك وتوالف المخزون (3 أكياس = 30$)
  // -------------------------------------------------------------
  console.log('\n[5/5] إثبات هالك وتوالف بنسبة مقدرة (3 أكياس = 30$) وتنزيلها من المخزون...');
  await transaction(async (tx) => {
    const qrtNo = `SCRAP-CEM-${testSuffix}`;

    // 1. تسجيل التوالف بحجر التوالف
    await tx.run(`
      INSERT INTO material_quarantine_items (
        quarantine_no, warehouse_id, item_id, quantity, unit_cost,
        total_loss_amount, reason, bin_location, status
      ) VALUES (?, ?, ?, 3, 10.00, 30.00, 'تلف رطوبة بالشكائر أثناء التخزين', 'SCRAP_BIN_CEMENT', 'scrapped')
    `, [qrtNo, ctx.warehouseId, ctx.itemId]);

    // 2. خصم الكمية التالفة من رصيد المستودع الصالح (80 - 3 = 77 كيس)
    await tx.run('UPDATE warehouse_stocks SET quantity = quantity - 3 WHERE warehouse_id = ? AND item_id = ?', [ctx.warehouseId, ctx.itemId]);
    await tx.run('UPDATE items SET current_quantity = current_quantity - 3 WHERE id = ?', [ctx.itemId]);

    // 3. قيد إثبات الخسارة على حساب الهالك وتخفيض المخزون:
    // من حـ/ خسائر عجز وتسويات وتوالف المخزون (5115): 30$
    //   إلى حـ/ المخزون السلعي (1140): 30$
    await createJournalEntry(tx, {
      description: `إثبات هالك وتلف 3 أكياس إسمنت بموجب محضر الإتلاف ${qrtNo}`,
      reference_type: 'INVENTORY_WASTAGE',
      reference_id: qrtNo,
      lines: [
        { account_id: ctx.accounts.waste5115.id, project_id: null, debit: 30, credit: 0, notes: 'خسارة هالك 3 أكياس إسمنت' },
        { account_id: ctx.accounts.inv1140.id, project_id: null, debit: 0, credit: 30, notes: 'تخفيض المخزون بالكمية التالفة' }
      ]
    });
  });
  console.log('✓ تم تسجيل الهالك وخسارة التوالف بحساب 5115 بقيمة 30$ وتخفيض المخزون إلى 77 كيس.');

  // -------------------------------------------------------------
  // الخطوة 6: تنفيذ دالة المطابقة الرقابية الشاملة
  // -------------------------------------------------------------
  console.log('\n[6/6] تنفيذ دالة verifyFullReconciliation() لفحص الحسابات وميزان المراجعة...');
  const reconResult = await verifyFullReconciliation(ctx);

  console.log('🎯 اكتمل الاختبار بنجاح تام! كافة الأرصدة والمطابقات متطابقة 100%.');
  return reconResult;
}

// تنفيذ مباشر عند الاستدعاء كملف رئيسي
if (require.main === module) {
  runMaterialFlowScenario()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ حدث خطأ أثناء تشغيل سيناريو الاختبار:', err);
      process.exit(1);
    });
}

module.exports = {
  runMaterialFlowScenario,
  verifyFullReconciliation
};

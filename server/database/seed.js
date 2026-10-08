const bcrypt = require('bcryptjs');
const { db, query, run } = require('./db');

function seedDatabase() {
  console.log('🚀 فحص حالة قاعدة البيانات قبل بذر البيانات...');

  const isForce = process.argv.includes('--force');
  let userCount = 0;
  try {
    userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get()?.cnt || 0;
  } catch (e) {}

  if (userCount > 0 && !isForce) {
    console.log('🔒 حماية البيانات: قاعدة البيانات تحتوي على بيانات حقيقية للمستخدمين والمشاريع (' + userCount + ' مستخدمين). تم منع المسح التلقائي للحفاظ على البيانات.');
    console.log('💡 إذا كنت ترغب في إعادة ضبط البيانات التجريبية عمداً، استخدم الأمر: npm run seed -- --force');
    return;
  }

  console.log('🚀 جاري بذر البيانات التجريبية...');

  // 1. Roles & Tables Cleanup
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM project_contracts;
    DELETE FROM project_drawings;
    DELETE FROM project_boq;
    DELETE FROM project_quotations;
    DELETE FROM project_budgets;
    DELETE FROM project_change_orders;
    DELETE FROM project_purchases;
    DELETE FROM project_labor_expenses;
    DELETE FROM project_invoices;
    DELETE FROM project_daily_reports;
    DELETE FROM project_weekly_reports;
    DELETE FROM project_handover_minutes;
    DELETE FROM project_correspondence;
    DELETE FROM project_final_settlements;
    DELETE FROM expenses;
    DELETE FROM payments;
    DELETE FROM custodies;
    DELETE FROM cash_movements;
    DELETE FROM bills;
    DELETE FROM inventory_transactions;
    DELETE FROM items;
    DELETE FROM projects;
    DELETE FROM suppliers;
    DELETE FROM clients;
    DELETE FROM users;
    DELETE FROM roles;
    DELETE FROM accounts;
    DELETE FROM settings;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `);

  const insertRole = db.prepare('INSERT INTO roles (id, name, display_name, permissions) VALUES (?, ?, ?, ?)');
  insertRole.run(1, 'admin', 'المدير العام', 'all');
  insertRole.run(2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing');
  insertRole.run(3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses');
  insertRole.run(4, 'storekeeper', 'أمين المخزن', 'inventory,items');

  // 2. Users
  const salt = bcrypt.genSaltSync(10);
  const adminHash = bcrypt.hashSync('admin123', salt);
  const accountantHash = bcrypt.hashSync('account123', salt);

  const insertUser = db.prepare('INSERT INTO users (id, username, password_hash, full_name, role_id, role, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertUser.run(1, 'admin', adminHash, 'المدير العام', 1, 'admin', 'aalwi@engineer.com', '773413937', 'active');
  insertUser.run(2, 'accountant', accountantHash, 'المحاسب المالي', 2, 'accountant', 'accountant@rawasiaden.com', '773413937', 'active');

  // 3. Settings
  const insertSetting = db.prepare('INSERT INTO settings (key, value, description) VALUES (?, ?, ?)');
  insertSetting.run('company_name', 'رواسي عدن للهندسة والمقاولات', 'اسم الشركة بالعربي');
  insertSetting.run('company_name_en', 'Rawasi Aden for Engineering & Contracting', 'اسم الشركة بالإنجليزي');
  insertSetting.run('slogan', 'نبني الحاضر لنستثمر المستقبل', 'شعار الشركة اللفظي');
  insertSetting.run('phone1', '772332164', 'رقم الهاتف الرئيسي');
  insertSetting.run('phone2', '781278157', 'رقم الهاتف الإضافي');
  insertSetting.run('email', 'aalwi@engineer.com', 'البريد الإلكتروني');
  insertSetting.run('address', 'عدن - إنماء الجديدة - خلف القطيبي', 'عنوان المركز الرئيسي');
  insertSetting.run('currency', 'ر.ي', 'العملة الافتراضية');

  // 4. Clients
  const insertClient = db.prepare('INSERT INTO clients (id, name, company, phone, email, address, previous_balance, total_paid, total_due, current_balance, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertClient.run(1, 'شركة البناء الحديثة', 'شركة البناء الحديثة للتطوير العقاري', '771122334', 'binaa@info.com', 'عدن - المنصورة', 120000, 550000, 320000, 190000, 'عميل رئيسي للمشاريع السكنية');
  insertClient.run(2, 'أحمد عبدالله', 'مجموعة عبدالله للتجارة', '772233445', 'ahmed@aden.com', 'عدن - خور مكسر', 50000, 250000, 80000, 80000, 'مالك فيلا سكنية خاصة');
  insertClient.run(3, 'مؤسسة التربية', 'مؤسسة التربية والتعليم الأهلية', '773344556', 'tarbiah@aden.edu', 'عدن - المعلا', 0, 800000, 50000, 50000, 'مشروع مدرسة أهلية');
  insertClient.run(4, 'شركة الاستثمار', 'الشركة اليمنية للاستثمار العقاري', '774455667', 'invest@yemen.com', 'عدن - كريتر', 0, 400000, 0, 0, 'مستثمر مشروع تجاري');

  // 5. Suppliers
  const insertSupplier = db.prepare('INSERT INTO suppliers (id, name, category, phone, email, address, balance, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertSupplier.run(1, 'مؤسسة مواد البناء', 'مواد بناء وأسمنت', '775566778', 'binaamaterials@aden.com', 'عدن - الشيخ عثمان', 120000, 'المورد المعتمد للأسمنت والمواد');
  insertSupplier.run(2, 'شركة اليمامة للحديد', 'حديد تسليح', '776677889', 'yamama_steel@aden.com', 'عدن - المنطقة الحرة', 65000, 'مورد حديد التسليح');
  insertSupplier.run(3, 'مؤسسة الأمل للخرسانة', 'خرسانة جاهزة ومعدات', '777788990', 'amal_concrete@aden.com', 'عدن - دار سعد', 25000, 'مورد الخرسانة الجاهزة');

  // 6. Projects (Matching UI mockup exactly)
  const insertProj = db.prepare('INSERT INTO projects (id, code, name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, expected_profit, actual_profit, status, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  
  // 4 Featured from Dashboard
  insertProj.run(1, 'PRJ-001', 'مشروع بناء مجمع سكني', 1, 1200000, 800000, 650000, 65, 400000, 350000, 'active', '2024-01-01', '2024-12-30', 'مشروع مجمع سكني 4 طوابق');
  insertProj.run(2, 'PRJ-002', 'مشروع فيلا خاصة', 2, 600000, 400000, 350000, 80, 200000, 150000, 'active', '2024-02-15', '2024-08-30', 'تشطيب وتسليم فيلا VIP');
  insertProj.run(3, 'PRJ-003', 'مشروع مدرسة أهلية', 3, 2000000, 1500000, 1200000, 60, 500000, 300000, 'active', '2023-11-01', '2024-10-30', 'مبنى تعليمي وملاعب');
  insertProj.run(4, 'PRJ-004', 'مشروع عمارة تجارية', 4, 1600000, 1300000, 1300000, 40, 500000, 200000, 'active', '2024-03-01', '2025-03-01', 'برج تجاري 6 أدوار');
  
  // Additional active & completed projects to match 8 active and 15 total!
  insertProj.run(5, 'PRJ-005', 'مشروع مركز صحي السلام', 1, 950000, 700000, 400000, 55, 250000, 180000, 'active', '2024-01-10', '2024-09-20', 'إنشاء مبنى عيادات');
  insertProj.run(6, 'PRJ-006', 'مشروع ترميم برج النصر', 4, 450000, 320000, 190000, 70, 130000, 95000, 'active', '2024-02-01', '2024-07-15', 'أعمال تدعيم وتجديد واجهات');
  insertProj.run(7, 'PRJ-007', 'مشروع تشييد مستودعات التوزيع', 1, 850000, 600000, 350000, 50, 250000, 150000, 'active', '2024-03-15', '2024-11-30', 'هناجر ومستودعات عزل حراري');
  insertProj.run(8, 'PRJ-008', 'مشروع سفلتة وإنارة مجمع الفردوس', 3, 380000, 280000, 140000, 45, 100000, 60000, 'active', '2024-04-01', '2024-08-01', 'أعمال البنية التحتية');
  
  // 7 Completed / Archived Projects (Total = 15)
  insertProj.run(9, 'PRJ-009', 'مشروع برج الأندلس السكني', 1, 1500000, 1100000, 1050000, 100, 400000, 450000, 'completed', '2023-01-01', '2023-12-01', 'تم التسليم بنجاح');
  insertProj.run(10, 'PRJ-010', 'مشروع فيلا الشاطئ الذهبي', 2, 750000, 550000, 530000, 100, 200000, 220000, 'completed', '2023-03-01', '2023-10-15', 'تم التسليم');
  insertProj.run(11, 'PRJ-011', 'مشروع مبنى إداري المنصورة', 4, 1100000, 800000, 810000, 100, 300000, 290000, 'completed', '2023-02-01', '2023-11-20', 'تم التسليم');
  insertProj.run(12, 'PRJ-012', 'مشروع حديقة ومتنزه النصر', 3, 400000, 300000, 290000, 100, 100000, 110000, 'completed', '2023-04-01', '2023-09-01', 'تم التسليم');
  insertProj.run(13, 'PRJ-013', 'مشروع محطة توليد طاقة شمسية', 1, 900000, 650000, 640000, 100, 250000, 260000, 'completed', '2023-05-01', '2023-12-30', 'تم التسليم');
  insertProj.run(14, 'PRJ-014', 'مشروع شبكة مياه خور مكسر', 3, 620000, 480000, 470000, 100, 140000, 150000, 'completed', '2023-06-01', '2023-11-30', 'تم التسليم');
  insertProj.run(15, 'PRJ-015', 'مشروع مجمع المعلا التجاري', 4, 1800000, 1400000, 1380000, 100, 400000, 420000, 'completed', '2022-09-01', '2023-08-15', 'تم التسليم');

  // 7. Recent Operations & Expenses
  const insertExpense = db.prepare('INSERT INTO expenses (receipt_no, expense_type, project_id, supplier_id, amount, payment_method, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertExpense.run('EXP-2024-001', 'مواد بناء', 2, 1, 45000, 'نقدي', '2024-05-20', 'شراء إسمنت وحديد');
  insertExpense.run('EXP-2024-002', 'أجور عمالة', 1, null, 20000, 'نقدي', '2024-05-19', 'أجور عمالة صب خرسانة');
  insertExpense.run('EXP-2024-003', 'نقل ومواصلات', 2, null, 5000, 'نقدي', '2024-05-18', 'نقل ومواصلات نقل تربة');
  insertExpense.run('EXP-2024-004', 'معدات', 3, 3, 127500, 'تحويل بنكي', '2024-05-10', 'استئجار حفار ومضخة خرسانة');
  insertExpense.run('EXP-2024-005', 'مواد بناء', 1, 2, 295000, 'شيك', '2024-05-05', 'توريد حديد تسليح');
  insertExpense.run('EXP-2024-006', 'أجور عمالة', 3, null, 192500, 'نقدي', '2024-04-28', 'رواتب وأجور فرق البناء');
  insertExpense.run('EXP-2024-007', 'مصروفات إدارية', null, null, 42500, 'نقدي', '2024-05-02', 'فواتير اتصالات وضيافة مكتبية');
  insertExpense.run('EXP-2024-008', 'أخرى', null, null, 42500, 'نقدي', '2024-05-12', 'مصروفات صيانة ونثريات عامة');
  insertExpense.run('EXP-2024-009', 'أجور عمالة', 4, null, 80000, 'نقدي', '2024-05-15', 'أعمال نجارة مسلحة وحدادة');

  // 8. Payments (Revenues and Collections)
  const insertPayment = db.prepare('INSERT INTO payments (receipt_no, type, client_id, supplier_id, project_id, amount, payment_method, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertPayment.run('RC-2024-001', 'قبض', 1, null, 1, 150000, 'تحويل بنكي', '2024-05-20', 'دفعة أولى من المستخلص رقم 3');
  insertPayment.run('RC-2024-002', 'قبض', 3, null, 3, 200000, 'تحويل بنكي', '2024-05-19', 'دفعة من العميل عن أعمال الدور الثاني');
  insertPayment.run('RC-2024-003', 'قبض', 2, null, 2, 350000, 'شيك', '2024-04-15', 'دفعة مقدمة مرحلية');
  insertPayment.run('RC-2024-004', 'قبض', 4, null, 4, 400000, 'تحويل بنكي', '2024-03-10', 'دفعة حفر وأساسات');
  insertPayment.run('RC-2024-005', 'قبض', 1, null, 1, 150000, 'نقدي', '2024-02-18', 'دفعة نقدية');

  // 9. Custodies (النثريات والعهد)
  const insertCustody = db.prepare('INSERT INTO custodies (operation_type, employee_name, total_amount, spent_amount, remaining_amount, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertCustody.run('صرف عهدة', 'أحمد محمد', 10000, 3500, 6500, '2024-05-20', 'قرطاسية ومصروفات مكتبية يومية');
  insertCustody.run('صرف عهدة', 'م. خالد سالم', 50000, 42000, 8000, '2024-05-15', 'عهدة مشتريات طارئة لمشروع المجمع');
  insertCustody.run('تصفية عهدة', 'سالم بازرعة', 25000, 25000, 0, '2024-05-10', 'تصفية عهدة نقل ومحروقات');

  // 10. Cash Movements (حركة الصندوق)
  const insertCash = db.prepare('INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertCash.run(50000, 25000, 15000, 5000, 55000, '2024-05-20', 'إغلاق وردية يوم 20 مايو');

  // 11. Items & Inventory
  const insertItem = db.prepare('INSERT INTO items (code, name, category, unit, min_quantity, current_quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertItem.run('ITM-01', 'أسمنت بورتلاندي مقاوم', 'أسمنت', 'كيس', 100, 850, 4500, 'أسمنت ذو جودة عالية للمقاولات');
  insertItem.run('ITM-02', 'حديد تسليح 12 ملم تركي', 'حديد', 'طن', 5, 28, 480000, 'حديد مطابق للمواصفات الهندسية');
  insertItem.run('ITM-03', 'حديد تسليح 16 ملم تركي', 'حديد', 'طن', 5, 18, 490000, 'حديد للقواعد والأعمدة');
  insertItem.run('ITM-04', 'بلوك أسمنتي 20 سم', 'بلوك', 'حبة', 500, 6200, 350, 'بلوك هردي وبناء');
  insertItem.run('ITM-05', 'رمل سيليكا ناعم', 'رمل', 'متر مكعب', 20, 120, 8500, 'رمل ناعم لأعمال اللياسة');
  insertItem.run('ITM-06', 'كري وخرسانة سن 1-2', 'ركام', 'متر مكعب', 20, 150, 12000, 'ركام صلب لخلطات الخرسانة');

  // 12. Chart of Accounts (دليل الحسابات الشجري القياسي)
  const insertAccount = db.prepare('INSERT INTO accounts (id, code, name, type, parent_id, balance) VALUES (?, ?, ?, ?, ?, ?)');
  insertAccount.run(1, '1', 'الأصول', 'أصول', null, 2450000);
  insertAccount.run(2, '11', 'الأصول المتداولة', 'أصول', 1, 1850000);
  insertAccount.run(3, '111', 'الصندوق الرئيسي والبنك', 'أصول', 2, 125000);
  insertAccount.run(4, '112', 'العملاء (الذمم المدينة)', 'أصول', 2, 320000);
  insertAccount.run(5, '113', 'المخزون السلعي', 'أصول', 2, 1405000);
  insertAccount.run(6, '2', 'الخصوم', 'خصوم', null, 210000);
  insertAccount.run(7, '21', 'الموردون', 'خصوم', 6, 210000);
  insertAccount.run(8, '3', 'حقوق الملكية', 'حقوق ملكية', null, 1840000);
  insertAccount.run(9, '4', 'الإيرادات', 'إيرادات', null, 1250000);
  insertAccount.run(10, '5', 'المصروفات وتكاليف المشاريع', 'مصروفات', null, 850000);

  // 13. Bills (المستخلصات)
  const insertBill = db.prepare('INSERT INTO bills (bill_no, bill_type, project_id, client_id, amount, deduction, net_amount, status, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertBill.run('INV-2024-001', 'مستخلص جاري رقم 3', 1, 1, 400000, 40000, 360000, 'معتمد', '2024-05-15', 'أعمال صب سقف الدور الثالث وتشطيبات الكهرباء');
  insertBill.run('INV-2024-002', 'مستخلص جاري رقم 2', 2, 2, 220000, 20000, 200000, 'معتمد', '2024-05-10', 'أعمال اللياسة والدهانات الأولية');
  insertBill.run('INV-2024-003', 'مستخلص جاري رقم 1', 3, 3, 300000, 30000, 270000, 'معتمد', '2024-05-02', 'أعمال الأساسات والقواعد الخرسانية');

  // =========================================================================
  // بذر البيانات الشاملة لمتطلبات إدارة المشاريع الـ 14
  // =========================================================================

  // 1. العقود (Contracts)
  const insertContract = db.prepare(`
    INSERT INTO project_contracts (
      project_id, contract_no, title, first_party, second_party, contract_date, 
      start_date, end_date, duration_days, contract_value, currency, 
      advance_payment_pct, advance_payment_amount, retention_pct, penalty_per_day, 
      max_penalty_pct, payment_terms, scope_of_work, status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertContract.run(
    1, 'CNT-2024-001', 'عقد تنفيذ وإنشاء مجمع سكني 4 طوابق', 'شركة البناء الحديثة للتطوير العقاري', 'شركة رواسي عدن للهندسة والمقاولات',
    '2024-01-01', '2024-01-01', '2024-12-30', 365, 1200000, 'ر.ي',
    10, 120000, 10, 2000, 10, 'دفعات شهرية حسب المستخلصات المعتمدة من الاستشاري المشرف',
    'تنفيذ كافة أعمال الهيكل الخرساني المسلح وأعمال البناء والتشطيبات المعمارية والتمديدات الكهروميكانيكية تسليم مفتاح وفق المخططات وجدول الكميات المعتمد.',
    'ساري', 'تم سداد الدفعة المقدمة واستلام موقع العمل خالياً من العوائق.'
  );
  insertContract.run(
    2, 'CNT-2024-002', 'عقد تشطيب وتسليم فيلا سكنية VIP', 'أحمد عبدالله', 'شركة رواسي عدن للهندسة والمقاولات',
    '2024-02-15', '2024-02-15', '2024-08-30', 195, 600000, 'ر.ي',
    15, 90000, 5, 1000, 10, 'دفعات مرحلية حسب إنجاز بنود التشطيب والديكورات',
    'تشطيبات فاخرة تتضمن اللياسة والدهانات والأرضيات الرخامية والأسقف الجبسية وتأثيث الحدائق الخارجية.',
    'ساري', 'المشروع في مرحلة التشطيبات النهائية.'
  );

  // 2. المخططات الهندسية (Drawings)
  const insertDrawing = db.prepare(`
    INSERT INTO project_drawings (
      project_id, drawing_no, title, category, scale, revision, 
      submission_date, approval_date, status, engineer_name, file_name, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDrawing.run(1, 'DWG-ARCH-001', 'المخطط المعماري العام والمساقط الأفقية للأدوار', 'معماري', '1:100', 'Rev 1', '2024-01-05', '2024-01-10', 'معتمد', 'م. علوي', 'Arch_Layout_Final.dwg', 'معتمد بدون ملاحظات');
  insertDrawing.run(1, 'DWG-STR-002', 'المخططات الإنشائية وتفاصيل تسليح القواعد والأعمدة', 'إنشائي', '1:50', 'Rev 2', '2024-01-12', '2024-01-16', 'معتمد', 'م. خالد سالم', 'Structural_Details_R2.dwg', 'تم اعتماد تعديل أقطار حديد القواعد');
  insertDrawing.run(1, 'DWG-MEP-003', 'مخططات التمديدات الكهربائية والصحية ومكافحة الحريق', 'كهروميكانيكي MEP', '1:100', 'Rev 0', '2024-01-20', '2024-01-25', 'معتمد بملاحظات', 'م. عادل الشريف', 'MEP_Services.dwg', 'اعتماد مشروط بتعديل مسار خطوط الصرف الخارجية');
  insertDrawing.run(1, 'DWG-SHP-004', 'مخططات الورشة التنفيذية (Shop Drawings) للأسقف والجسور', 'تنفيذي Shop Drawing', '1:25', 'Rev 1', '2024-02-01', '2024-02-05', 'معتمد', 'م. علي صالح', 'Shop_Drawings_Slabs.dwg', 'جاهزة للتنفيذ الميداني');
  insertDrawing.run(1, 'DWG-ASB-005', 'مخططات كما نُفذ (As-Built) للأساسات والخدمات الأرضية', 'كما نفذ As-Built', '1:100', 'Rev 0', '2024-03-01', '2024-03-05', 'معتمد', 'م. علوي', 'AsBuilt_Foundations.dwg', 'مطابق للواقع المنفذ بعد الفحص');

  // 3. جدول الكميات (BOQ)
  const insertBoq = db.prepare(`
    INSERT INTO project_boq (
      project_id, item_no, description, category, unit, 
      contract_qty, executed_qty, unit_rate, total_amount, status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertBoq.run(1, '1.1', 'أعمال الحفر والترحيل للأتربة والأساسات حتى الوصول لمنسوب التأسيس الصخري', 'أعمال ترابية وحفر', 'م3', 450, 450, 350, 157500, 'مكتمل', 'تم إنجاز الحفر بالكامل واختبار التربة');
  insertBoq.run(1, '2.1', 'توريد وصب خرسانة مسلحة عيار 350 كجم/سم2 للقواعد الخرسانية والميد ورقاب الأعمدة', 'أعمال خرسانية', 'م3', 180, 180, 2800, 504000, 'مكتمل', 'صب خرسانة جاهزة مع الفحص المخبري للعينات');
  insertBoq.run(1, '2.2', 'توريد وصب خرسانة مسلحة عيار 350 كجم/سم2 للأعمدة والأسقف والكمرات لكافة الأدوار', 'أعمال خرسانية', 'م3', 220, 145, 2900, 638000, 'جاري التنفيذ', 'تم صب أسقف الدور الأول والثاني وجاري تجهيز الثالث');
  insertBoq.run(1, '3.1', 'بناء حوائط خارجية وداخلية من البلوك الأسمنتي عالي الجودة سمك 20 سم و 15 سم', 'أعمال مباني وعزل', 'م2', 1200, 850, 250, 300000, 'جاري التنفيذ', 'أعمال البلوك جارية بالتوازي مع صب الأسقف');
  insertBoq.run(1, '4.1', 'أعمال البياض الإسمنتي الداخلي والخارجي (اللياسة) وجهين مع الطرطشة', 'أعمال تشطيبات', 'م2', 2800, 1500, 180, 504000, 'جاري التنفيذ', 'لياسة الدور الأول مكتملة');
  insertBoq.run(1, '5.1', 'تمديدات الكهرباء والإنارة والتأريض ومآخذ القوى بالكامل', 'أعمال كهروميكانيكية', 'نقطة', 350, 200, 450, 157500, 'جاري التنفيذ', 'تمديد خراطيم وتمديدات الدورين الأول والثاني');

  // 4. عروض الأسعار (Quotations)
  const insertQuotation = db.prepare(`
    INSERT INTO project_quotations (
      project_id, client_id, quotation_no, title, date, valid_until, 
      items_json, subtotal, discount, tax_vat, total_amount, currency, 
      payment_terms, delivery_period, status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const quoItemsJson = JSON.stringify([
    { item: 'تنفيذ أعمال الهيكل الخرساني المسلح تسليم مفتاح', unit: 'مقطوع', qty: 1, rate: 850000, total: 850000 },
    { item: 'تنفيذ أعمال التشطيبات المعمارية والواجهات', unit: 'مقطوع', qty: 1, rate: 300000, total: 300000 },
    { item: 'تمديدات الكهرباء والصحي وشبكة التغذية والصرف', unit: 'مقطوع', qty: 1, rate: 100000, total: 100000 }
  ]);
  insertQuotation.run(
    1, 1, 'QUO-2024-001', 'عرض سعر متكامل لإنشاء وتشطيب مجمع سكني 4 طوابق', '2023-12-15', '2024-01-15',
    quoItemsJson, 1250000, 50000, 0, 1200000, 'ر.ي',
    'دفعة مقدمة 10% والباقي بموجب مستخلصات دورية شهرية', '12 شهراً من تاريخ تسليم الموقع', 'معتمد', 'تم اعتماد العرض وتوقيع العقد الرسمي.'
  );

  // 5. الميزانية والتكلفة المستهدفة (Budgets)
  const insertBudget = db.prepare(`
    INSERT INTO project_budgets (project_id, category, planned_cost, actual_cost, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertBudget.run(1, 'مواد بناء', 450000, 340000, 'أسمنت، حديد، خرسانة جاهزة، بلوك');
  insertBudget.run(1, 'أجور عمالة ومقاولين', 220000, 190000, 'نجارة مسلحة، حدادة، بناء، عمالة موقع');
  insertBudget.run(1, 'معدات وآليات', 60000, 55000, 'استئجار مضخة خرسانة، رافعات، حفار');
  insertBudget.run(1, 'نقل ومحروقات', 25000, 22000, 'نقل مواد، ديزل لمولدات الموقع');
  insertBudget.run(1, 'مصاريف موقع وإشراف', 30000, 28000, 'إشراف هندسي وضيافة وقرطاسية ميدانية');
  insertBudget.run(1, 'نثريات وطوارئ', 15000, 15000, 'احتياطي طوارئ وتعديلات موقع');

  // 6. أوامر التغيير والإضافيات (Change Orders)
  const insertChangeOrder = db.prepare(`
    INSERT INTO project_change_orders (
      project_id, change_no, title, type, request_date, approval_date, 
      amount, time_extension_days, reason, status, requested_by, approved_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertChangeOrder.run(
    1, 'CO-001', 'إضافة مظلات خرسانية خارجية وتعديل مداخل المبنى', 'إضافة بند جديد',
    '2024-02-10', '2024-02-18', 45000, 15, 'طلب المالك', 'معتمد', 'المالك / شركة البناء', 'المهندس الاستشاري المشرف',
    'تمت دراسة التكلفة والتعديل المعماري والموافقة على الأثر المالي والزمني.'
  );
  insertChangeOrder.run(
    1, 'CO-002', 'تعديل قطاعات حديد تسليح أسقف الأدوار العلوية', 'تعديل كميات ومواصفات',
    '2024-03-05', '2024-03-12', 25000, 7, 'تعديل تصميمي', 'معتمد', 'مكتب التصميم الإنشائي', 'المهندس الاستشاري',
    'زيادة حديد التسليح بناءً على متطلبات التوسعة المستقبلية.'
  );

  // 7. مشتريات وفواتير المشروع (Project Purchases)
  const insertProjPurchase = db.prepare(`
    INSERT INTO project_purchases (
      project_id, invoice_no, supplier_id, supplier_name, item_description, 
      quantity, unit, unit_price, total_amount, paid_amount, payment_status, 
      payment_method, date, receipt_no, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertProjPurchase.run(
    1, 'INV-SUP-01', 2, 'شركة اليمامة للحديد', 'توريد 15 طن حديد تسليح تركي عالي المقاومة أقطار متنوعة',
    15, 'طن', 48000, 720000, 500000, 'مدفوع جزئي', 'شيك', '2024-02-15', 'REC-0912', 'تم توريدها للموقع وفحصها هندسياً'
  );
  insertProjPurchase.run(
    1, 'INV-SUP-02', 1, 'مؤسسة مواد البناء', 'توريد 400 كيس أسمنت بورتلاندي مقاوم للأملاح',
    400, 'كيس', 4500, 180000, 180000, 'مدفوع', 'نقدي', '2024-03-01', 'REC-0945', 'استخدم في صب القواعد والأعمدة'
  );

  // 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
  const insertLabor = db.prepare(`
    INSERT INTO project_labor_expenses (
      project_id, date, worker_name_or_team, trade, workers_count, 
      daily_rate, days_or_hours, total_amount, expense_category, 
      payment_status, supervisor_name, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertLabor.run(1, '2024-05-19', 'طاقم نجارة مسلحة وحدادة (م. أحمد وسالم)', 'نجار مسلح', 8, 2500, 1, 20000, 'أجور عمالة', 'مدفوع', 'م. علوي', 'أعمال نجارة سقف الدور الثالث');
  insertLabor.run(1, '2024-05-18', 'فريق صب الخرسانة الجاهزة والمضخة', 'عمالة عادية', 6, 2500, 1, 15000, 'أجور عمالة', 'مدفوع', 'م. علوي', 'صب أعمدة الدور الثاني');
  insertLabor.run(1, '2024-05-12', 'محروقات ديزل للحفار ومولد الكهرباء', 'محروقات معدات', 1, 12000, 1, 12000, 'محروقات معدات', 'مدفوع', 'م. علوي', 'تشغيل المعدات الميدانية');

  // 9. المستخلصات وشهادات الدفع (Invoices / IPCs)
  const insertProjInvoice = db.prepare(`
    INSERT INTO project_invoices (
      project_id, client_id, invoice_no, invoice_type, period_from, period_to, 
      cumulative_work_done, previous_bills_amount, current_gross_amount, 
      advance_deduction, retention_deduction, other_deductions, net_amount, 
      status, date, approval_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertProjInvoice.run(
    1, 1, 'IPC-01', 'مستخلص جاري', '2024-01-01', '2024-02-01',
    250000, 0, 250000, 25000, 25000, 0, 200000,
    'محصل كامل', '2024-02-05', '2024-02-08', 'مستخلص أعمال الحفر والأساسات والقواعد'
  );
  insertProjInvoice.run(
    1, 1, 'IPC-02', 'مستخلص جاري', '2024-02-02', '2024-03-15',
    550000, 250000, 300000, 30000, 30000, 0, 240000,
    'محصل كامل', '2024-03-20', '2024-03-23', 'مستخلص أعمال الميد ورقاب الأعمدة وسقف الدور الأول'
  );
  insertProjInvoice.run(
    1, 1, 'IPC-03', 'مستخلص جاري', '2024-03-16', '2024-05-15',
    950000, 550000, 400000, 40000, 40000, 0, 320000,
    'معتمد للصرف', '2024-05-15', '2024-05-18', 'مستخلص سقف الدور الثاني والثالث وأعمال البلوك واللياسة'
  );

  // 10. التقارير اليومية (Daily Reports)
  const insertDaily = db.prepare(`
    INSERT INTO project_daily_reports (
      project_id, report_no, date, weather, manpower_count, equipment_summary, 
      work_performed, materials_received, safety_notes, delays_obstacles, site_engineer, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDaily.run(
    1, 'DR-2024-001', '2024-05-20', 'مشمس 29° مئوية', 14, 'حفار كوماتسو + مضخة خرسانة + هزازين',
    'استكمال نجارة وتسليح حديد سقف الدور الثالث والبدء بتمديدات خراطيم الكهرباء وصناديق التوزيع.',
    'توريد 150 كيس أسمنت و 4 أطنان حديد تسليح 14 ملم.',
    'الالتزام الصارم بارتداء الخوذات وأحذية السلامة وأحزمة الأمان.',
    'لا توجد معوقات، وسير العمل متطابق تماماً مع الخطة والجدول الزمني.',
    'م. علوي', 'تم توثيق كافة الأعمال بالصور الميدانية.'
  );
  insertDaily.run(
    1, 'DR-2024-002', '2024-05-19', 'معتدل 27° مئوية', 16, 'مضخة خرسانة + 3 خلاطات جاهزة',
    'صب خرسانة أعمدة الدور الثاني بعدد 18 عمود ومعالجة الخرسانة بالرش بالمياه بعد فك القوالب.',
    'توريد 45 متر مكعب خرسانة جاهزة عيار 350 كجم.',
    'تأمين السقالات والتأكد من تدعيم شدات الأعمدة قبل وأثناء الصب.',
    'تأخير بسيط لمدة 20 دقيقة في حركة شاحنات النقل وتم تداركه.',
    'م. علوي', 'أخذ 6 عينات مكعبات خرسانية للفحص بعد 7 و 28 يوماً.'
  );

  // 11. التقارير الأسبوعية (Weekly Reports)
  const insertWeekly = db.prepare(`
    INSERT INTO project_weekly_reports (
      project_id, report_no, week_no, date_from, date_to, planned_progress_pct, 
      actual_progress_pct, achievements_summary, next_week_plan, critical_issues, 
      prepared_by, approved_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertWeekly.run(
    1, 'WR-2024-020', 20, '2024-05-13', '2024-05-19', 68, 65,
    'تم إنجاز صب كافة أعمدة الدور الثاني والبدء بنجارة وحدادة السقف، والانتهاء من أعمال التأسيسات الكهربائية والصحية للدور الأول بنسبة 100%.',
    'استكمال حدادة سقف الدور الثالث واستدعاء الاستشاري للاستلام ثم الصب، مع بدء أعمال مباني البلوك للدور الثاني.',
    'ضرورة تأكيد توريد دفعة البلوك الإضافية في موعد أقصاه الأربعاء لتجنب توقف عمال البناء.',
    'م. علوي', 'المدير العام', 'المشروع يسير بوتيرة ممتازة وضمن نطاق الميزانية المحددة.'
  );

  // 12. محاضر الاستلام والفحص الهندسي (Handover Minutes)
  const insertHandover = db.prepare(`
    INSERT INTO project_handover_minutes (
      project_id, minute_no, type, location_axis, inspection_date, inspector_name, 
      contractor_rep, status, punch_list, recommendations, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHandover.run(
    1, 'IR-2024-001', 'استلام حدادة مسلحة', 'القواعد الخرسانية والشناجات - المحاور A إلى F',
    '2024-01-25', 'م. عبدالرحمن (المهندس الاستشاري)', 'م. علوي (مدير المشروع)', 'معتمد ومقبول',
    'لا توجد ملاحظات، المسافات وأقطار وأطوال أسياخ التسليح مطابقة تماماً للمخطط DWG-STR-002.',
    'التصريح الفوري بصب الخرسانة مع الالتزام بالهز الميكانيكي الجيد والرش بالمياه لمدة 7 أيام.',
    'تم التوقيع والاعتماد بمحضر الموقع الرسمي.'
  );
  insertHandover.run(
    1, 'IR-2024-002', 'استلام صب خرسانة', 'سقف وكمرات الدور الأول بالكامل',
    '2024-03-10', 'م. عبدالرحمن (المهندس الاستشاري)', 'م. علوي (مدير المشروع)', 'مقبول بملاحظات',
    'زيادة بسكوت الغطاء الخرساني للكمرات الجانبية والتأكد من نظافة الشدة الخشبية من نشارة الخشب قبل الصب.',
    'معتمد للصب بعد معالجة ملاحظة الغطاء الخرساني والتنظيف بمضخة الهواء.',
    'تم تلافي الملاحظات والصب في نفس اليوم بنجاح.'
  );

  // 13. المراسلات مع المالك والاستشاري (Correspondence)
  const insertCorrespondence = db.prepare(`
    INSERT INTO project_correspondence (
      project_id, ref_no, direction, subject, date, priority, summary_body, 
      required_action, response_status, sender, recipient, attachment_name, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCorrespondence.run(
    1, 'COR-OUT-001', 'صادر إلى الاستشاري', 'طلب اعتماد عينات حديد التسليح والأسمنت المقاوم',
    '2024-01-08', 'هام', 'نرفع لعنايتكم شهادات الفحص المخبري والكتالوجات الفنية لحديد التسليح عيار 60 والأسمنت البورتلاندي المقاوم للاعتماد قبل التوريد.',
    'المراجعة والاعتماد الخطي', 'تم الرد', 'م. علوي (رواسي عدن)', 'مكتب الاستشارات الهندسية', 'Material_Approval_Sheets.pdf', 'تم اعتماد العينات بكتاب الاستشاري رقم AP-102.'
  );
  insertCorrespondence.run(
    1, 'COR-IN-002', 'وارد من الاستشاري', 'اعتماد الجدول الزمني المعدل للمشروع متضمناً أوامر التغيير',
    '2024-02-20', 'عادي', 'تمت مراجعة الجدول الزمني المحدث متضمناً أمر التغيير CO-001 ونفيدكم بالموافقة والاعتماد لمتابعة نسب الإنجاز.',
    'الحفظ والمطابقة الميدانية', 'منتهي ومغلق', 'المهندس الاستشاري المشرف', 'شركة رواسي عدن للهندسة والمقاولات', 'Approved_Time_Schedule_R1.pdf', 'تم إدراج الجدول في تقارير المتابعة.'
  );

  // 14. الحساب الختامي وتصفية المشروع (Final Settlement)
  const insertSettlement = db.prepare(`
    INSERT INTO project_final_settlements (
      project_id, settlement_no, date, original_contract_val, approved_change_orders_val, 
      revised_contract_val, total_executed_work_val, total_client_payments_received, 
      released_retention_val, penalties_deductions_val, final_balance_due, due_to, 
      status, prepared_by, approved_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSettlement.run(
    9, 'SET-PRJ-009', '2023-12-05', 1500000, 80000, 1580000, 1580000, 1500000, 80000, 0, 80000, 'لصالح المقاول',
    'معتمد وموقع', 'م. علوي', 'المدير العام',
    'تم استلام المشروع ابتدائياً ونهائياً والإفراج عن محجوز الضمان وتصفية كافة الحسابات والمستحقات بموجب المخالصة الختامية.'
  );

  console.log('✅ تم بذر البيانات الأولية بنجاح وتطابق كامل مع كافة متطلبات إدارة المشاريع الـ 14!');
}

seedDatabase();


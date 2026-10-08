/**
 * سكريبت هجرة وتحديث بيانات كشف الراتب الشامل لشهر اغسطس 2026م
 * يطبق جميع المعطيات والنسب والقوانين الموضحة في كشف الراتب:
 * - بدل إنتقال 20%
 * - بدل مظهر 25%
 * - بدل طبيعة عمل 30%
 * - بدل معيشة وبدل تأمين صحي
 * - التأمينات 6% موظف و 9% منشأة
 * - حد الإعفاء الضريبي 65,000 ر.ي والوعاء الضريبي
 * - ضريبة كسب العمل (10% لأول 40,000 و 15% لما زاد)
 * - صندوق تنمية المهارات 1%
 * - إدراج وتحديث الموظفين الـ 13 ومسير شهر 2026-08 بالمطابقة التامة
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'rawasi_aden.db');
console.log('🔄 جاري تطبيق معطيات كشف الراتب الشامل على قاعدة البيانات:', dbPath);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

try {
  // 1. إضافة الحقول الموسعة في جدول مسير الرواتب payroll
  const payrollCols = db.prepare("PRAGMA table_info(payroll)").all().map(c => c.name);
  const newPayrollCols = [
    { name: 'earned_basic', type: 'REAL DEFAULT 0' },
    { name: 'transport_allowance', type: 'REAL DEFAULT 0' },
    { name: 'appearance_allowance', type: 'REAL DEFAULT 0' },
    { name: 'nature_of_work_allowance', type: 'REAL DEFAULT 0' },
    { name: 'living_allowance', type: 'REAL DEFAULT 0' },
    { name: 'health_insurance_allowance', type: 'REAL DEFAULT 0' },
    { name: 'gross_salary', type: 'REAL DEFAULT 0' },
    { name: 'insurance_employee', type: 'REAL DEFAULT 0' },
    { name: 'insurance_employer', type: 'REAL DEFAULT 0' },
    { name: 'absence_penalty_deductions', type: 'REAL DEFAULT 0' },
    { name: 'loan_installments', type: 'REAL DEFAULT 0' },
    { name: 'taxable_base', type: 'REAL DEFAULT 0' },
    { name: 'tax_amount', type: 'REAL DEFAULT 0' },
    { name: 'skills_fund', type: 'REAL DEFAULT 0' },
    { name: 'unpaid_leave_deduction', type: 'REAL DEFAULT 0' },
    { name: 'total_net_salary', type: 'REAL DEFAULT 0' },
    { name: 'working_days', type: 'INTEGER DEFAULT 31' },
    { name: 'month_days', type: 'INTEGER DEFAULT 31' },
    { name: 'cost_center', type: 'TEXT DEFAULT "الإدارة العامة"' },
    { name: 'bank_account', type: 'TEXT DEFAULT ""' }
  ];

  for (const col of newPayrollCols) {
    if (!payrollCols.includes(col.name)) {
      db.exec(`ALTER TABLE payroll ADD COLUMN ${col.name} ${col.type};`);
      console.log(`✓ تم إضافة العمود ${col.name} إلى جدول مسير الرواتب payroll`);
    }
  }

  // 2. إضافة الحقول الموسعة في جدول الموظفين employees
  const empCols = db.prepare("PRAGMA table_info(employees)").all().map(c => c.name);
  const newEmpCols = [
    { name: 'transport_pct', type: 'REAL DEFAULT 20' },
    { name: 'appearance_pct', type: 'REAL DEFAULT 25' },
    { name: 'nature_of_work_pct', type: 'REAL DEFAULT 30' },
    { name: 'living_allowance', type: 'REAL DEFAULT 90000' },
    { name: 'health_insurance_allowance', type: 'REAL DEFAULT 30000' },
    { name: 'cost_center', type: 'TEXT DEFAULT "الإدارة العامة"' }
  ];

  for (const col of newEmpCols) {
    if (!empCols.includes(col.name)) {
      db.exec(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.type};`);
      console.log(`✓ تم إضافة العمود ${col.name} إلى جدول الموظفين employees`);
    }
  }

  // 3. إضافة الحسابات المالية النظامية لصندوق تنمية المهارات والتأمينات
  const accountsToAdd = [
    { code: '114', name: 'سلف وعهد الموظفين', type: 'أصول', parent_code: '11' },
    { code: '213', name: 'أمانات مصلحة الضرائب (ضريبة كسب العمل)', type: 'خصوم', parent_code: '2' },
    { code: '214', name: 'الهيئة العامة للتأمينات والمعاشات', type: 'خصوم', parent_code: '2' },
    { code: '215', name: 'أمانات صندوق تنمية المهارات (1%)', type: 'خصوم', parent_code: '2' },
    { code: '511', name: 'مصروف الرواتب والأجور الأساسية والبدلات', type: 'مصروفات', parent_code: '5' },
    { code: '512', name: 'مصروف مساهمة الشركة في التأمينات الاجتماعية (9%)', type: 'مصروفات', parent_code: '5' },
    { code: '513', name: 'مصروف مساهمة صندوق تنمية المهارات (1%)', type: 'مصروفات', parent_code: '5' }
  ];

  const checkAccount = db.prepare('SELECT id FROM accounts WHERE code = ?');
  const getParent = db.prepare('SELECT id FROM accounts WHERE code = ?');
  const insertAccount = db.prepare(`
    INSERT INTO accounts (code, name, type, parent_id, balance)
    VALUES (?, ?, ?, ?, 0)
  `);

  for (const acc of accountsToAdd) {
    const exists = checkAccount.get(acc.code);
    if (!exists) {
      const parent = getParent.get(acc.parent_code);
      const parentId = parent ? parent.id : null;
      insertAccount.run(acc.code, acc.name, acc.type, parentId);
      console.log(`✓ تم إدراج الحساب المالي النظامي: [${acc.code}] ${acc.name}`);
    }
  }

  // 4. مصفوفة بيانات الموظفين الـ 13 المستخرجة حرفياً ومطابقة 100% للجدول
  const sheetEmployees = [
    {
      seq: 1,
      employee_no: 'EMP-0001',
      full_name: 'علوي محمد باعبيد',
      job_title: 'المدير العام التنفيذي',
      department: 'الإدارة العليا',
      cost_center: 'الإدارة العامة CC-100',
      bank_account: '51654516351',
      basic_salary: 2796995,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 100000,
      health_insurance_allowance: 50000
    },
    {
      seq: 2,
      employee_no: 'EMP-0002',
      full_name: 'مهندس موقع أول (تنفيذي)',
      job_title: 'مهندس موقع تنفيذي أول',
      department: 'إدارة المشاريع',
      cost_center: 'مشروع الأبراج السكنية CC-201',
      bank_account: '1024501',
      basic_salary: 559464,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 3,
      employee_no: 'EMP-0003',
      full_name: 'مدير الشؤون المالية',
      job_title: 'المدير المالي ورئيس الحسابات',
      department: 'الشؤون المالية',
      cost_center: 'الإدارة العامة CC-100',
      bank_account: '1024502',
      basic_salary: 675180,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 4,
      employee_no: 'EMP-0004',
      full_name: 'كبير مهندسي التنفيذ',
      job_title: 'رئيس قسم التنفيذ الميداني',
      department: 'إدارة المشاريع',
      cost_center: 'مشروع جسر وسدود عدن CC-202',
      bank_account: '1024503',
      basic_salary: 814425,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 5,
      employee_no: 'EMP-0005',
      full_name: 'مهندس تصميم وإنشاءات مدنية',
      job_title: 'مهندس مدني تصاميم',
      department: 'المكتب الفني',
      cost_center: 'المكتب الفني CC-102',
      bank_account: '1024504',
      basic_salary: 529177,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 6,
      employee_no: 'EMP-0006',
      full_name: 'مشرف عام مواقع ومشاريع',
      job_title: 'مشرف تنفيذ مدني',
      department: 'إدارة المشاريع',
      cost_center: 'مشروع المجمع التجاري CC-203',
      bank_account: '1024505',
      basic_salary: 313013,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 7,
      employee_no: 'EMP-0007',
      full_name: 'مدير العمليات وإدارة المشاريع',
      job_title: 'مدير قطاع المقاولات والمشاريع',
      department: 'إدارة المشاريع',
      cost_center: 'الإدارة الفنية CC-101',
      bank_account: '1024506',
      basic_salary: 1037275,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 8,
      employee_no: 'EMP-0008',
      full_name: 'فني مساحة طوبوغرافية',
      job_title: 'مساح عام',
      department: 'المكتب الفني',
      cost_center: 'مشروع الأبراج السكنية CC-201',
      bank_account: '1024507',
      basic_salary: 201588,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 9,
      employee_no: 'EMP-0009',
      full_name: 'مهندس تخطيط وبرامج زمنية',
      job_title: 'مهندس عقود وبرمجة وتخطيط',
      department: 'المكتب الفني',
      cost_center: 'المكتب الفني CC-102',
      bank_account: '1024508',
      basic_salary: 591575,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 10,
      employee_no: 'EMP-0010',
      full_name: 'أمين المستودع المركزي للمواد',
      job_title: 'أمين مخازن',
      department: 'المستودعات واللوجستيات',
      cost_center: 'المستودع المركزي CC-301',
      bank_account: '1024509',
      basic_salary: 313013,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 11,
      employee_no: 'EMP-0011',
      full_name: 'مساعد إداري وسكرتارية مشاريع',
      job_title: 'منسق إداري',
      department: 'الشؤون الإدارية',
      cost_center: 'الإدارة العامة CC-100',
      bank_account: '1024510',
      basic_salary: 201588,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 12,
      employee_no: 'EMP-0012',
      full_name: 'مسؤول السلامة والصحة المهنية',
      job_title: 'ضابط أمن وسلامة HSE',
      department: 'السلامة والجودة',
      cost_center: 'إدارة المشاريع CC-101',
      bank_account: '1024511',
      basic_salary: 201588,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    },
    {
      seq: 13,
      employee_no: 'EMP-0013',
      full_name: 'محاسب مشاريع وتكاليف',
      job_title: 'محاسب تكاليف ومقاولات',
      department: 'الشؤون المالية',
      cost_center: 'الشؤون المالية CC-103',
      bank_account: '1024512',
      basic_salary: 480150,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    }
  ];

  // تحديث أو إدراج الموظفين الـ 13
  for (const emp of sheetEmployees) {
    const existing = db.prepare('SELECT id FROM employees WHERE employee_no = ?').get(emp.employee_no);
    if (existing) {
      db.prepare(`
        UPDATE employees SET
          full_name = ?, job_title = ?, department = ?, basic_salary = ?,
          transport_pct = ?, appearance_pct = ?, nature_of_work_pct = ?,
          living_allowance = ?, health_insurance_allowance = ?,
          cost_center = ?, bank_account = ?, status = 'active'
        WHERE id = ?
      `).run(
        emp.full_name, emp.job_title, emp.department, emp.basic_salary,
        emp.transport_pct, emp.appearance_pct, emp.nature_of_work_pct,
        emp.living_allowance, emp.health_insurance_allowance,
        emp.cost_center, emp.bank_account, existing.id
      );
      emp.id = existing.id;
    } else {
      const res = db.prepare(`
        INSERT INTO employees (
          employee_no, full_name, job_title, department, basic_salary,
          transport_pct, appearance_pct, nature_of_work_pct,
          living_allowance, health_insurance_allowance,
          cost_center, bank_account, status, currency
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'ر.ي')
      `).run(
        emp.employee_no, emp.full_name, emp.job_title, emp.department, emp.basic_salary,
        emp.transport_pct, emp.appearance_pct, emp.nature_of_work_pct,
        emp.living_allowance, emp.health_insurance_allowance,
        emp.cost_center, emp.bank_account
      );
      emp.id = res.lastInsertRowid;
    }
  }
  console.log(`✓ تم التحقق وتحديث وتأسيس بيانات الموظفين الـ 13 بنجاح`);

  // 5. بيانات كشف شهر أغسطس 2026م (2026-08) المطابقة للأرقام حرفياً
  const augustSheetRecords = [
    { seq: 1, basic: 2796995, earned: 2796995, transport: 559399, appearance: 699249, nature: 839099, living: 100000, health: 50000, gross: 5044743, ins_emp: 302685, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 4677059, tax: 699559, net: 4042500, ins_org: 454027, skills: 46771, unpaid_leave: 0, grand_net: 4042500 },
    { seq: 2, basic: 559464, earned: 559464, transport: 111893, appearance: 139866, nature: 167839, living: 90000, health: 30000, gross: 1099061, ins_emp: 65944, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 968118, tax: 143218, net: 889900, ins_org: 98916, skills: 9681, unpaid_leave: 0, grand_net: 889900 },
    { seq: 3, basic: 675180, earned: 675180, transport: 135036, appearance: 168795, nature: 202554, living: 90000, health: 30000, gross: 1301564, ins_emp: 78094, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 1158471, tax: 171771, net: 1051700, ins_org: 117141, skills: 11585, unpaid_leave: 0, grand_net: 1051700 },
    { seq: 4, basic: 814425, earned: 814425, transport: 162885, appearance: 203606, nature: 244328, living: 90000, health: 30000, gross: 1545244, ins_emp: 92715, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 1387529, tax: 206129, net: 1246400, ins_org: 139072, skills: 13875, unpaid_leave: 0, grand_net: 1246400 },
    { seq: 5, basic: 529177, earned: 529177, transport: 105835, appearance: 132294, nature: 158753, living: 90000, health: 30000, gross: 1046060, ins_emp: 51766, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 929294, tax: 137394, net: 856900, ins_org: 77649, skills: 9293, unpaid_leave: 0, grand_net: 856900 },
    { seq: 6, basic: 313013, earned: 313013, transport: 62603, appearance: 78253, nature: 93904, living: 90000, health: 30000, gross: 667773, ins_emp: 40066, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 562706, tax: 82406, net: 545300, ins_org: 60099, skills: 5627, unpaid_leave: 0, grand_net: 545300 },
    { seq: 7, basic: 1037275, earned: 1037275, transport: 207455, appearance: 259319, nature: 311183, living: 90000, health: 30000, gross: 1935231, ins_emp: 116114, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 1754117, tax: 261118, net: 1558000, ins_org: 174171, skills: 17541, unpaid_leave: 0, grand_net: 1558000 },
    { seq: 8, basic: 201588, earned: 201588, transport: 40318, appearance: 50397, nature: 60476, living: 90000, health: 30000, gross: 472779, ins_emp: 28367, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 379412, tax: 54912, net: 389500, ins_org: 42550, skills: 3794, unpaid_leave: 0, grand_net: 389500 },
    { seq: 9, basic: 591575, earned: 591575, transport: 118315, appearance: 147894, nature: 177473, living: 90000, health: 30000, gross: 1155256, ins_emp: 69315, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 1020941, tax: 151141, net: 934800, ins_org: 103973, skills: 10209, unpaid_leave: 0, grand_net: 934800 },
    { seq: 10, basic: 313013, earned: 313013, transport: 62603, appearance: 78253, nature: 93904, living: 90000, health: 30000, gross: 667773, ins_emp: 40066, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 562706, tax: 82406, net: 545300, ins_org: 60100, skills: 5627, unpaid_leave: 0, grand_net: 545300 },
    { seq: 11, basic: 201588, earned: 201588, transport: 40318, appearance: 50397, nature: 60476, living: 90000, health: 30000, gross: 472779, ins_emp: 28367, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 379412, tax: 54912, net: 389500, ins_org: 42550, skills: 3794, unpaid_leave: 0, grand_net: 389500 },
    { seq: 12, basic: 201588, earned: 201588, transport: 40318, appearance: 50397, nature: 60476, living: 90000, health: 30000, gross: 472779, ins_emp: 28367, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 379412, tax: 54912, net: 389500, ins_org: 42550, skills: 3794, unpaid_leave: 0, grand_net: 389500 },
    { seq: 13, basic: 480150, earned: 480150, transport: 96030, appearance: 120038, nature: 144045, living: 90000, health: 30000, gross: 960263, ins_emp: 57616, ded_absence: 0, ded_loan: 0, ded_total: 0, tax_base: 857647, tax: 125647, net: 779000, ins_org: 86424, skills: 8576, unpaid_leave: 0, grand_net: 779000 }
  ];

  const payrollMonth = '2026-08';
  // حذف أي مسيرات قديمة للشهر 2026-08 لإعادة التأسيس النظيف
  db.prepare('DELETE FROM payroll WHERE payroll_month = ?').run(payrollMonth);

  for (let i = 0; i < sheetEmployees.length; i++) {
    const emp = sheetEmployees[i];
    const rec = augustSheetRecords[i];

    db.prepare(`
      INSERT INTO payroll (
        employee_id, payroll_month, basic_salary, earned_basic,
        transport_allowance, appearance_allowance, nature_of_work_allowance,
        living_allowance, health_insurance_allowance, allowances,
        gross_salary, insurance_employee, insurance_employer,
        absence_penalty_deductions, loan_installments, deductions,
        taxable_base, tax_amount, net_salary, skills_fund,
        unpaid_leave_deduction, total_net_salary, working_days, month_days,
        cost_center, bank_account, status
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, 'draft'
      )
    `).run(
      emp.id, payrollMonth, rec.basic, rec.earned,
      rec.transport, rec.appearance, rec.nature,
      rec.living, rec.health, (rec.transport + rec.appearance + rec.nature + rec.living + rec.health),
      rec.gross, rec.ins_emp, rec.ins_org,
      rec.ded_absence, rec.ded_loan, rec.ded_total,
      rec.tax_base, rec.tax, rec.net, rec.skills,
      rec.unpaid_leave, rec.grand_net, 31, 31,
      emp.cost_center, emp.bank_account
    );
  }

  console.log(`✅ تم إدراج كشف الراتب الشامل لشهر ${payrollMonth} بعدد 13 سجلاً متطابقاً تماماً مع الجدول!`);

} catch (err) {
  console.error('❌ خطأ أثناء تطبيق الهجرة:', err);
  process.exit(1);
}

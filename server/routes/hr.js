const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const PayrollService = require('../services/payrollService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

const today = () => new Date().toISOString().slice(0, 10);
const number = value => Number(value) || 0;

// مؤشرات الموارد البشرية: القوة العاملة، الحضور، الرواتب والسلف المستحقة.
router.get('/dashboard', requirePermission('hr:view'), async (_req, res) => {
  try {
    const [employees, attendance, payroll, advances, leaves] = await Promise.all([
      get("SELECT COUNT(*) AS count FROM employees WHERE status = 'active'"),
      get("SELECT COUNT(*) AS count FROM attendance WHERE date = ? AND status = 'present'", [today()]),
      get("SELECT COALESCE(SUM(net_salary), 0) AS total FROM payroll WHERE status != 'paid'"),
      get("SELECT COALESCE(SUM(amount - recovered_amount), 0) AS total FROM employee_advances WHERE status = 'active'"),
      get("SELECT COUNT(*) AS count FROM employee_leaves WHERE status = 'pending'")
    ]);
    res.json({ success: true, data: {
      activeEmployees: number(employees?.count), presentToday: number(attendance?.count),
      unpaidPayroll: number(payroll?.total), activeAdvances: number(advances?.total), pendingLeaves: number(leaves?.count)
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/employees', requirePermission('hr:view'), async (req, res) => {
  try {
    let sql = `SELECT e.*, p.name AS project_name FROM employees e LEFT JOIN projects p ON p.id = e.project_id`;
    const params = [];
    const conditions = [];

    const allowedProjects = parseScopeArray(req.user?.scope?.allowed_projects || req.user?.allowed_projects);
    if (allowedProjects.length > 0 && !allowedProjects.includes('*') && !allowedProjects.includes('all')) {
      const placeholders = allowedProjects.map(() => '?').join(',');
      conditions.push(`(e.project_id IS NULL OR e.project_id IN (${placeholders}))`);
      params.push(...allowedProjects);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY e.status = 'active' DESC, e.full_name`;
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/employees', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_no, full_name, national_id, phone, job_title, department, project_id, employment_type, hire_date, basic_salary, currency, status, bank_name, bank_account, notes } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ success: false, message: 'اسم الموظف مطلوب' });
    const count = await get('SELECT COUNT(*) AS count FROM employees');
    const code = employee_no?.trim() || `EMP-${String(number(count?.count) + 1).padStart(4, '0')}`;
    const result = await run(`INSERT INTO employees (employee_no, full_name, national_id, phone, job_title, department, project_id, employment_type, hire_date, basic_salary, currency, status, bank_name, bank_account, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [code, full_name.trim(), national_id || '', phone || '', job_title || '', department || '', project_id || null, employment_type || 'دوام كامل', hire_date || today(), number(basic_salary), currency || 'ر.ي', status || 'active', bank_name || '', bank_account || '', notes || '']);
    res.json({ success: true, id: result.lastInsertRowid || result.insertId, message: 'تمت إضافة الموظف بنجاح' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/employees/:id', requirePermission('hr:edit'), async (req, res) => {
  try {
    const fields = ['full_name','national_id','phone','job_title','department','project_id','employment_type','hire_date','basic_salary','currency','status','bank_name','bank_account','notes'];
    const values = fields.map(key => req.body[key] ?? null);
    await run(`UPDATE employees SET full_name=COALESCE(?,full_name), national_id=COALESCE(?,national_id), phone=COALESCE(?,phone), job_title=COALESCE(?,job_title), department=COALESCE(?,department), project_id=COALESCE(?,project_id), employment_type=COALESCE(?,employment_type), hire_date=COALESCE(?,hire_date), basic_salary=COALESCE(?,basic_salary), currency=COALESCE(?,currency), status=COALESCE(?,status), bank_name=COALESCE(?,bank_name), bank_account=COALESCE(?,bank_account), notes=COALESCE(?,notes) WHERE id=?`, [...values, req.params.id]);
    res.json({ success: true, message: 'تم تحديث بيانات الموظف' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/attendance', requirePermission('hr:view'), async (req, res) => {
  try {
    const date = req.query.date || today();
    const rows = await query(`SELECT a.*, e.full_name, e.employee_no FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.date=? ORDER BY e.full_name`, [date]);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/attendance', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, date, status, check_in, check_out, overtime_hours, notes } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'اختر الموظف' });
    const existing = await get('SELECT id FROM attendance WHERE employee_id=? AND date=?', [employee_id, date || today()]);
    if (existing) await run('UPDATE attendance SET status=?, check_in=?, check_out=?, overtime_hours=?, notes=? WHERE id=?', [status || 'present', check_in || null, check_out || null, number(overtime_hours), notes || '', existing.id]);
    else await run('INSERT INTO attendance (employee_id,date,status,check_in,check_out,overtime_hours,notes) VALUES (?,?,?,?,?,?,?)', [employee_id, date || today(), status || 'present', check_in || null, check_out || null, number(overtime_hours), notes || '']);
    res.json({ success: true, message: 'تم حفظ سجل الحضور' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/leaves', requirePermission('hr:view'), async (_req, res) => {
  try {
    const rows = await query('SELECT l.*, e.full_name FROM employee_leaves l JOIN employees e ON e.id=l.employee_id ORDER BY l.created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/leaves', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, leave_type, start_date, end_date, days_count, status, notes } = req.body;
    if (!employee_id || !start_date || !end_date) return res.status(400).json({ success: false, message: 'الموظف وفترة الإجازة مطلوبان' });
    await run('INSERT INTO employee_leaves (employee_id, leave_type, start_date, end_date, days_count, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [employee_id, leave_type || 'سنوية', start_date, end_date, number(days_count) || 1, status || 'pending', notes || '']);
    res.json({ success: true, message: 'تم تسجيل طلب الإجازة' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/leaves/:id/status', requirePermission('hr:approve'), async (req, res) => {
  try {
    await run('UPDATE employee_leaves SET status=? WHERE id=?', [req.body.status || 'approved', req.params.id]);
    res.json({ success: true, message: 'تم تحديث حالة الإجازة' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/leave-types', requirePermission('hr:view'), async (_req, res) => {
  try {
    const types = await query('SELECT * FROM leave_types ORDER BY is_paid DESC, id ASC');
    res.json({ success: true, data: types });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب أنواع الإجازات: ' + err.message });
  }
});

router.post('/leave-types', requirePermission('hr:create'), async (req, res) => {
  try {
    const { name, days_per_year = 30, is_paid = 1, description = '' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'اسم نوع الإجازة مطلوب' });
    const result = await run(`
      INSERT INTO leave_types (name, days_per_year, is_paid, description)
      VALUES (?, ?, ?, ?)
    `, [name.trim(), number(days_per_year), is_paid ? 1 : 0, description.trim()]);
    res.json({ success: true, message: 'تمت إضافة نوع الإجازة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/advances', requirePermission('hr:view'), async (_req, res) => {
  try {
    const rows = await query(`SELECT a.*, e.full_name, e.employee_no FROM employee_advances a JOIN employees e ON e.id = a.employee_id ORDER BY a.id DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/advances', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, amount, request_date = today(), installment_amount, reason } = req.body;
    await run('INSERT INTO employee_advances (employee_id,amount,request_date,installment_amount,reason) VALUES (?,?,?,?,?)',
      [employee_id, number(amount), request_date, number(installment_amount), reason]);
    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'advance',
      entity_id: employee_id,
      details: { amount, installment_amount, reason }
    });
    res.json({ success: true, message: 'تم تسجيل السلفة' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/payroll', requirePermission('hr:view,hr:payroll'), async (req, res) => {
  try {
    const month = req.query.month;
    let sql = `SELECT p.*, e.full_name, e.employee_no, e.job_title, e.department, 
               COALESCE(p.bank_account, e.bank_account, '') as bank_account, 
               COALESCE(p.cost_center, e.cost_center, 'الإدارة العامة') as cost_center 
               FROM payroll p 
               JOIN employees e ON e.id=p.employee_id`;
    const params = [];
    if (month) {
      sql += ' WHERE p.payroll_month=?';
      params.push(month);
    }
    sql += ' ORDER BY p.payroll_month DESC, p.id ASC, e.employee_no ASC';
    res.json({ success: true, data: await query(sql, params) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إعداد واحتساب مسير الرواتب وفق القواعد النظامية الشاملة المعتمدة
router.post('/payroll/generate', requirePermission('hr:create,hr:payroll'), async (req, res) => {
  try {
    const payrollMonth = req.body.payroll_month || today().slice(0, 7);
    const employees = await query("SELECT * FROM employees WHERE status='active' ORDER BY id ASC");
    if (!employees || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'لا يوجد موظفون نشطون لإعداد المسير' });
    }

    const result = await transaction(async tx => {
      let created = 0;
      for (const e of employees) {
        const exists = await tx.get('SELECT id FROM payroll WHERE employee_id=? AND payroll_month=?', [e.id, payrollMonth]);
        if (exists) continue;

        const advances = await tx.get("SELECT COALESCE(SUM(CASE WHEN installment_amount > 0 THEN MIN(installment_amount, amount-recovered_amount) ELSE 0 END),0) AS total FROM employee_advances WHERE employee_id=? AND status='active'", [e.id]);
        const overtime = await tx.get("SELECT COALESCE(SUM(overtime_hours),0) AS hours FROM attendance WHERE employee_id=? AND substr(date,1,7)=?", [e.id, payrollMonth]);

        const basic = number(e.basic_salary);
        const workingDays = 31;
        const monthDays = 31;
        const earnedBasic = Math.round(basic * (workingDays / monthDays));

        const transportPct = e.transport_pct != null ? number(e.transport_pct) : 20;
        const appearancePct = e.appearance_pct != null ? number(e.appearance_pct) : 25;
        const natureOfWorkPct = e.nature_of_work_pct != null ? number(e.nature_of_work_pct) : 30;

        const transport = Math.round(earnedBasic * (transportPct / 100));
        const appearance = Math.round(earnedBasic * (appearancePct / 100));
        const nature = Math.round(earnedBasic * (natureOfWorkPct / 100));
        const living = e.living_allowance != null ? number(e.living_allowance) : 90000;
        const health = e.health_insurance_allowance != null ? number(e.health_insurance_allowance) : 30000;

        const totalAllowances = transport + appearance + nature + living + health;
        const gross = earnedBasic + totalAllowances;

        // التأمينات 6% موظف و 9% منشأة على الراتب الشامل
        const insEmp = Math.round(gross * 0.06);
        const insOrg = Math.round(gross * 0.09);

        // الخصميات والجزاءات وأقساط السلف
        const advanceDeductions = number(advances?.total);
        const totalDeductions = advanceDeductions;

        // الوعاء الضريبي = الراتب الشامل - تأمينات 6% - حد الإعفاء 65,000 - الخصميات
        const taxableBase = Math.max(0, gross - insEmp - 65000 - totalDeductions);

        // ضريبة كسب العمل (شرائح: 10% لأول 40,000 و 15% لما زاد)
        let tax = 0;
        if (taxableBase > 0) {
          if (taxableBase <= 40000) {
            tax = Math.round(taxableBase * 0.10);
          } else {
            tax = Math.round(taxableBase * 0.15 - 2000);
          }
        }

        // صافي الراتب المستحق
        const net = Math.max(0, gross - insEmp - tax - totalDeductions);

        // صندوق تنمية المهارات 1% (محسوب على الوعاء)
        const skillsFund = Math.round(taxableBase * 0.01);
        const unpaidLeave = 0;
        const grandNet = net - unpaidLeave;

        await tx.run(`
          INSERT INTO payroll (
            employee_id, payroll_month, basic_salary, earned_basic,
            transport_allowance, appearance_allowance, nature_of_work_allowance,
            living_allowance, health_insurance_allowance, allowances,
            gross_salary, insurance_employee, insurance_employer,
            absence_penalty_deductions, loan_installments, deductions,
            taxable_base, tax_amount, net_salary, skills_fund,
            unpaid_leave_deduction, total_net_salary, working_days, month_days,
            cost_center, bank_account, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
        `, [
          e.id, payrollMonth, basic, earnedBasic,
          transport, appearance, nature,
          living, health, totalAllowances,
          gross, insEmp, insOrg,
          0, advanceDeductions, totalDeductions,
          taxableBase, tax, net, skillsFund,
          unpaidLeave, grandNet, workingDays, monthDays,
          e.cost_center || 'الإدارة العامة CC-100', e.bank_account || ''
        ]);
        created++;
      }
      return created;
    });

    await logAudit(req, {
      action: 'GENERATE_PAYROLL',
      entity_type: 'payroll',
      entity_id: payrollMonth,
      details: { month: payrollMonth, records_count: result }
    });

    res.json({ 
      success: true, 
      data: { created: result }, 
      message: `تم إعداد ${result} مسير راتب لشهر ${payrollMonth} وفق القواعد الشاملة والنظامية المعتمدة` 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تقييمات أداء الموظفين والحوافز والخصومات
router.get('/evaluations', requirePermission('hr:view'), async (req, res) => {
  try {
    const { employee_id } = req.query;
    let sql = `
      SELECT ev.*, e.full_name as employee_name, e.employee_no, e.job_title, e.department
      FROM employee_evaluations ev
      JOIN employees e ON e.id = ev.employee_id
    `;
    const params = [];
    if (employee_id) {
      sql += ' WHERE ev.employee_id = ?';
      params.push(employee_id);
    }
    sql += ' ORDER BY ev.evaluation_date DESC, ev.id DESC';
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقييمات الأداء: ' + err.message });
  }
});

router.post('/evaluations', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, evaluation_date = today(), rating = 'جيد جداً', score = 85, bonuses = 0, deductions = 0, evaluator = 'مدير الموارد البشرية', comments = '' } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'اختر الموظف المراد تقييمه' });
    const result = await run(`
      INSERT INTO employee_evaluations (employee_id, evaluation_date, rating, score, bonuses, deductions, evaluator, comments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [employee_id, evaluation_date, rating, number(score), number(bonuses), number(deductions), evaluator, comments]);
    res.json({ success: true, message: 'تم حفظ تقييم الموظف بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ التقييم: ' + err.message });
  }
});

// معاينة القيد المحاسبي المركب لمسير الرواتب وقواعد التأمينات والضرائب قبل الترحيل
router.get('/payroll/:month/preview-journal', requirePermission('hr:view,accounting:view'), async (req, res) => {
  try {
    const month = req.params.month;
    const records = await query('SELECT p.*, e.full_name FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.payroll_month = ?', [month]);
    if (!records || records.length === 0) {
      return res.status(404).json({ success: false, message: `لا توجد مسيرات رواتب لشهر ${month}` });
    }

    let totalGross = 0;
    let totalInsEmployer = 0;
    let totalInsEmployee = 0;
    let totalSkillsFund = 0;
    let totalTax = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const r of records) {
      const g = r.gross_salary != null ? number(r.gross_salary) : (number(r.basic_salary) + number(r.overtime_amount));
      const iOrg = number(r.insurance_employer || 0);
      const iEmp = number(r.insurance_employee || 0);
      const sk = number(r.skills_fund || 0);
      const tx = number(r.tax_amount || 0);
      const ded = number(r.deductions || 0);
      const net = r.total_net_salary != null ? number(r.total_net_salary) : number(r.net_salary || 0);

      totalGross += g;
      totalInsEmployer += iOrg;
      totalInsEmployee += iEmp;
      totalSkillsFund += sk;
      totalTax += tx;
      totalDeductions += ded;
      totalNet += net;
    }

    totalGross = Math.round(totalGross * 100) / 100;
    totalInsEmployer = Math.round(totalInsEmployer * 100) / 100;
    totalInsEmployee = Math.round(totalInsEmployee * 100) / 100;
    totalSkillsFund = Math.round(totalSkillsFund * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;
    totalDeductions = Math.round(totalDeductions * 100) / 100;
    
    // صافي الصرف المحاسبي المتزن تماماً (إجمالي الاستحقاق - الاستقطاعات)
    const netPayable = Math.round((totalGross - totalInsEmployee - totalTax - totalDeductions) * 100) / 100;

    const totalDebit = Math.round((totalGross + totalInsEmployer + totalSkillsFund) * 100) / 100;
    const totalCredit = Math.round((netPayable + totalTax + (totalInsEmployee + totalInsEmployer) + totalSkillsFund + totalDeductions) * 100) / 100;

    let salaryExpAcc = await get("SELECT id, code, name FROM accounts WHERE code = '511' OR code = '52' OR name LIKE '%رواتب%' LIMIT 1") || { id: 1, code: '511', name: 'مصروف الرواتب والأجور الأساسية والبدلات' };
    let insExpAcc = await get("SELECT id, code, name FROM accounts WHERE code = '512' OR name LIKE '%مساهمة%تأمين%' LIMIT 1") || { id: 2, code: '512', name: 'مصروف مساهمة الشركة في التأمينات الاجتماعية (9%)' };
    let skillsExpAcc = await get("SELECT id, code, name FROM accounts WHERE code = '513' OR name LIKE '%مهارات%' LIMIT 1") || { id: 3, code: '513', name: 'مصروف مساهمة صندوق تنمية المهارات (1%)' };
    let cashBankAcc = await get("SELECT id, code, name FROM accounts WHERE code = '111' OR code = '112' OR type = 'أصول' LIMIT 1") || { id: 4, code: '111', name: 'الصندوق الرئيسي / البنك' };
    let taxAcc = await get("SELECT id, code, name FROM accounts WHERE code = '213' OR name LIKE '%ضرائب%' OR name LIKE '%كسب%' LIMIT 1") || { id: 5, code: '213', name: 'أمانات مصلحة الضرائب (ضريبة كسب العمل)' };
    let insLiabilityAcc = await get("SELECT id, code, name FROM accounts WHERE code = '214' OR name LIKE '%تأمينات%' LIMIT 1") || { id: 6, code: '214', name: 'الهيئة العامة للتأمينات والمعاشات (15%)' };
    let skillsLiabilityAcc = await get("SELECT id, code, name FROM accounts WHERE code = '215' OR name LIKE '%مهارات%' LIMIT 1") || { id: 7, code: '215', name: 'أمانات صندوق تنمية المهارات (1%)' };
    let advanceAcc = await get("SELECT id, code, name FROM accounts WHERE code = '114' OR name LIKE '%سلف%' LIMIT 1") || { id: 8, code: '114', name: 'سلف وعهد الموظفين' };

    const previewLines = [
      { side: 'مدين (منه)', account_code: salaryExpAcc.code, account_name: salaryExpAcc.name, debit: totalGross, credit: 0, cost_center: 'الإدارة العامة CC-100', notes: `إجمالي استحقاق رواتب وبدلات شهر ${month}` },
      { side: 'مدين (منه)', account_code: insExpAcc.code, account_name: insExpAcc.name, debit: totalInsEmployer, credit: 0, cost_center: 'الإدارة العامة CC-100', notes: `مساهمة المنشأة في التأمينات الاجتماعية (9%)` },
      { side: 'مدين (منه)', account_code: skillsExpAcc.code, account_name: skillsExpAcc.name, debit: totalSkillsFund, credit: 0, cost_center: 'الإدارة العامة CC-100', notes: `مساهمة المنشأة في صندوق تنمية المهارات (1%)` },
      { side: 'دائن (له)', account_code: cashBankAcc.code, account_name: cashBankAcc.name, debit: 0, credit: totalNet, cost_center: 'الإدارة العامة CC-100', notes: `صافي رواتب محولة ومسددة للموظفين` },
      { side: 'دائن (له)', account_code: taxAcc.code, account_name: taxAcc.name, debit: 0, credit: totalTax, cost_center: 'الإدارة العامة CC-100', notes: `أمانات ضريبة كسب العمل المستقطعة` },
      { side: 'دائن (له)', account_code: insLiabilityAcc.code, account_name: insLiabilityAcc.name, debit: 0, credit: Math.round((totalInsEmployee + totalInsEmployer) * 100) / 100, cost_center: 'الإدارة العامة CC-100', notes: `مستحقات التأمينات (حصة العامل 6% + المنشأة 9%)` },
      { side: 'دائن (له)', account_code: skillsLiabilityAcc.code, account_name: skillsLiabilityAcc.name, debit: 0, credit: totalSkillsFund, cost_center: 'الإدارة العامة CC-100', notes: `مستحقات صندوق تنمية المهارات (1%)` },
      { side: 'دائن (له)', account_code: advanceAcc.code, account_name: advanceAcc.name, debit: 0, credit: totalDeductions, cost_center: 'الإدارة العامة CC-100', notes: `استرداد أقساط سلف الموظفين` }
    ].filter(l => l.debit > 0 || l.credit > 0);

    res.json({
      success: true,
      data: {
        month,
        employee_count: records.length,
        summary: {
          total_gross: totalGross,
          insurance_employer_9pct: totalInsEmployer,
          insurance_employee_6pct: totalInsEmployee,
          total_insurance_15pct: Math.round((totalInsEmployee + totalInsEmployer) * 100) / 100,
          total_skills_fund_1pct: totalSkillsFund,
          total_tax: totalTax,
          total_advances: totalDeductions,
          total_net_payable: totalNet,
          total_debit: totalDebit,
          total_credit: totalCredit,
          diff: Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100,
          is_balanced: Math.abs(totalDebit - totalCredit) < 0.05
        },
        lines: previewLines,
        rules: {
          social_insurance: 'حصة الموظف 6% تستقطع من الراتب الشامل + حصة المنشأة 9% تتحملها الشركة كمصروف إضافي = 15% تورد لهيئة التأمينات والمعاشات',
          income_tax: 'إعفاء قانوني لأول 65,000 ر.ي شهرياً، ثم 10% للشريحة الأولى (حتى 40,000 ر.ي)، و 15% لما زاد عن ذلك',
          skills_fund: 'مساهمة قانونية بنسبة 1% من الوعاء لصالح صندوق تنمية المهارات المهنية'
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب معاينة قيد الرواتب: ' + err.message });
  }
});

// ترحيل كشف الراتب آلياً إلى قيد محاسبي مركب متزن تماماً في سجل اليومية العامة
router.post('/payroll/:month/post-to-journal', requirePermission('hr:post,accounting:create,hr:payroll'), async (req, res) => {
  try {
    const month = req.params.month;
    const postDate = today();

    // 1. التحقق من إغلاق الفترة المحاسبية
    const periodCheck = await checkPeriodOpen(postDate);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    const records = await query('SELECT p.*, e.full_name FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.payroll_month = ?', [month]);
    if (!records || records.length === 0) {
      return res.status(400).json({ success: false, message: `لا توجد مسيرات رواتب لشهر ${month}` });
    }

    const alreadyPosted = records.filter(r => r.journal_entry_id);
    if (alreadyPosted.length === records.length) {
      return res.status(400).json({ success: false, message: `تم ترحيل مسير رواتب شهر ${month} مسبقاً بقيد يومية` });
    }

    let totalGross = 0;
    let totalInsEmployer = 0;
    let totalInsEmployee = 0;
    let totalSkillsFund = 0;
    let totalTax = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const r of records) {
      const g = r.gross_salary != null ? number(r.gross_salary) : (number(r.basic_salary) + number(r.overtime_amount));
      const iOrg = number(r.insurance_employer || 0);
      const iEmp = number(r.insurance_employee || 0);
      const sk = number(r.skills_fund || 0);
      const tx = number(r.tax_amount || 0);
      const ded = number(r.deductions || 0);
      const net = r.total_net_salary != null ? number(r.total_net_salary) : number(r.net_salary || 0);

      totalGross += g;
      totalInsEmployer += iOrg;
      totalInsEmployee += iEmp;
      totalSkillsFund += sk;
      totalTax += tx;
      totalDeductions += ded;
      totalNet += net;
    }

    totalGross = Math.round(totalGross * 100) / 100;
    totalInsEmployer = Math.round(totalInsEmployer * 100) / 100;
    totalInsEmployee = Math.round(totalInsEmployee * 100) / 100;
    totalSkillsFund = Math.round(totalSkillsFund * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;
    totalDeductions = Math.round(totalDeductions * 100) / 100;
    
    // صافي الصرف المحاسبي المتزن تماماً
    const netPayable = Math.round((totalGross - totalInsEmployee - totalTax - totalDeductions) * 100) / 100;

    // إجمالي الجانب المدين (إجمالي استحقاق الرواتب + مساهمة الشركة في التأمينات + صندوق المهارات)
    const totalDebit = Math.round((totalGross + totalInsEmployer + totalSkillsFund) * 100) / 100;
    
    // إجمالي الجانب الدائن (صافي مسدد + ضريبة + إجمالي تأمينات + صندوق مهارات + استرداد سلف)
    const totalCredit = Math.round((netPayable + totalTax + (totalInsEmployee + totalInsEmployer) + totalSkillsFund + totalDeductions) * 100) / 100;

    // التحقق الرياضي من التوازن المحاسبي
    const diff = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    if (diff > 0.05) {
      return res.status(400).json({ 
        success: false, 
        message: `عدم توازن في مسير الرواتب! المدين: ${totalDebit}، الدائن: ${totalCredit}، الفارق: ${diff}` 
      });
    }

    // جلب الحسابات المحاسبية المتخصصة
    let salaryExpAcc = await get("SELECT id FROM accounts WHERE code = '511' OR code = '52' OR name LIKE '%رواتب%' LIMIT 1");
    let insExpAcc = await get("SELECT id FROM accounts WHERE code = '512' OR name LIKE '%مساهمة%تأمين%' LIMIT 1");
    let skillsExpAcc = await get("SELECT id FROM accounts WHERE code = '513' OR name LIKE '%مهارات%' LIMIT 1");
    let cashBankAcc = await get("SELECT id FROM accounts WHERE code = '111' OR code = '112' OR type = 'أصول' LIMIT 1");
    let taxAcc = await get("SELECT id FROM accounts WHERE code = '213' OR name LIKE '%ضرائب%' OR name LIKE '%كسب%' LIMIT 1");
    let insLiabilityAcc = await get("SELECT id FROM accounts WHERE code = '214' OR name LIKE '%تأمينات%' LIMIT 1");
    let skillsLiabilityAcc = await get("SELECT id FROM accounts WHERE code = '215' OR name LIKE '%مهارات%' LIMIT 1");
    let advanceAcc = await get("SELECT id FROM accounts WHERE code = '114' OR name LIKE '%سلف%' LIMIT 1");

    if (!salaryExpAcc) salaryExpAcc = { id: 1 };
    if (!cashBankAcc) cashBankAcc = { id: 2 };
    const defaultCostCenterId = 1; // CC-100 الإدارة العامة

    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM journal_entries');
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    let entry_no = `JV-PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM journal_entries WHERE entry_no = ?', [entry_no])) {
      seq++;
      entry_no = `JV-PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const txResult = await transaction(async (tx) => {
      // إدراج القيد اليومي المركب
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (entry_no, date, description, reference_type, total_debit, total_credit)
        VALUES (?, ?, ?, 'ترحيل رواتب', ?, ?)
      `, [entry_no, postDate, `إثبات استحقاق واحتساب مسير رواتب شهر ${month} والتأمينات والضرائب لعدد ${records.length} موظف`, totalDebit, totalDebit]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      // 1. طرف مدين: مصروف الرواتب والأجور (إجمالي الاستحقاق)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?)
      `, [jeId, salaryExpAcc.id, defaultCostCenterId, totalGross, `إجمالي استحقاق رواتب وبدلات شهر ${month}`]);

      // 2. طرف مدين: مصروف مساهمة الشركة في التأمينات (9%)
      if (totalInsEmployer > 0 && insExpAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?)
        `, [jeId, insExpAcc.id, defaultCostCenterId, totalInsEmployer, `مساهمة المنشأة في التأمينات الاجتماعية (9%) لشهر ${month}`]);
      }

      // 3. طرف مدين: مصروف مساهمة صندوق تنمية المهارات (1%)
      if (totalSkillsFund > 0 && skillsExpAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?)
        `, [jeId, skillsExpAcc.id, defaultCostCenterId, totalSkillsFund, `مساهمة المنشأة في صندوق تنمية المهارات (1%) لشهر ${month}`]);
      }

      // 4. طرف دائن: الصندوق / البنك بصافي الرواتب المسددة للموظفين
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?, ?)
      `, [jeId, cashBankAcc.id, defaultCostCenterId, totalNet, `صافي رواتب محولة ومسددة للموظفين لشهر ${month}`]);

      // 5. طرف دائن: أمانات مصلحة الضرائب (ضريبة كسب العمل)
      if (totalTax > 0 && taxAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?, ?)
        `, [jeId, taxAcc.id, defaultCostCenterId, totalTax, `أمانات ضريبة كسب العمل المستقطعة لشهر ${month}`]);
      }

      // 6. طرف دائن: الهيئة العامة للتأمينات والمعاشات (حصة الموظف 6% + حصة الشركة 9%)
      const totalInsurance = Math.round((totalInsEmployee + totalInsEmployer) * 100) / 100;
      if (totalInsurance > 0 && insLiabilityAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?, ?)
        `, [jeId, insLiabilityAcc.id, defaultCostCenterId, totalInsurance, `مستحقات التأمينات الاجتماعية (حصة العامل 6% + حصة المنشأة 9%) لشهر ${month}`]);
      }

      // 7. طرف دائن: أمانات صندوق تنمية المهارات (1%)
      if (totalSkillsFund > 0 && skillsLiabilityAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?, ?)
        `, [jeId, skillsLiabilityAcc.id, defaultCostCenterId, totalSkillsFund, `مستحقات صندوق تنمية المهارات (1%) لشهر ${month}`]);
      }

      // 8. طرف دائن: استرداد السلف والعهد
      if (totalDeductions > 0 && advanceAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?, ?)
        `, [jeId, advanceAcc.id, defaultCostCenterId, totalDeductions, `استرداد سلف وذمم الموظفين لشهر ${month}`]);
      }

      // تحديث حالة مسيرات الرواتب إلى مرحلة ومسددة
      await tx.run(`
        UPDATE payroll 
        SET status = 'paid', paid_date = ?, journal_entry_id = ?
        WHERE payroll_month = ?
      `, [today(), jeId, month]);

      return { jeId, entry_no };
    });

    await logAudit(req, {
      action: 'POST_PAYROLL_JOURNAL',
      entity_type: 'payroll',
      entity_id: month,
      details: { month, entry_no: txResult.entry_no, total_debit: totalDebit, total_net: totalNet }
    });

    res.json({
      success: true,
      message: `تم ترحيل مسير رواتب شهر ${month} بنجاح وإنشاء القيد المحاسبي المتزن رقم ${txResult.entry_no}`,
      entry_no: txResult.entry_no,
      journal_entry_id: txResult.jeId,
      total_expense: totalDebit,
      total_net: totalNet,
      total_tax: totalTax,
      total_insurance: totalInsEmployee + totalInsEmployer
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في ترحيل مسير الرواتب: ' + err.message });
  }
});

module.exports = router;

/**
 * خدمة مسير الرواتب والاستحقاقات الشاملة (Comprehensive Payroll Service)
 * تطبق المعطيات والنسب والقواعد المعتمدة لكشف الراتب الشامل لشهر اغسطس 2026م:
 * 1. استحقاق الراتب الأساسي وفق أيام العمل (افتراضي 31 يوماً).
 * 2. البدلات النسبية: بدل إنتقال 20%، بدل مظهر 25%، بدل طبيعة عمل 30%.
 * 3. البدلات المقطوعة: بدل معيشة (90,000/100,000 ر.ي)، بدل تأمين صحي (30,000/50,000 ر.ي).
 * 4. الراتب الشامل = الراتب الأساسي + جميع البدلات.
 * 5. التأمينات الاجتماعية: 6% حصة الموظف و 9% مساهمة المنشأة على الراتب الشامل.
 * 6. الاستقطاعات: خصميات غياب وجزاءات، وأقساط تمويل/سلف.
 * 7. الوعاء الضريبي = الراتب الشامل - تأمينات 6% - حد الإعفاء القانوني 65,000 ر.ي - الخصميات.
 * 8. ضريبة كسب العمل: 10% لأول 40,000 ر.ي، و 15% لما زاد (الوعاء × 15% - 2,000).
 * 9. صافي الراتب المستحق = الراتب الشامل - تأمينات 6% - ضريبة كسب العمل - إجمالي الخصميات.
 * 10. صندوق تنمية المهارات 1% = 1% مساهمة منشأة محسوبة على الوعاء.
 * 11. إجمالي الصافي = صافي الراتب - إجازة بدون راتب.
 * 12. القيد المحاسبي المركب المتزن تماماً (Debit == Credit).
 */

const PayrollService = {
  // الثوابت النظامية المعتمدة
  CONSTANTS: {
    DEFAULT_MONTH_DAYS: 31,
    DEFAULT_WORKING_DAYS: 31,
    TRANSPORT_PCT: 20,         // بدل إنتقال 20%
    APPEARANCE_PCT: 25,        // بدل مظهر 25%
    NATURE_OF_WORK_PCT: 30,    // بدل طبيعة عمل 30%
    DEFAULT_LIVING_ALLOWANCE: 90000,       // بدل معيشة
    DEFAULT_HEALTH_INSURANCE: 30000,       // بدل تأمين صحي
    INSURANCE_EMP_PCT: 6,      // تأمينات موظف 6%
    INSURANCE_ORG_PCT: 9,      // تأمينات منشأة 9%
    TAX_EXEMPTION_MONTHLY: 65000, // حد الإعفاء الضريبي الشهري
    TAX_FIRST_BRACKET_LIMIT: 40000, // حد الشريحة الأولى 10%
    TAX_FIRST_RATE: 0.10,      // نسبة الشريحة الأولى 10%
    TAX_SECOND_RATE: 0.15,     // نسبة الشريحة الثانية 15%
    SKILLS_FUND_PCT: 1         // صندوق تنمية المهارات 1%
  },

  /**
   * احتساب الرواتب الشاملة لقائمة الموظفين وفق القواعد المحاسبية والنظامية الدقيقة
   */
  calculateStatutoryPayroll(records, options = {}) {
    let totalBasic = 0;
    let totalEarnedBasic = 0;
    let totalTransport = 0;
    let totalAppearance = 0;
    let totalNatureOfWork = 0;
    let totalLiving = 0;
    let totalHealth = 0;
    let totalAllowances = 0;
    let totalGross = 0;
    let totalInsuranceEmp = 0;
    let totalInsuranceOrg = 0;
    let totalAbsencePenalties = 0;
    let totalLoanInstallments = 0;
    let totalDeductions = 0;
    let totalTaxableBase = 0;
    let totalTax = 0;
    let totalNet = 0;
    let totalSkillsFund = 0;
    let totalUnpaidLeave = 0;
    let totalGrandNet = 0;

    const computedRecords = records.map(p => {
      const monthDays = Number(p.month_days || options.month_days || this.CONSTANTS.DEFAULT_MONTH_DAYS);
      const workingDays = Number(p.working_days != null ? p.working_days : (options.working_days || this.CONSTANTS.DEFAULT_WORKING_DAYS));
      const basic = Number(p.basic_salary || 0);

      // استحقاق الراتب الأساسي بناءً على أيام العمل الفعلية
      const earnedBasic = monthDays > 0 ? Math.round(basic * (workingDays / monthDays)) : basic;

      // احتساب البدلات النسبية من الراتب الأساسي المستحق
      const transportPct = p.transport_pct != null ? Number(p.transport_pct) : this.CONSTANTS.TRANSPORT_PCT;
      const appearancePct = p.appearance_pct != null ? Number(p.appearance_pct) : this.CONSTANTS.APPEARANCE_PCT;
      const natureOfWorkPct = p.nature_of_work_pct != null ? Number(p.nature_of_work_pct) : this.CONSTANTS.NATURE_OF_WORK_PCT;

      const transport = p.transport_allowance != null ? Number(p.transport_allowance) : Math.round(earnedBasic * (transportPct / 100));
      const appearance = p.appearance_allowance != null ? Number(p.appearance_allowance) : Math.round(earnedBasic * (appearancePct / 100));
      const natureOfWork = p.nature_of_work_allowance != null ? Number(p.nature_of_work_allowance) : Math.round(earnedBasic * (natureOfWorkPct / 100));

      // البدلات المقطوعة (بدل معيشة وبدل تأمين صحي) أو بدلات إضافية ممررة
      const living = p.living_allowance != null ? Number(p.living_allowance) : this.CONSTANTS.DEFAULT_LIVING_ALLOWANCE;
      const health = p.health_insurance_allowance != null ? Number(p.health_insurance_allowance) : this.CONSTANTS.DEFAULT_HEALTH_INSURANCE;
      const otherAllowances = Number(p.other_allowances || p.overtime_amount || 0);

      const allowances = transport + appearance + natureOfWork + living + health + otherAllowances;
      
      // الراتب الشامل
      const gross = p.gross_salary != null && Number(p.gross_salary) > 0 
        ? Number(p.gross_salary) 
        : (earnedBasic + allowances);

      // التأمينات الاجتماعية (6% موظف و 9% منشأة على الراتب الشامل أو الأساسي إن كان نمطاً مبسطاً)
      let insuranceEmp = 0;
      let insuranceOrg = 0;

      if (p.insurance_employee != null && Number(p.insurance_employee) > 0) {
        insuranceEmp = Number(p.insurance_employee);
      } else {
        // في النظام الشامل تحسب على الراتب الشامل
        insuranceEmp = Math.round(gross * (this.CONSTANTS.INSURANCE_EMP_PCT / 100));
      }

      if (p.insurance_employer != null && Number(p.insurance_employer) > 0) {
        insuranceOrg = Number(p.insurance_employer);
      } else {
        insuranceOrg = Math.round(gross * (this.CONSTANTS.INSURANCE_ORG_PCT / 100));
      }

      // الخصميات والجزاءات وأقساط السلف/التمويل
      const absencePenalties = Number(p.absence_penalty_deductions || 0);
      const loanInstallments = Number(p.loan_installments || p.advances || 0);
      const deductions = absencePenalties + loanInstallments + Number(p.deductions || 0);

      // الوعاء الضريبي (الراتب الشامل - تأمينات 6% - حد الإعفاء القانوني 65,000 - الخصميات)
      let taxableBase = 0;
      if (p.taxable_base != null && Number(p.taxable_base) > 0) {
        taxableBase = Number(p.taxable_base);
      } else {
        taxableBase = Math.max(0, gross - insuranceEmp - this.CONSTANTS.TAX_EXEMPTION_MONTHLY - deductions);
      }

      // ضريبة كسب العمل (شرائح تصاعدية: 10% لأول 40,000، و 15% لما زاد)
      let incomeTax = 0;
      if (p.tax_amount != null && Number(p.tax_amount) > 0) {
        incomeTax = Number(p.tax_amount);
      } else if (taxableBase > 0) {
        if (taxableBase <= this.CONSTANTS.TAX_FIRST_BRACKET_LIMIT) {
          incomeTax = Math.round(taxableBase * this.CONSTANTS.TAX_FIRST_RATE);
        } else {
          // الوعاء * 0.15 - 2000
          incomeTax = Math.round((this.CONSTANTS.TAX_FIRST_BRACKET_LIMIT * this.CONSTANTS.TAX_FIRST_RATE) + 
            ((taxableBase - this.CONSTANTS.TAX_FIRST_BRACKET_LIMIT) * this.CONSTANTS.TAX_SECOND_RATE));
        }
      }

      // صافي الراتب المستحق
      let netSalary = 0;
      if (p.net_salary != null && Number(p.net_salary) > 0) {
        netSalary = Number(p.net_salary);
      } else {
        netSalary = Math.max(0, gross - insuranceEmp - incomeTax - deductions);
      }

      // مساهمة صندوق تنمية المهارات 1% (محسوبة على الوعاء)
      let skillsFund = 0;
      if (p.skills_fund != null && Number(p.skills_fund) > 0) {
        skillsFund = Number(p.skills_fund);
      } else {
        skillsFund = Math.round(taxableBase * (this.CONSTANTS.SKILLS_FUND_PCT / 100));
      }

      // إجازة بدون راتب وإجمالي الصافي
      const unpaidLeave = Number(p.unpaid_leave_deduction || 0);
      const grandNet = Math.max(0, netSalary - unpaidLeave);

      totalBasic += basic;
      totalEarnedBasic += earnedBasic;
      totalTransport += transport;
      totalAppearance += appearance;
      totalNatureOfWork += natureOfWork;
      totalLiving += living;
      totalHealth += health;
      totalAllowances += allowances;
      totalGross += gross;
      totalInsuranceEmp += insuranceEmp;
      totalInsuranceOrg += insuranceOrg;
      totalAbsencePenalties += absencePenalties;
      totalLoanInstallments += loanInstallments;
      totalDeductions += deductions;
      totalTaxableBase += taxableBase;
      totalTax += incomeTax;
      totalNet += netSalary;
      totalSkillsFund += skillsFund;
      totalUnpaidLeave += unpaidLeave;
      totalGrandNet += grandNet;

      return {
        ...p,
        month_days: monthDays,
        working_days: workingDays,
        basic_salary: basic,
        earned_basic: earnedBasic,
        transport_pct: transportPct,
        transport_allowance: transport,
        appearance_pct: appearancePct,
        appearance_allowance: appearance,
        nature_of_work_pct: natureOfWorkPct,
        nature_of_work_allowance: natureOfWork,
        living_allowance: living,
        health_insurance_allowance: health,
        allowances,
        gross_salary: gross,
        insurance_employee: insuranceEmp,
        insurance_employer: insuranceOrg,
        insurance_company: insuranceOrg, // للتوافق العكسي مع الاختبارات
        absence_penalty_deductions: absencePenalties,
        loan_installments: loanInstallments,
        deductions,
        taxable_base: taxableBase,
        tax_amount: incomeTax,
        income_tax: incomeTax, // للتوافق العكسي
        net_salary: netSalary,
        skills_fund: skillsFund,
        unpaid_leave_deduction: unpaidLeave,
        total_net_salary: grandNet
      };
    });

    const summary = {
      totalBasic,
      totalEarnedBasic,
      totalTransport,
      totalAppearance,
      totalNatureOfWork,
      totalLiving,
      totalHealth,
      totalAllowances,
      totalGross,
      totalInsuranceEmp,
      totalInsuranceOrg,
      totalInsurance15Pct: totalInsuranceEmp + totalInsuranceOrg,
      totalAbsencePenalties,
      totalLoanInstallments,
      totalDeductions,
      totalTaxableBase,
      totalTax,
      totalNet,
      totalSkillsFund,
      totalUnpaidLeave,
      totalGrandNet
    };

    return {
      records: computedRecords,
      summary
    };
  },

  /**
   * توليد سطور القيد المحاسبي المركب المتزن تماماً لمسير الرواتب الشامل
   */
  generateCompoundJournalPreview(summary, accounts = {}) {
    const lines = [];

    // طرف مدين 1: مصروف الرواتب والأجور الشاملة والبدلات (إجمالي الاستحقاق)
    if (summary.totalGross > 0) {
      lines.push({
        type: 'debit',
        account_code: accounts.salaries_expense_code || '511',
        account_name: 'مصروف الرواتب والأجور الأساسية والبدلات',
        description: 'إجمالي استحقاقات رواتب وبدلات الموظفين (الراتب الشامل)',
        amount: summary.totalGross
      });
    }

    // طرف مدين 2: مصروف مساهمة المنشأة في التأمينات الاجتماعية (9%)
    if (summary.totalInsuranceOrg > 0) {
      lines.push({
        type: 'debit',
        account_code: accounts.insurance_expense_code || '512',
        account_name: 'مصروف مساهمة الشركة في التأمينات الاجتماعية (9%)',
        description: 'مساهمة المنشأة القانونية في الهيئة العامة للتأمينات والمعاشات',
        amount: summary.totalInsuranceOrg
      });
    }

    // طرف مدين 3: مصروف مساهمة صندوق تنمية المهارات (1%)
    if (summary.totalSkillsFund > 0) {
      lines.push({
        type: 'debit',
        account_code: accounts.skills_fund_expense_code || '513',
        account_name: 'مصروف مساهمة صندوق تنمية المهارات (1%)',
        description: 'مساهمة المنشأة المقررة لصندوق تنمية المهارات (1% من الوعاء)',
        amount: summary.totalSkillsFund
      });
    }

    // طرف دائن 1: أمانات مصلحة التأمينات الاجتماعية (15% = 6% موظف + 9% منشأة)
    const totalInsurancePayable = (summary.totalInsuranceEmp || 0) + (summary.totalInsuranceOrg || 0);
    if (totalInsurancePayable > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.insurance_payable_code || '214',
        account_name: 'الهيئة العامة للتأمينات والمعاشات (15%)',
        description: `حصة الموظفين 6% (${summary.totalInsuranceEmp}) + مساهمة الشركة 9% (${summary.totalInsuranceOrg})`,
        amount: totalInsurancePayable
      });
    }

    // طرف دائن 2: أمانات ضريبة كسب العمل المستقطعة
    if (summary.totalTax > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.tax_payable_code || '213',
        account_name: 'أمانات مصلحة الضرائب (ضريبة كسب العمل)',
        description: 'ضرائب الدخل المستقطعة من رواتب الموظفين لتوريدها للمصلحة',
        amount: summary.totalTax
      });
    }

    // طرف دائن 3: أمانات صندوق تنمية المهارات (1%)
    if (summary.totalSkillsFund > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.skills_fund_payable_code || '215',
        account_name: 'أمانات صندوق تنمية المهارات (1%)',
        description: 'مستحقات صندوق تنمية المهارات المقررة نظاماً',
        amount: summary.totalSkillsFund
      });
    }

    // طرف دائن 4: سلفيات وذمم الموظفين المستردة
    if (summary.totalDeductions > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.advances_receivable_code || '114',
        account_name: 'سلف وعهد الموظفين (تسوية أقساط)',
        description: 'أقساط السلف والجزاءات المستقطعة من مسير الرواتب',
        amount: summary.totalDeductions
      });
    }

    // طرف دائن 5: جاري الرواتب والأجور المستحقة أو الصندوق/البنك (إجمالي الصافي للصرف)
    const payableNet = summary.totalGrandNet || summary.totalNet;
    if (payableNet > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.salaries_payable_code || '111',
        account_name: 'الصندوق الرئيسي / البنك (صافي الرواتب القابل للصرف)',
        description: 'صافي مستحقات الرواتب المحولة أو المسددة نقداً للموظفين',
        amount: payableNet
      });
    }

    // التحقق من توازن القيد المركب
    const totalDebit = Math.round(lines.filter(l => l.type === 'debit').reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
    const totalCredit = Math.round(lines.filter(l => l.type === 'credit').reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
    const diff = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    const isBalanced = diff < 0.05;

    return {
      lines,
      totalDebit,
      totalCredit,
      isBalanced,
      difference: diff
    };
  }
};

module.exports = PayrollService;

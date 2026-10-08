const test = require('node:test');
const assert = require('node:assert/strict');
const PayrollService = require('../../server/services/payrollService');

test('Payroll Service - Comprehensive Allowances and Statutory Rules', () => {
  const records = [
    {
      employee_id: 1,
      basic_salary: 2796995,
      working_days: 31,
      month_days: 31,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 100000,
      health_insurance_allowance: 50000,
      deductions: 0
    }
  ];

  const result = PayrollService.calculateStatutoryPayroll(records);
  const emp = result.records[0];

  assert.strictEqual(emp.transport_allowance, 559399, '20% transport allowance on 2,796,995 is 559,399');
  assert.strictEqual(emp.appearance_allowance, 699249, '25% appearance allowance on 2,796,995 is 699,249');
  assert.strictEqual(emp.nature_of_work_allowance, 839099, '30% nature of work allowance on 2,796,995 is 839,099');
  assert.strictEqual(emp.gross_salary, 5044742, 'Gross salary matches within 1 YER rounding');
  assert.strictEqual(emp.insurance_employee, 302685, '6% employee insurance on gross is 302,685');
  assert.strictEqual(emp.insurance_employer, 454027, '9% employer insurance on gross is 454,027');
  assert.ok(emp.taxable_base > 0, 'Taxable base is calculated');
  assert.ok(emp.net_salary > 4000000, 'Net salary is above 4,000,000');
});

test('Payroll Service - Compound Journal Balance (Debit == Credit)', () => {
  const records = [
    {
      employee_id: 1,
      basic_salary: 2796995,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 100000,
      health_insurance_allowance: 50000
    },
    {
      employee_id: 2,
      basic_salary: 559464,
      transport_pct: 20,
      appearance_pct: 25,
      nature_of_work_pct: 30,
      living_allowance: 90000,
      health_insurance_allowance: 30000
    }
  ];

  const { summary } = PayrollService.calculateStatutoryPayroll(records);
  const preview = PayrollService.generateCompoundJournalPreview(summary);

  assert.strictEqual(preview.isBalanced, true, 'Compound payroll journal must balance perfectly');
  assert.strictEqual(preview.totalDebit, preview.totalCredit, `Debit (${preview.totalDebit}) must equal Credit (${preview.totalCredit})`);
});

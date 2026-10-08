/**
 * خدمة إدارة وحماية الفترات المحاسبية (Accounting Period Service)
 * تتحقق من إغلاق الفترة وتمنع تسجيل أو تعديل أي عملية مالية داخل التواريخ المغلقة
 */

const { get } = require('../database/db');

async function checkPeriodOpen(date) {
  if (!date) return { isOpen: true };
  const targetDate = String(date).split('T')[0];

  const closedPeriod = await get(`
    SELECT * FROM accounting_periods 
    WHERE status = 'closed' AND ? >= start_date AND ? <= end_date 
    ORDER BY end_date DESC 
    LIMIT 1
  `, [targetDate, targetDate]);

  if (closedPeriod) {
    return {
      isOpen: false,
      period: closedPeriod,
      message: `⛔ لا يمكن تنفيذ هذه العملية! الفترة المحاسبية لهذا التاريخ (${targetDate}) مغلقة رسمياً [${closedPeriod.period_name}: من ${closedPeriod.start_date} إلى ${closedPeriod.end_date}]. يرجى التواصل مع المدير المالي لإعادة فتح الفترة عند الضرورة.`
    };
  }

  return { isOpen: true };
}

module.exports = { checkPeriodOpen };

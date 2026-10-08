/**
 * خدمة سجل التدقيق والرقابة المالية (Audit Log Service)
 * توثق هوية المستخدم والعملية والكيان المتأثر وتفاصيل التغيير وعنوان IP
 */

const { run } = require('../database/db');

async function logAudit(req, {
  action,
  entity_type,
  entity_id = null,
  details = null,
  old_values = null,
  new_values = null,
  reason = null
}) {
  try {
    const user = req?.user || {};
    const userId = user.id || null;
    const username = user.username || user.full_name || req?.headers?.['x-user-name'] || 'المدير العام (نظام)';
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : '127.0.0.1';

    const stringifyVal = (val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'object') {
        try { return JSON.stringify(val); } catch { return String(val); }
      }
      return String(val);
    };

    const detailsStr = stringifyVal(details);
    const oldValuesStr = stringifyVal(old_values);
    const newValuesStr = stringifyVal(new_values);
    const reasonStr = reason ? String(reason).trim() : null;

    await run(`
      INSERT INTO audit_logs (
        user_id, username, action, entity_type, entity_id, 
        details, old_values, new_values, reason, ip_address
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      username,
      String(action || 'ACTION').toUpperCase(),
      String(entity_type || 'GENERAL').toLowerCase(),
      entity_id ? String(entity_id) : null,
      detailsStr,
      oldValuesStr,
      newValuesStr,
      reasonStr,
      ip
    ]);
  } catch (err) {
    console.error('⚠️ [AuditLog] خطأ أثناء تسجيل حركة التدقيق:', err.message);
  }
}

module.exports = { logAudit };

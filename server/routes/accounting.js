const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const AccountingService = require('../services/accountingService');
const FinancialControlService = require('../services/financialControlService');
const { requirePermission } = require('../middleware/security');

// دليل الحسابات الشجري مع دعم الهرمية، الرتب، والحسابات التحليلية الطرفية
router.get('/accounts', requirePermission('accounting:view,accounting,expenses:view,expenses:create,revenues:view,revenues:create,billing:view,custody:view,cash:view'), async (req, res) => {
  try {
    const { leaf_only, usable_only, active_only } = req.query;
    let sql = `
      SELECT a.*, 
             p.code as parent_code, 
             p.name as parent_name,
             (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as children_count
      FROM accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
    `;
    const conditions = [];
    const params = [];

    if (active_only === 'true') {
      conditions.push("(a.status IS NULL OR a.status = 'active')");
    }

    if (leaf_only === 'true' || usable_only === 'true') {
      // فقط الحسابات الفرعية الأخيرة النشطة القابلة للتسجيل (is_posting = 1 ولا يوجد لها أبناء)
      conditions.push("(a.is_posting = 1 OR a.level = 5)");
      conditions.push("(SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) = 0");
      conditions.push("(a.status IS NULL OR a.status = 'active')");
      conditions.push("(a.is_active IS NULL OR a.is_active = 1)");
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY a.code ASC';
    const accounts = await query(sql, params);
    const enriched = accounts.map(a => ({
      ...a,
      is_leaf: ((a.is_posting === 1 || a.level === 5) && Number(a.children_count || 0) === 0),
      status: a.status || 'active'
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب دليل الحسابات', error: err.message });
  }
});

// اقتراح رقم وكود حساب آلي من الرتبة الثالثة فما فوق
router.get('/accounts/suggest-code', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { parent_id, type } = req.query;
    let suggestedCode = '1111';
    let level = 3;

    if (parent_id) {
      const parent = await get('SELECT id, code, level FROM accounts WHERE id = ?', [parent_id]);
      if (parent) {
        const pCode = String(parent.code).trim();
        const pLen = pCode.length;
        // البحث عن الحسابات الفرعية الحالية لنفس الأب
        const siblings = await query('SELECT code FROM accounts WHERE parent_id = ? ORDER BY code DESC', [parent.id]);
        if (pLen === 1) {
          // أب رتبة 1 (مثل 1) -> نقترح رتبة 3 (مثل 111 أو 115)
          level = 3;
          if (siblings.length > 0) {
            const lastCode = siblings[0].code;
            const num = parseInt(lastCode, 10);
            suggestedCode = !isNaN(num) ? String(num + 1) : `${pCode}11`;
          } else {
            suggestedCode = `${pCode}11`;
          }
        } else if (pLen === 2) {
          // أب رتبة 2 (مثل 11 أو 21) -> نقترح رتبة 3 بثلاث خانات (مثل 115)
          level = 3;
          if (siblings.length > 0) {
            const lastCode = siblings[0].code;
            const num = parseInt(lastCode, 10);
            suggestedCode = !isNaN(num) ? String(num + 1) : `${pCode}1`;
          } else {
            suggestedCode = `${pCode}1`;
          }
        } else {
          // أب رتبة 3 أو أكثر -> نقترح رتبة 4 بأربع خانات
          level = Math.max(4, pLen + 1);
          if (siblings.length > 0) {
            const lastCode = siblings[0].code;
            const num = parseInt(lastCode, 10);
            suggestedCode = !isNaN(num) ? String(num + 1) : `${pCode}01`;
          } else {
            suggestedCode = `${pCode}01`;
          }
        }
      }
    } else if (type) {
      // افتراضي حسب النوع
      const prefixMap = { 'أصول': '111', 'خصوم': '211', 'حقوق ملكية': '311', 'إيرادات': '411', 'مصروفات': '511', 'تكاليف': '521' };
      const basePrefix = prefixMap[type] || '111';
      level = 3;
      const existing = await query('SELECT code FROM accounts WHERE code LIKE ? ORDER BY code DESC LIMIT 1', [`${basePrefix}%`]);
      if (existing && existing.length > 0) {
        const num = parseInt(existing[0].code, 10);
        suggestedCode = !isNaN(num) ? String(num + 1) : `${basePrefix}1`;
      } else {
        suggestedCode = `${basePrefix}1`;
      }
    }

    res.json({ success: true, suggested_code: suggestedCode, level });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في توليد كود الحساب', error: err.message });
  }
});

// إضافة حساب جديد إلى الدليل المحاسبي مع الترقيم من الرتبة الثالثة
router.post('/accounts', requirePermission('accounting:create,settings:company'), async (req, res) => {
  try {
    const { code, name, type, parent_code = '', parent_id: reqParentId, balance = 0, status = 'active' } = req.body;
    if (!code || !name || !type) {
      return res.status(400).json({ success: false, message: 'رقم الحساب، الاسم، والنوع حقول إلزامية' });
    }
    const cleanCode = String(code).trim();
    const existing = await get('SELECT id FROM accounts WHERE code = ?', [cleanCode]);
    if (existing) {
      return res.status(400).json({ success: false, message: `رقم الحساب (${cleanCode}) موجود مسبقاً` });
    }

    let parent_id = reqParentId ? Number(reqParentId) : null;
    if (!parent_id && parent_code) {
      const parent = await get('SELECT id FROM accounts WHERE code = ?', [String(parent_code).trim()]);
      if (parent) parent_id = parent.id;
    }

    // حساب المستوى وتأكيد الرتبة
    let level = 3;
    if (!parent_id && cleanCode.length === 1) {
      level = 1;
    } else if (cleanCode.length === 2) {
      level = 2;
    } else if (cleanCode.length === 3) {
      level = 3;
    } else {
      level = 4;
    }

    const result = await run(`
      INSERT INTO accounts (code, name, type, parent_id, balance, status, level)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [cleanCode, name.trim(), type, parent_id, Number(balance || 0), status || 'active', level]);

    const newId = result.lastInsertRowid || result.insertId;

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'account',
      entity_id: cleanCode,
      details: { id: newId, code: cleanCode, name: name.trim(), type, status, level }
    });

    res.json({ 
      success: true, 
      message: `تمت إضافة الحساب [${cleanCode} - ${name.trim()}] بنجاح`, 
      id: newId,
      data: { id: newId, code: cleanCode, name: name.trim(), type, status, level }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة الحساب: ' + err.message });
  }
});

// تعديل بيانات حساب مالي
router.put('/accounts/:id', requirePermission('accounting:edit,settings:company'), async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, type, parent_id, balance, status } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'اسم الحساب والنوع مطلوبان' });
    }

    const current = await get('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!current) {
      return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
    }

    const cleanCode = code ? String(code).trim() : current.code;
    if (cleanCode !== current.code) {
      const duplicate = await get('SELECT id FROM accounts WHERE code = ? AND id != ?', [cleanCode, id]);
      if (duplicate) {
        return res.status(400).json({ success: false, message: `كود الحساب [${cleanCode}] مسجل مسبقاً لحساب آخر` });
      }
    }

    const pId = parent_id !== undefined && parent_id !== '' ? (parent_id ? Number(parent_id) : null) : current.parent_id;
    const accStatus = status || current.status || 'active';
    const accBalance = balance !== undefined ? Number(balance) : current.balance;
    const level = cleanCode.length >= 4 ? 4 : (cleanCode.length === 3 ? 3 : (cleanCode.length === 2 ? 2 : 1));

    await run(`
      UPDATE accounts 
      SET code = ?, name = ?, type = ?, parent_id = ?, balance = ?, status = ?, level = ?
      WHERE id = ?
    `, [cleanCode, name.trim(), type, pId, accBalance, accStatus, level, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'account',
      entity_id: String(id),
      details: { id, code: cleanCode, name: name.trim(), type, status: accStatus }
    });

    res.json({ success: true, message: `تم تحديث بيانات الحساب [${cleanCode} - ${name.trim()}] بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الحساب: ' + err.message });
  }
});

// تبديل حالة الحساب (تقييد / توقيف أو تنشيط)
router.patch('/accounts/:id/toggle-status', requirePermission('accounting:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const account = await get('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!account) {
      return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
    }

    const newStatus = (account.status === 'restricted' || account.status === 'inactive') ? 'active' : 'restricted';
    await run('UPDATE accounts SET status = ? WHERE id = ?', [newStatus, id]);

    const statusLabel = newStatus === 'active' ? 'تنشيط' : 'تقييد وإيقاف';
    await logAudit(req, {
      action: 'UPDATE_STATUS',
      entity_type: 'account',
      entity_id: String(id),
      details: { id, code: account.code, old_status: account.status, new_status: newStatus }
    });

    res.json({ 
      success: true, 
      message: `تم ${statusLabel} الحساب [${account.code} - ${account.name}] بنجاح`,
      status: newStatus 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تغيير حالة الحساب: ' + err.message });
  }
});

// حذف حساب من دليل الحسابات مع الفحص المحاسبي الصارم
router.delete('/accounts/:id', requirePermission('accounting:delete,settings:company'), async (req, res) => {
  try {
    const { id } = req.params;
    const account = await get('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!account) {
      return res.status(404).json({ success: false, message: 'الحساب المراد حذفه غير موجود' });
    }

    // 1. التحقق من عدم وجود حسابات متفرعة منه (Parent check)
    const child = await get('SELECT COUNT(*) as cnt FROM accounts WHERE parent_id = ?', [id]);
    if (child && child.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف الحساب [${account.code} - ${account.name}] لوجود (${child.cnt}) حسابات فرعية متفرعة منه. يرجى نقلها أو حذفها أولاً.` 
      });
    }

    // 2. التحقق من عدم وجود قيود يومية مسجلة عليه
    const jeCheck = await get('SELECT COUNT(*) as cnt FROM journal_entry_lines WHERE account_id = ?', [id]);
    if (jeCheck && jeCheck.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف الحساب [${account.code} - ${account.name}] نظراً لوجود (${jeCheck.cnt}) سطور قيود محاسبية مسجلة عليه في دفتر اليومية. يمكنك تقييده/إيقافه بدلاً من الحذف لسلامة السجلات.` 
      });
    }

    // 3. التحقق من سندات القبض أو الصرف
    const payCheck = await get('SELECT COUNT(*) as cnt FROM payments WHERE account_id = ?', [id]);
    if (payCheck && payCheck.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف الحساب لارتباطه بـ (${payCheck.cnt}) سندات قبض أو صرف. يمكنك تقييد الحساب بدلاً من حذفه.` 
      });
    }

    // 4. التحقق من المصروفات
    const expCheck = await get('SELECT COUNT(*) as cnt FROM expenses WHERE account_id = ?', [id]);
    if (expCheck && expCheck.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف الحساب لارتباطه بـ (${expCheck.cnt}) سندات مصروفات مسجلة.` 
      });
    }

    // الحذف الفعلي إن كان خالياً تماماً من الحركات
    await run('DELETE FROM accounts WHERE id = ?', [id]);

    await logAudit(req, {
      action: 'DELETE',
      entity_type: 'account',
      entity_id: account.code,
      details: { id, code: account.code, name: account.name, type: account.type }
    });

    res.json({ success: true, message: `تم حذف الحساب [${account.code} - ${account.name}] نهائياً بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف الحساب: ' + err.message });
  }
});

// جلب قائمة العملات وأسعار الصرف
router.get('/currencies', requirePermission('accounting:view'), async (req, res) => {
  try {
    const currencies = await query('SELECT * FROM currencies ORDER BY is_base DESC, code ASC');
    const enriched = (currencies || []).map(c => {
      const rate = Number(c.rate_to_base ?? c.exchange_rate ?? 1.0);
      const isBase = (c.is_base === 1 || c.is_base === true || c.is_default === 1 || c.code === 'YER') ? 1 : 0;
      return {
        ...c,
        rate_to_base: rate,
        exchange_rate: rate,
        is_base: isBase,
        is_default: isBase
      };
    });
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العملات', error: err.message });
  }
});

// إضافة عملة جديدة
router.post('/currencies', requirePermission('accounting:create,settings:company'), async (req, res) => {
  try {
    const code = req.body.code ? String(req.body.code).trim().toUpperCase() : '';
    const name = req.body.name ? String(req.body.name).trim() : '';
    const symbol = req.body.symbol ? String(req.body.symbol).trim() : '';
    const rawRate = req.body.rate_to_base ?? req.body.exchange_rate ?? 1.0;
    const rate_to_base = Number(rawRate) || 1.0;
    const is_base = (req.body.is_base === 1 || req.body.is_base === true || req.body.is_default === 1) ? 1 : 0;

    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'كود العملة واسم العملة حقول مطلوبة' });
    }
    const existing = await get('SELECT id FROM currencies WHERE code = ?', [code]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'رمز العملة مسجل مسبقاً' });
    }

    if (is_base === 1) {
      await run('UPDATE currencies SET is_base = 0');
    }

    const result = await run(`
      INSERT INTO currencies (code, name, symbol, rate_to_base, is_base)
      VALUES (?, ?, ?, ?, ?)
    `, [code, name, symbol || null, rate_to_base, is_base]);

    res.json({ success: true, message: 'تمت إضافة العملة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة العملة: ' + err.message });
  }
});

// تعديل سعر صرف العملة
router.put('/currencies/:id', requirePermission('accounting:edit,settings:company'), async (req, res) => {
  try {
    const { id } = req.params;
    const rawRate = req.body.rate_to_base ?? req.body.exchange_rate;
    const rate_to_base = rawRate !== undefined ? Number(rawRate) : null;
    const name = req.body.name ? String(req.body.name).trim() : null;
    const symbol = req.body.symbol ? String(req.body.symbol).trim() : null;
    const is_base = req.body.is_base !== undefined ? (Number(req.body.is_base) ? 1 : 0) : (req.body.is_default !== undefined ? (Number(req.body.is_default) ? 1 : 0) : null);

    if (rate_to_base !== null && (isNaN(rate_to_base) || rate_to_base <= 0)) {
      return res.status(400).json({ success: false, message: 'سعر الصرف يجب أن يكون أكبر من الصفر' });
    }

    if (is_base === 1) {
      await run('UPDATE currencies SET is_base = 0');
    }

    await run(`
      UPDATE currencies 
      SET rate_to_base = COALESCE(?, rate_to_base),
          name = COALESCE(?, name),
          symbol = COALESCE(?, symbol),
          is_base = COALESCE(?, is_base),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [rate_to_base, name, symbol, is_base, id]);

    res.json({ success: true, message: 'تم تحديث العملة وسعر الصرف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث العملة: ' + err.message });
  }
});

// جلب قائمة مراكز التكلفة
router.get('/cost-centers', requirePermission('accounting:view,accounting,expenses:view,expenses:create,revenues:view,revenues:create,billing:view,custody:view,cash:view'), async (req, res) => {
  try {
    const centers = await query(`
      SELECT cc.*, p.name as project_name 
      FROM cost_centers cc
      LEFT JOIN projects p ON cc.project_id = p.id
      ORDER BY cc.code ASC
    `);
    res.json({ success: true, data: centers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب مراكز التكلفة', error: err.message });
  }
});

// إضافة مركز تكلفة جديد
router.post('/cost-centers', requirePermission('accounting:create'), async (req, res) => {
  try {
    const { code, name, type = 'مشروع', project_id, notes } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'كود المركز واسمه مطلوبان' });
    }
    const existing = await get('SELECT id FROM cost_centers WHERE code = ?', [code.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'كود مركز التكلفة مسجل مسبقاً' });
    }

    const pId = project_id && project_id !== '' ? Number(project_id) : null;
    const result = await run(`
      INSERT INTO cost_centers (code, name, type, project_id, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [code.trim(), name.trim(), type, pId, notes || '']);

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'cost_center',
      entity_id: code.trim(),
      details: { code: code.trim(), name: name.trim(), type, project_id: pId }
    });

    res.json({ success: true, message: 'تم إنشاء مركز التكلفة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء مركز التكلفة: ' + err.message });
  }
});

// تعديل بيانات مركز تكلفة
router.put('/cost-centers/:id', requirePermission('accounting:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, type = 'مشروع', project_id, notes, status } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'اسم مركز التكلفة مطلوب' });
    }

    const current = await get('SELECT * FROM cost_centers WHERE id = ?', [id]);
    if (!current) {
      return res.status(404).json({ success: false, message: 'مركز التكلفة غير موجود' });
    }

    const cleanCode = code ? String(code).trim() : current.code;
    if (cleanCode !== current.code) {
      const duplicate = await get('SELECT id FROM cost_centers WHERE code = ? AND id != ?', [cleanCode, id]);
      if (duplicate) {
        return res.status(400).json({ success: false, message: `كود مركز التكلفة [${cleanCode}] مسجل مسبقاً` });
      }
    }

    const pId = project_id !== undefined && project_id !== '' ? (project_id ? Number(project_id) : null) : current.project_id;
    const ccStatus = status || current.status || 'active';

    await run(`
      UPDATE cost_centers 
      SET code = ?, name = ?, type = ?, project_id = ?, notes = ?, status = ?
      WHERE id = ?
    `, [cleanCode, name.trim(), type, pId, notes || '', ccStatus, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'cost_center',
      entity_id: String(id),
      details: { id, code: cleanCode, name: name.trim(), type, status: ccStatus }
    });

    res.json({ success: true, message: `تم تحديث مركز التكلفة [${cleanCode} - ${name.trim()}] بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث مركز التكلفة: ' + err.message });
  }
});

// حذف مركز تكلفة مع فحص العمليات المرتبطة
router.delete('/cost-centers/:id', requirePermission('accounting:delete'), async (req, res) => {
  try {
    const { id } = req.params;
    const cc = await get('SELECT * FROM cost_centers WHERE id = ?', [id]);
    if (!cc) {
      return res.status(404).json({ success: false, message: 'مركز التكلفة المراد حذفه غير موجود' });
    }

    // فحص القيود اليومية
    const jeCheck = await get('SELECT COUNT(*) as cnt FROM journal_entry_lines WHERE cost_center_id = ?', [id]);
    if (jeCheck && jeCheck.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف مركز التكلفة [${cc.code} - ${cc.name}] لارتباطه بـ (${jeCheck.cnt}) سطور قيود محاسبية. يمكنك إيقافه وتغيير حالته إلى موقوف بدلاً من الحذف.` 
      });
    }

    // فحص السندات
    const payCheck = await get('SELECT COUNT(*) as cnt FROM payments WHERE cost_center_id = ?', [id]);
    if (payCheck && payCheck.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف مركز التكلفة لارتباطه بـ (${payCheck.cnt}) سندات مسجلة.` 
      });
    }

    // فحص المصروفات
    const expCheck = await get('SELECT COUNT(*) as cnt FROM expenses WHERE cost_center_id = ?', [id]);
    if (expCheck && expCheck.cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `لا يمكن حذف مركز التكلفة لارتباطه بـ (${expCheck.cnt}) سندات مصروفات.` 
      });
    }

    await run('DELETE FROM cost_centers WHERE id = ?', [id]);

    await logAudit(req, {
      action: 'DELETE',
      entity_type: 'cost_center',
      entity_id: cc.code,
      details: { id, code: cc.code, name: cc.name }
    });

    res.json({ success: true, message: `تم حذف مركز التكلفة [${cc.code} - ${cc.name}] بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف مركز التكلفة: ' + err.message });
  }
});

// استعلام الأرقام المتسلسلة التالية للسندات والقيود للعرض الفوري في الشاشات
router.get('/next-numbers', requirePermission('accounting:view,expenses:view,revenues:view'), async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    // 1. سند قبض
    const rcCount = await get('SELECT COUNT(*) as cnt FROM payments WHERE type = "قبض"');
    let rcSeq = ((rcCount ? rcCount.cnt : 0) || 0) + 1;
    let nextRc = `RC-${currentYear}-${String(rcSeq).padStart(4, '0')}`;
    while (await get('SELECT id FROM payments WHERE receipt_no = ?', [nextRc])) {
      rcSeq++;
      nextRc = `RC-${currentYear}-${String(rcSeq).padStart(4, '0')}`;
    }

    // 2. سند صرف (payments)
    const pvCount = await get('SELECT COUNT(*) as cnt FROM payments WHERE type = "صرف"');
    let pvSeq = ((pvCount ? pvCount.cnt : 0) || 0) + 1;
    let nextPv = `PV-${currentYear}-${String(pvSeq).padStart(4, '0')}`;
    while (await get('SELECT id FROM payments WHERE receipt_no = ?', [nextPv])) {
      pvSeq++;
      nextPv = `PV-${currentYear}-${String(pvSeq).padStart(4, '0')}`;
    }

    // 3. سند صرف مصروفات (expenses)
    const expCount = await get('SELECT COUNT(*) as cnt FROM expenses');
    let expSeq = ((expCount ? expCount.cnt : 0) || 0) + 1;
    let nextExp = `EP-${currentYear}-${String(expSeq).padStart(4, '0')}`;
    while (await get('SELECT id FROM expenses WHERE receipt_no = ?', [nextExp])) {
      expSeq++;
      nextExp = `EP-${currentYear}-${String(expSeq).padStart(4, '0')}`;
    }

    // 4. قيد يومية
    const jeCount = await get('SELECT COUNT(*) as cnt FROM journal_entries');
    let jeSeq = ((jeCount ? jeCount.cnt : 0) || 0) + 1;
    let nextJe = `JV-${currentYear}-${String(jeSeq).padStart(4, '0')}`;
    while (await get('SELECT id FROM journal_entries WHERE entry_no = ?', [nextJe])) {
      jeSeq++;
      nextJe = `JV-${currentYear}-${String(jeSeq).padStart(4, '0')}`;
    }

    res.json({
      success: true,
      data: {
        receipt_voucher: nextRc,
        payment_voucher: nextPv,
        expense_voucher: nextExp,
        journal_entry: nextJe
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب أرقام السندات', error: err.message });
  }
});

// جلب قيود اليومية العامة
router.get('/journal-entries', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { from_date, to_date, reference_type } = req.query;
    let sql = `
      SELECT je.*, 
        COUNT(jel.id) as lines_count
      FROM journal_entries je
      LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
    `;
    const params = [];
    const conditions = [];

    if (from_date) {
      conditions.push('je.date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('je.date <= ?');
      params.push(to_date);
    }
    if (reference_type) {
      conditions.push('je.reference_type = ?');
      params.push(reference_type);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY je.id ORDER BY je.date DESC, je.id DESC LIMIT 100';
    const entries = await query(sql, params);
    res.json({ success: true, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب قيود اليومية', error: err.message });
  }
});

// جلب بيانات قيود اليومية التفصيلية لتصدير إكسل والتقارير الشاملة
router.get('/journal-entries/export-data', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { from_date, to_date, status, reference_type } = req.query;
    let sql = `
      SELECT 
        je.id as entry_id,
        je.entry_no,
        je.date as entry_date,
        je.description as entry_description,
        je.reference_type,
        je.reference_id,
        je.status as entry_status,
        COALESCE(je.created_by_name, '') as created_by_name,
        jel.id as line_id,
        jel.account_id,
        COALESCE(a.code, '') as account_code,
        COALESCE(a.name, '') as account_name,
        jel.debit,
        jel.credit,
        COALESCE(jel.notes, '') as line_notes,
        COALESCE(cc.code, '') as cost_center_code,
        COALESCE(cc.name, '') as cost_center_name,
        COALESCE(p.name, '') as project_name,
        COALESCE(cl.name, pm.client_name, '') as client_name,
        COALESCE(sp.name, ex.supplier_name, ex.recipient, '') as supplier_name,
        COALESCE(pm.currency, ex.currency, 'ر.ي') as currency,
        COALESCE(pm.exchange_rate, ex.exchange_rate, 1) as exchange_rate,
        CASE 
          WHEN jel.debit > 0 THEN jel.debit * COALESCE(pm.exchange_rate, ex.exchange_rate, 1)
          ELSE 0 
        END as local_debit,
        CASE 
          WHEN jel.credit > 0 THEN jel.credit * COALESCE(pm.exchange_rate, ex.exchange_rate, 1)
          ELSE 0 
        END as local_credit
      FROM journal_entries je
      JOIN journal_entry_lines jel ON je.id = jel.entry_id
      LEFT JOIN accounts a ON jel.account_id = a.id
      LEFT JOIN cost_centers cc ON jel.cost_center_id = cc.id
      LEFT JOIN projects p ON jel.project_id = p.id
      LEFT JOIN payments pm ON (je.reference_type IN ('سند قبض', 'payment') AND (je.reference_id = pm.id OR je.entry_no = pm.receipt_no))
      LEFT JOIN clients cl ON pm.client_id = cl.id
      LEFT JOIN expenses ex ON (je.reference_type IN ('سند صرف', 'expense') AND (je.reference_id = ex.id OR je.entry_no = ex.receipt_no))
      LEFT JOIN suppliers sp ON ex.supplier_id = sp.id
    `;
    const conditions = [];
    const params = [];

    if (from_date) {
      conditions.push('je.date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('je.date <= ?');
      params.push(to_date);
    }
    if (status) {
      conditions.push('je.status = ?');
      params.push(status);
    }
    if (reference_type) {
      conditions.push('je.reference_type = ?');
      params.push(reference_type);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY je.date DESC, je.id DESC, jel.id ASC';

    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات تصدير القيود: ' + err.message });
  }
});

// جلب تفاصيل قيد يومية محدد مع كافة أطرافه المحاسبية
router.get('/journal-entries/:id', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'القيد غير موجود' });
    }

    const lines = await query(`
      SELECT jel.*, 
        a.code as account_code, 
        a.name as account_name,
        a.type as account_type,
        p.name as project_name,
        cc.code as cost_center_code,
        cc.name as cost_center_name
      FROM journal_entry_lines jel
      LEFT JOIN accounts a ON jel.account_id = a.id
      LEFT JOIN projects p ON jel.project_id = p.id
      LEFT JOIN cost_centers cc ON jel.cost_center_id = cc.id
      WHERE jel.entry_id = ?
      ORDER BY jel.id ASC
    `, [id]);

    res.json({ success: true, data: { ...entry, lines } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل القيد', error: err.message });
  }
});

// نقطة فحص فوري لحالة الفترة المحاسبية لتاريخ محدد (تستخدمها الواجهات ونماذج الإدخال)
router.get('/check-period', requirePermission('accounting:view,expenses:create,revenues:create'), async (req, res) => {
  try {
    const { date } = req.query;
    const result = await checkPeriodOpen(date || new Date().toISOString().split('T')[0]);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إنشاء قيد يدوي متزن بطرفين أو أطراف متعددة مع الفحص الصارم للاتزان وإغلاق الفترات ومراكز التكلفة
router.post('/journal-entries', requirePermission('accounting:create'), async (req, res) => {
  try {
    const { 
      date = new Date().toISOString().split('T')[0], 
      description, 
      reference_type = 'قيد يدوي',
      reference_id = null,
      lines,
      status: requestedStatus
    } = req.body;

    const result = await AccountingService.createJournalEntry({
      date,
      description,
      reference_type,
      reference_id,
      status: requestedStatus
    }, lines, req);

    res.json({
      success: true,
      message: 'تم حفظ وتوثيق القيد اليومي المتزن بنجاح وتحديث السجلات المحاسبية',
      entry_no: result.entry_no,
      id: result.id,
      total_debit: result.total_debit,
      total_credit: result.total_credit,
      status: result.status
    });
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('غير متزن') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message, error: err.message });
  }
});

// إرسال مسودة القيد اليومي للمراجعة (Draft -> Under Review)
router.post('/journal-entries/:id/submit-review', requirePermission('accounting:create,accounting:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) return res.status(404).json({ success: false, message: 'القيد اليومي غير موجود' });

    if (entry.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال القيد للمراجعة لأنه في حالة [${entry.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مراجع الحسابات';

    await run(`
      UPDATE journal_entries 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: 'journal_entry',
      entity_id: entry.entry_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال القيد اليومي (${entry.entry_no}) للمراجعة بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد القيد اليومي مع تطبيق مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/journal-entries/:id/approve', requirePermission('accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) return res.status(404).json({ success: false, message: 'القيد اليومي غير موجود' });

    // 1. تطبيق مبدأ العيون الأربع (منع منشئ القيد من اعتماده بنفسه)
    try {
      FinancialControlService.assertMakerChecker(entry, req.user, 'اعتماد');
    } catch (soDError) {
      return res.status(403).json({ success: false, message: soDError.message, fourEyesViolation: true });
    }

    // 2. فحص الفترة المحاسبية
    await FinancialControlService.assertPeriodOpen(entry.date);

    if (entry.status === 'approved' || entry.status === 'posted') {
      return res.status(400).json({ success: false, message: 'القيد معتمد مسبقاً' });
    }

    const rawAppId = req.user?.id || null;
    const approverId = await FinancialControlService.resolveValidUserId(rawAppId);
    const approverName = req.user?.username || req.user?.full_name || 'المدير المالي';

    await run(`
      UPDATE journal_entries 
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ?
    `, [approverId, approverName, notes || null, id]);

    await logAudit(req, {
      action: 'APPROVE',
      entity_type: 'journal_entry',
      entity_id: entry.entry_no,
      old_values: { status: entry.status },
      new_values: { status: 'approved', approved_by: approverName },
      reason: notes || 'اعتماد مالي قانوني'
    });

    res.json({ success: true, message: `تم اعتماد القيد اليومي (${entry.entry_no}) بنجاح بواسطة [${approverName}]`, status: 'approved' });
  } catch (err) {
    const status = err.message.includes('انتهاك') || err.message.includes('لا يجوز') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ترحيل القيد اليومي لدفتر الأستاذ العام (Post to GL)
router.post('/journal-entries/:id/post', requirePermission('accounting:post'), async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) return res.status(404).json({ success: false, message: 'القيد اليومي غير موجود' });

    if (entry.status === 'posted') {
      return res.status(400).json({ success: false, message: 'القيد مرحل مسبقاً' });
    }
    if (entry.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'لا يمكن ترحيل قيد تم عكسه مسبقاً' });
    }

    await FinancialControlService.assertPeriodOpen(entry.date);

    // التحقق الصارم من التوازن قبل الترحيل
    const diff = Math.abs(Number(entry.total_debit) - Number(entry.total_credit));
    if (diff > 0.001 || Number(entry.total_debit) <= 0) {
      return res.status(400).json({ success: false, message: `⛔ لا يمكن ترحيل قيد غير متزن! الفرق: ${diff}` });
    }

    const rawPosterId = req.user?.id || null;
    const posterId = await FinancialControlService.resolveValidUserId(rawPosterId);
    const posterName = req.user?.username || req.user?.full_name || 'المحاسب المالي';

    await run(`
      UPDATE journal_entries 
      SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [posterId, posterName, id]);

    await logAudit(req, {
      action: 'POST',
      entity_type: 'journal_entry',
      entity_id: entry.entry_no,
      old_values: { status: entry.status },
      new_values: { status: 'posted', posted_by: posterName }
    });

    res.json({ success: true, message: `تم ترحيل القيد اليومي (${entry.entry_no}) بنجاح لدفتر الأستاذ`, status: 'posted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل القيد: ' + err.message });
  }
});

// تنفيذ قيد عكسي لقيد يومي عام (Storno Reversal)
router.post('/journal-entries/:id/reverse', requirePermission('accounting:approve,accounting:create'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reverseJournalEntry(id, {
      user: req.user,
      reason,
      reversal_date,
      req
    });

    res.json(result);
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('يجب كتابة') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// حذف قيد يومي (محمي: للمسودات فقط! يمنع منعاً باتاً حذف القيود المرحلة)
router.delete('/journal-entries/:id', requirePermission('accounting:approve'), async (req, res) => {
  try {
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [req.params.id]);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'القيد غير موجود' });
    }

    try {
      FinancialControlService.assertDeletable(entry);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(entry.date);

    await transaction(async (tx) => {
      await tx.run('DELETE FROM journal_entry_lines WHERE entry_id = ?', [req.params.id]);
      await tx.run('DELETE FROM journal_entries WHERE id = ?', [req.params.id]);
    });

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: 'journal_entry',
      entity_id: entry.entry_no,
      old_values: { entry_no: entry.entry_no, total_debit: entry.total_debit, total_credit: entry.total_credit, date: entry.date },
      reason: req.body?.reason || 'حذف مسودة قيد غير معتمدة'
    });

    res.json({ success: true, message: 'تم حذف مسودة القيد اليومي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تعديل قيد يومي (محمي: للمسودات فقط مع التحقق الصارم من التوازن وتوثيق سجل التغيرات)
router.put('/journal-entries/:id', requirePermission('accounting:create,accounting:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) return res.status(404).json({ success: false, message: 'القيد غير موجود' });

    try {
      FinancialControlService.assertMutable(entry, 'تعديل بيانات أو أطراف القيد');
    } catch (mErr) {
      return res.status(400).json({ success: false, message: mErr.message, immutable: true });
    }

    const { date, description, lines, reason } = req.body;
    const targetDate = date || entry.date;
    await FinancialControlService.assertPeriodOpen(targetDate);

    // إذا أرسلت خطوط جديدة، يتم التحقق المالي الصارم من التوازن ومراكز التكلفة
    let validated = null;
    if (lines && Array.isArray(lines)) {
      validated = await AccountingService.validateJournalEntryLines(lines);
    }

    const oldVals = { 
      date: entry.date, 
      description: entry.description, 
      total_debit: entry.total_debit, 
      total_credit: entry.total_credit 
    };

    const newVals = {
      date: targetDate,
      description: description !== undefined ? String(description).trim() : entry.description,
      total_debit: validated ? validated.totalDebit : entry.total_debit,
      total_credit: validated ? validated.totalCredit : entry.total_credit
    };

    await transaction(async (tx) => {
      await tx.run(`
        UPDATE journal_entries 
        SET date = ?, description = ?, total_debit = ?, total_credit = ?
        WHERE id = ?
      `, [newVals.date, newVals.description, newVals.total_debit, newVals.total_credit, id]);

      if (validated) {
        await tx.run('DELETE FROM journal_entry_lines WHERE entry_id = ?', [id]);
        for (const line of validated.sanitizedLines) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [id, line.account_id, line.cost_center_id, line.debit, line.credit, line.description]);
        }
      }
    });

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'journal_entry',
      entity_id: entry.entry_no,
      old_values: oldVals,
      new_values: newVals,
      reason: reason || 'تعديل مسودة قيد يومي'
    });

    res.json({
      success: true,
      message: 'تم تعديل مسودة القيد اليومي بنجاح وتحديث أطرافه المحاسبية',
      entry_no: entry.entry_no,
      total_debit: newVals.total_debit,
      total_credit: newVals.total_credit
    });
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('غير متزن') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// جلب قائمة العهد المفتوحة وغير المصفاة (للتصفية السريعة)
router.get('/open-custodies', requirePermission('custody:view'), async (req, res) => {
  try {
    const { employee_id } = req.query;
    let sql = `
      SELECT c.*, e.employee_no as emp_code, e.full_name as emp_full_name, e.job_title
      FROM custodies c
      LEFT JOIN employees e ON c.employee_id = e.id
      WHERE c.operation_type = 'صرف عهدة' AND c.remaining_amount > 0
    `;
    const params = [];
    if (employee_id) {
      sql += ' AND c.employee_id = ?';
      params.push(employee_id);
    }
    sql += ' ORDER BY c.date DESC, c.id DESC';

    const list = await query(sql, params);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العهد المفتوحة', error: err.message });
  }
});

// جلب النثريات والعهد مع بيانات الموظف والعهدة الأصلية والحساب المالي
router.get('/custodies', requirePermission('custody:view'), async (req, res) => {
  try {
    const custodies = await query(`
      SELECT c.*, 
             COALESCE(c.account_code, a.code) as account_code,
             COALESCE(c.account_name, a.name) as account_name,
             COALESCE(c.payment_method, 'نقدي') as payment_method,
             e.employee_no as emp_code, 
             e.full_name as emp_full_name, 
             e.job_title as emp_job_title
      FROM custodies c
      LEFT JOIN accounts a ON c.account_id = a.id
      LEFT JOIN employees e ON c.employee_id = e.id
      ORDER BY c.date DESC, c.id DESC
    `);
    res.json({ success: true, data: custodies });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العهد والنثريات', error: err.message });
  }
});

// تسجيل عهدة أو نثرية أو تصفية عهدة سابقة مع ربط الحساب المالي وحركة الصندوق/البنك
router.post('/custodies', requirePermission('custody:create'), async (req, res) => {
  try {
    const {
      operation_type = 'صرف عهدة',
      employee_id,
      employee_name,
      related_custody_id,
      total_amount,
      spent_amount = 0,
      currency = 'ر.ي',
      date = new Date().toISOString().split('T')[0],
      notes,
      account_id,
      account_code,
      account_name,
      payment_method = 'نقدي'
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ العهدة
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    const parsedAmount = Number(total_amount || 0);
    const parsedSpent = Number(spent_amount || 0);
    const selectedCurrency = currency || 'ر.ي';

    // 2. استخراج بيانات الموظف
    let empId = employee_id ? Number(employee_id) : null;
    let empNo = null;
    let empName = employee_name ? employee_name.trim() : '';

    if (empId) {
      const emp = await get('SELECT id, employee_no, full_name FROM employees WHERE id = ?', [empId]);
      if (emp) {
        empNo = emp.employee_no;
        empName = emp.full_name;
      }
    }

    if (!empName) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد الموظف أو كتابة اسمه' });
    }

    // 3. استخراج بيانات الحساب المالي المرتبط
    let accId = account_id ? Number(account_id) : null;
    let accCode = account_code || null;
    let accName = account_name || null;
    if (accId && (!accCode || !accName)) {
      const acc = await get('SELECT id, code, name FROM accounts WHERE id = ?', [accId]);
      if (acc) {
        accCode = acc.code;
        accName = acc.name;
      }
    }

    const currentYear = new Date().getFullYear();

    // ================== معالجة تصفية عهدة سابقة ==================
    if (operation_type === 'تصفية عهدة') {
      if (!related_custody_id) {
        return res.status(400).json({ success: false, message: 'رقم العهدة الأصلية المراد تصفيتها مطلوب' });
      }

      const origCustody = await get('SELECT * FROM custodies WHERE id = ?', [related_custody_id]);
      if (!origCustody) {
        return res.status(404).json({ success: false, message: 'العهدة الأصلية المحددة غير موجودة في النظام' });
      }

      const remainingInOrig = Number(origCustody.remaining_amount || 0);
      const settleAmount = parsedSpent > 0 ? parsedSpent : parsedAmount;

      if (settleAmount <= 0) {
        return res.status(400).json({ success: false, message: 'مبلغ التصفية الفعلي يجب أن يكون أكبر من الصفر' });
      }

      if (settleAmount > remainingInOrig) {
        return res.status(400).json({ 
          success: false, 
          message: `مبلغ التصفية (${settleAmount.toLocaleString()}) يتجاوز الرصيد المتبقي في العهدة (${remainingInOrig.toLocaleString()} ${origCustody.currency || selectedCurrency})` 
        });
      }

      // توليد رقم عملية التصفية
      const countRes = await get('SELECT COUNT(*) as cnt FROM custodies');
      const seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      const custody_no = `STL-${currentYear}-${String(seq).padStart(4, '0')}`;

      const txResult = await transaction(async (tx) => {
        // 1. تحديث رصيد العهدة الأصلية
        const newSpent = Number(origCustody.spent_amount || 0) + settleAmount;
        const newRemaining = remainingInOrig - settleAmount;
        const newStatus = newRemaining <= 0 ? 'مصفاة بالكامل' : 'تصفية جزئية';

        await tx.run(`
          UPDATE custodies 
          SET spent_amount = ?, remaining_amount = ?, status = ?
          WHERE id = ?
        `, [newSpent, newRemaining, newStatus, origCustody.id]);

        // 2. تسجيل حركة التصفية في جدول العهد
        const result = await tx.run(`
          INSERT INTO custodies (
            custody_no, operation_type, related_custody_id, related_custody_no,
            employee_id, employee_no, employee_name,
            total_amount, spent_amount, remaining_amount, currency, status, date, notes,
            account_id, account_code, account_name, payment_method
          ) VALUES (?, 'تصفية عهدة', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'تمت التصفية', ?, ?, ?, ?, ?, ?)
        `, [
          custody_no, origCustody.id, origCustody.custody_no,
          empId || origCustody.employee_id, empNo || origCustody.employee_no, empName || origCustody.employee_name,
          settleAmount, settleAmount, 0, selectedCurrency, date, notes || `تصفية للعهدة رقم ${origCustody.custody_no}`,
          accId || origCustody.account_id, accCode || origCustody.account_code, accName || origCustody.account_name, payment_method || 'نقدي'
        ]);

        return { result, newRemaining, newStatus };
      });

      // توثيق التصفية في سجل التدقيق والرقابة
      await logAudit(req, {
        action: 'SETTLE',
        entity_type: 'custody',
        entity_id: custody_no,
        details: { custody_no, related_custody_no: origCustody.custody_no, settleAmount, empName }
      });

      return res.json({
        success: true,
        message: `تم تسجيل تصفية العهدة بنجاح برقم ${custody_no}. الرصيد المتبقي في العهدة الأصلية: ${txResult.newRemaining.toLocaleString()} ${selectedCurrency}`,
        custody_no,
        settle_amount: settleAmount,
        remaining_in_original: txResult.newRemaining
      });
    }

    // ================== صرف عهدة جديدة أو نثرية ==================
    if (parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ العهدة يجب أن يكون أكبر من الصفر' });
    }

    const countRes = await get('SELECT COUNT(*) as cnt FROM custodies');
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    const prefix = operation_type === 'نثرية' ? 'PET' : 'CST';
    let custody_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM custodies WHERE custody_no = ?', [custody_no])) {
      seq++;
      custody_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const remaining = Math.max(0, parsedAmount - parsedSpent);

    const result = await run(`
      INSERT INTO custodies (
        custody_no, operation_type, employee_id, employee_no, employee_name,
        total_amount, spent_amount, remaining_amount, currency, status, date, notes,
        account_id, account_code, account_name, payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'مفتوحة', ?, ?, ?, ?, ?, ?)
    `, [
      custody_no, operation_type, empId, empNo, empName,
      parsedAmount, parsedSpent, remaining, selectedCurrency, date, notes || '',
      accId, accCode, accName, payment_method || 'نقدي'
    ]);

    // تسجيل حركة صرف العهدة في حركة الصندوق والبنك
    const moveType = (payment_method === 'شيك' || payment_method === 'تحويل بنكي' || payment_method === 'بنك') ? 'بنك' : 'نقدي';
    const lastCash = await get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1');
    const prevBal = (lastCash && lastCash.current_balance != null) ? Number(lastCash.current_balance) : 0;
    const currentBal = prevBal - parsedAmount;

    await run(`
      INSERT INTO cash_movements (
        date, cash_in, cash_out, previous_balance, current_balance, notes,
        movement_type, payment_method, reference_no, account_id
      )
      VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      date,
      parsedAmount,
      prevBal,
      currentBal,
      `${operation_type}: ${custody_no} للموظف (${empName})${accName ? ' - حساب: ' + accName : ''}`,
      moveType,
      payment_method || 'نقدي',
      custody_no,
      accId
    ]);

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'custody',
      entity_id: custody_no,
      details: { custody_no, operation_type, empName, total_amount: parsedAmount, account_id: accId, account_code: accCode }
    });

    res.json({
      success: true,
      message: `تم تسجيل ${operation_type} بنجاح برقم ${custody_no} وإدراج حركة الصرف في حركة الصندوق والبنك`,
      custody_no,
      id: result.lastInsertRowid || result.insertId,
      remaining
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل العهدة: ' + err.message, error: err.message });
  }
});

// حركة الصندوق والبنك مع الفلترة حسب نوع الحركة (نقدي / بنك / الكل) والتاريخ
router.get('/cash-movements', async (req, res) => {
  try {
    const { type, from_date, to_date, all } = req.query;
    let sql = 'SELECT * FROM cash_movements';
    const conditions = [];
    const params = [];

    if (type && type !== 'الكل' && type !== 'all') {
      conditions.push('movement_type = ?');
      params.push(type);
    }
    if (from_date) {
      conditions.push('date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('date <= ?');
      params.push(to_date);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC, id DESC';
    if (!all && all !== 'true') {
      sql += ' LIMIT 100';
    }

    const movements = await query(sql, params);

    // ملخص الحركة
    let summarySql = `
      SELECT 
        (SELECT previous_balance FROM cash_movements ORDER BY id ASC LIMIT 1) as initial_balance,
        SUM(cash_in) as total_cash_in,
        SUM(cash_out) as total_cash_out,
        SUM(withdrawals) as total_withdrawals,
        (SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1) as current_balance
      FROM cash_movements
    `;
    let summaryConditions = [];
    let summaryParams = [];
    if (type && type !== 'الكل' && type !== 'all') {
      summaryConditions.push('movement_type = ?');
      summaryParams.push(type);
    }
    if (from_date) {
      summaryConditions.push('date >= ?');
      summaryParams.push(from_date);
    }
    if (to_date) {
      summaryConditions.push('date <= ?');
      summaryParams.push(to_date);
    }
    if (summaryConditions.length > 0) {
      summarySql += ' WHERE ' + summaryConditions.join(' AND ');
    }

    const summary = await get(summarySql, summaryParams) || { 
      initial_balance: 0, 
      total_cash_in: 0, 
      total_cash_out: 0, 
      total_withdrawals: 0, 
      current_balance: 0 
    };

    res.json({ success: true, data: movements, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب حركة الصندوق', error: err.message });
  }
});

// ============================================================
// 🔒 إدارة الفترات المحاسبية وإغلاق الحسابات (Period Locking)
// ============================================================

// استعراض الفترات المحاسبية وحالتها
router.get('/periods', requirePermission('accounting:view'), async (req, res) => {
  try {
    const periods = await query('SELECT * FROM accounting_periods ORDER BY fiscal_year DESC, start_date DESC');
    res.json({ success: true, data: periods });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الفترات المحاسبية', error: err.message });
  }
});

// إنشاء فترة محاسبية جديدة
router.post('/periods', requirePermission('accounting:create'), async (req, res) => {
  try {
    const { period_name, fiscal_year, start_date, end_date, notes } = req.body;
    if (!period_name || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'اسم الفترة وتاريخ البداية والنهاية حقول مطلوبة' });
    }
    const fYear = Number(fiscal_year) || new Date(start_date).getFullYear();

    const result = await run(`
      INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes)
      VALUES (?, ?, ?, ?, 'open', ?)
    `, [period_name.trim(), fYear, start_date, end_date, notes || '']);

    const periodId = result.lastInsertRowid || result.insertId;

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'period',
      entity_id: periodId,
      details: { period_name: period_name.trim(), fiscal_year: fYear, start_date, end_date }
    });

    res.json({ success: true, message: 'تم إنشاء الفترة المحاسبية بنجاح', id: periodId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء الفترة المحاسبية: ' + err.message });
  }
});

// فحص كافة القيود والسندات غير المرحلة في نطاق الفترة المحاسبية قبل إقفالها
router.get('/periods/:id/unposted-items', requirePermission('accounting:view'), async (req, res) => {
  try {
    const { id } = req.params;
    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
    if (!period) return res.status(404).json({ success: false, message: 'الفترة غير موجودة' });

    const startDate = period.start_date;
    const endDate = period.end_date;

    const unpostedJournals = await query(`
      SELECT id, entry_no, date, description, total_debit, status 
      FROM journal_entries 
      WHERE date BETWEEN ? AND ? AND (status != 'posted' AND status != 'reversed')
      ORDER BY date ASC
    `, [startDate, endDate]);

    const unpostedExpenses = await query(`
      SELECT id, receipt_no, date, expense_type, recipient, supplier_name, amount, currency, status 
      FROM expenses 
      WHERE date BETWEEN ? AND ? AND (status != 'posted' AND status != 'reversed')
      ORDER BY date ASC
    `, [startDate, endDate]);

    const unpostedPayments = await query(`
      SELECT id, receipt_no, type, date, client_name, amount, currency, status 
      FROM payments 
      WHERE date BETWEEN ? AND ? AND (status != 'posted' AND status != 'reversed')
      ORDER BY date ASC
    `, [startDate, endDate]);

    const totalUnposted = unpostedJournals.length + unpostedExpenses.length + unpostedPayments.length;

    res.json({
      success: true,
      period,
      total_unposted: totalUnposted,
      unposted_journals: unpostedJournals,
      unposted_expenses: unpostedExpenses,
      unposted_payments: unpostedPayments
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في فحص المعاملات غير المرحلة: ' + err.message });
  }
});

// ترحيل كافة السندات والقيود غير المرحلة التابعة للفترة المحاسبية دفعة واحدة
router.post('/periods/:id/post-all', requirePermission('accounting:post'), async (req, res) => {
  try {
    const { id } = req.params;
    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
    if (!period) return res.status(404).json({ success: false, message: 'الفترة غير موجودة' });

    if (period.status === 'closed') {
      return res.status(400).json({ success: false, message: 'الفترة المحاسبية مغلقة مسبقاً' });
    }

    const posterId = req.user?.id || 1;
    const posterName = req.user?.username || req.user?.full_name || 'مدير الحسابات';
    const startDate = period.start_date;
    const endDate = period.end_date;

    let postedJournalsCount = 0;
    let postedExpensesCount = 0;
    let postedPaymentsCount = 0;

    await transaction(async (tx) => {
      // 1. ترحيل قيود اليومية غير المرحلة المتزنة
      const unpostedJournals = await tx.query(`
        SELECT * FROM journal_entries 
        WHERE date BETWEEN ? AND ? AND status != 'posted' AND status != 'reversed'
      `, [startDate, endDate]);

      for (const je of unpostedJournals) {
        const diff = Math.abs(Number(je.total_debit) - Number(je.total_credit));
        if (diff <= 0.001 && Number(je.total_debit) > 0) {
          await tx.run(`
            UPDATE journal_entries 
            SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [posterId, posterName, je.id]);
          postedJournalsCount++;
        }
      }

      // 2. ترحيل سندات الصرف غير المرحلة
      const unpostedExpenses = await tx.query(`
        SELECT * FROM expenses 
        WHERE date BETWEEN ? AND ? AND status != 'posted' AND status != 'reversed'
      `, [startDate, endDate]);

      for (const exp of unpostedExpenses) {
        const parsedAmount = Number(exp.amount) || 0;
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        let jeSeq = ((entryCount ? entryCount.cnt : 0) || 0) + 1;
        let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
          jeSeq++;
          entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        }
        const jeRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, reference_id, 
            total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          )
          VALUES (?, ?, ?, 'سند صرف', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entryNo, exp.date,
          `سند صرف مرحل ${exp.receipt_no} - ${exp.notes || exp.expense_type || ''}`,
          exp.id, parsedAmount, parsedAmount,
          posterId, posterName, posterId, posterName
        ]);
        const jeId = jeRes.lastInsertRowid || jeRes.insertId;
        const debitAccountId = exp.account_id || 10;
        const finalCcId = exp.cost_center_id || 1;

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, debitAccountId, finalCcId, exp.project_id, parsedAmount, `مصروف ${exp.expense_type || ''}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, 3, ?, ?, 0, ?, ?)
        `, [jeId, finalCcId, exp.project_id, parsedAmount, `الصندوق / البنك - ترحيل سند صرف`]);

        await tx.run(`
          UPDATE expenses 
          SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [posterId, posterName, exp.id]);
        postedExpensesCount++;
      }

      // 3. ترحيل سندات القبض غير المرحلة
      const unpostedPayments = await tx.query(`
        SELECT * FROM payments 
        WHERE date BETWEEN ? AND ? AND status != 'posted' AND status != 'reversed'
      `, [startDate, endDate]);

      for (const pay of unpostedPayments) {
        const parsedAmount = Number(pay.amount) || 0;
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        let jeSeq = ((entryCount ? entryCount.cnt : 0) || 0) + 1;
        let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
          jeSeq++;
          entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        }
        const jeRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, reference_id, 
            total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entryNo, pay.date,
          `سند ${pay.type} مرحل ${pay.receipt_no} - ${pay.notes || ''}`,
          `سند ${pay.type}`, pay.id,
          parsedAmount, parsedAmount,
          posterId, posterName, posterId, posterName
        ]);
        const jeId = jeRes.lastInsertRowid || jeRes.insertId;
        const finalCcId = pay.cost_center_id || 1;

        if (pay.type === 'قبض') {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, 3, ?, ?, ?, 0, ?)
          `, [jeId, finalCcId, pay.project_id, parsedAmount, `قبض في الصندوق / البنك`]);

          let creditAcc = pay.account_id || 4;
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `, [jeId, creditAcc, finalCcId, pay.project_id, parsedAmount, 'تخفيض ذمة العميل']);
        } else {
          const debitAcc = pay.account_id || 7;
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, ?, ?, ?, ?, 0, ?)
          `, [jeId, debitAcc, finalCcId, pay.project_id, parsedAmount, `سداد للمورد`]);

          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, 3, ?, ?, 0, ?, ?)
          `, [jeId, finalCcId, pay.project_id, parsedAmount, `صرف من الصندوق / البنك`]);
        }

        await tx.run(`
          UPDATE payments 
          SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [posterId, posterName, pay.id]);
        postedPaymentsCount++;
      }
    });

    await logAudit(req, {
      action: 'BATCH_POST_PERIOD',
      entity_type: 'period',
      entity_id: id,
      details: {
        period_name: period.period_name,
        postedJournalsCount,
        postedExpensesCount,
        postedPaymentsCount,
        total: postedJournalsCount + postedExpensesCount + postedPaymentsCount
      }
    });

    res.json({
      success: true,
      message: `تم ترحيل كافة السندات والقيود بنجاح (قيود: ${postedJournalsCount}، صرف: ${postedExpensesCount}، قبض: ${postedPaymentsCount})`,
      counts: {
        journals: postedJournalsCount,
        expenses: postedExpensesCount,
        payments: postedPaymentsCount,
        total: postedJournalsCount + postedExpensesCount + postedPaymentsCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل السندات والقيود: ' + err.message });
  }
});

// إغلاق فترة محاسبية رسمياً لمنع التعديل على أي تاريخ يقع داخلها (يتطلب تفويض وكلمة مرور المدير)
router.put('/periods/:id/close', requirePermission('accounting:approve,accounting:close_period'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, manager_password } = req.body;

    if (!manager_password || !String(manager_password).trim()) {
      return res.status(400).json({ 
        success: false, 
        message: '⛔ إقفال الفترة المحاسبية يتطلب إدخال كلمة مرور المدير المالي / المشرف للتفويض القانوني.' 
      });
    }

    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
    if (!period) {
      return res.status(404).json({ success: false, message: 'الفترة المحاسبية غير موجودة' });
    }

    if (period.status === 'closed') {
      return res.status(400).json({ success: false, message: 'الفترة المحاسبية مغلقة مسبقاً' });
    }

    // التحقق الأمني من صحة كلمة مرور المدير
    let isAuthorized = false;
    let authorizedUser = null;

    // 1. فحص المستخدم الحالي المسجل
    if (req.user && req.user.id) {
      const currentUser = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (currentUser && currentUser.password_hash) {
        if (bcrypt.compareSync(manager_password, currentUser.password_hash)) {
          isAuthorized = true;
          authorizedUser = currentUser;
        }
      }
    }

    // 2. إذا لم يتطابق، التحقق هل كلمة المرور تخص أحد حسابات المدراء (Admin / Manager)
    if (!isAuthorized) {
      const adminUsers = await query("SELECT * FROM users WHERE role IN ('admin', 'general_manager') OR username = 'admin'");
      for (const admin of adminUsers) {
        if (admin.password_hash && bcrypt.compareSync(manager_password, admin.password_hash)) {
          isAuthorized = true;
          authorizedUser = admin;
          break;
        }
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({ 
        success: false, 
        message: '⛔ كلمة مرور المدير غير صحيحة! لا يمكن إقفال الفترة بدون تفويض مالي معتمد.' 
      });
    }

    const username = authorizedUser?.full_name || authorizedUser?.username || req.user?.username || 'المدير العام';
    await run(`
      UPDATE accounting_periods 
      SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `, [username, notes || null, id]);

    await logAudit(req, {
      action: 'CLOSE_PERIOD',
      entity_type: 'period',
      entity_id: id,
      details: { period_name: period.period_name, closed_by: username, notes, authorized_user_id: authorizedUser?.id }
    });

    res.json({ 
      success: true, 
      message: `🔒 تم إغلاق وتأمين الفترة المحاسبية (${period.period_name}) بنجاح بواسطة [${username}]، وتم قفل كافة المعاملات والقيود بين ${period.start_date} و ${period.end_date}.` 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إغلاق الفترة المحاسبية: ' + err.message });
  }
});

// إعادة فتح فترة محاسبية مغلقة (يتطلب سبباً مبرراً وتوثيقاً في سجل التدقيق)
router.put('/periods/:id/reopen', requirePermission('accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'يجب ذكر سبب رسمي ومبرر إداري لإعادة فتح الفترة المحاسبية المغلقة' });
    }

    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
    if (!period) {
      return res.status(404).json({ success: false, message: 'الفترة المحاسبية غير موجودة' });
    }

    const username = req.user?.username || req.user?.full_name || 'المدير العام';
    await run(`
      UPDATE accounting_periods 
      SET status = 'open', reopened_at = CURRENT_TIMESTAMP, reopened_by = ?, reopen_reason = ?
      WHERE id = ?
    `, [username, reason.trim(), id]);

    await logAudit(req, {
      action: 'REOPEN_PERIOD',
      entity_type: 'period',
      entity_id: id,
      details: { period_name: period.period_name, reopened_by: username, reason: reason.trim() }
    });

    res.json({ 
      success: true, 
      message: `تمت إعادة فتح الفترة المحاسبية (${period.period_name}) بنجاح وتوثيق سبب الإجراء في سجل الرقابة` 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إعادة فتح الفترة: ' + err.message });
  }
});

// ============================================================
// 📜 سجل التدقيق والرقابة المالية (Audit Log API)
// ============================================================
router.get('/audit-logs', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const { entity_type, action, from_date, to_date, page = 1, limit = 20 } = req.query;
    let sql = 'SELECT * FROM audit_logs';
    const conditions = [];
    const params = [];

    if (entity_type) {
      conditions.push('entity_type = ?');
      params.push(entity_type.toLowerCase());
    }
    if (action) {
      conditions.push('action = ?');
      params.push(action.toUpperCase());
    }
    if (from_date) {
      conditions.push('created_at >= ?');
      params.push(from_date + ' 00:00:00');
    }
    if (to_date) {
      conditions.push('created_at <= ?');
      params.push(to_date + ' 23:59:59');
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const countSql = sql.replace('SELECT * FROM audit_logs', 'SELECT COUNT(*) as total FROM audit_logs');
    const countRow = await get(countSql, params);
    const total = countRow ? countRow.total : 0;

    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(5, Number(limit) || 20));
    params.push(l, (p - 1) * l);

    const rows = await query(sql, params);
    res.json({
      success: true,
      data: rows,
      pagination: { total, page: p, limit: l, totalPages: Math.ceil(total / l) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب سجل التدقيق: ' + err.message });
  }
});

module.exports = router;

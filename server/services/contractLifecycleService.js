/**
 * =========================================================================
 * contractLifecycleService.js
 * محرك إدارة دورة حياة العقد المتكاملة (Contract Lifecycle Management)
 * لشركة رواسي عدن للهندسة والمقاولات
 *
 * يدير المراحل العشر القانونية والمالية والتنفيذية:
 * 1. draft (مسودة أولية)
 * 2. under_review (قيد المراجعة القانونية والهندسية)
 * 3. approved_finance (اعتماد مالي وموازنة المشروع)
 * 4. signed (موقّع وموثق بختم رقمي SHA-256)
 * 5. active (سارٍ وقيد التنفيذ الميداني)
 * 6. amended (معدل بأوامر تغيير تعاقدية)
 * 7. extended (تمديد فترة العقد رسمياً)
 * 8. in_ipc (إصدار مستخلصات جارية)
 * 9. in_settlement (تسوية ختامية ومطابقة الحسابات)
 * 10. closed (مغلق ومستلم نهائياً بعد فترة الضمان)
 * =========================================================================
 */

const crypto = require('crypto');
const { get, query, run, transaction } = require('../database/db');

// قائمة المراحل العشر المعتمدة
const CONTRACT_STAGES = [
  'draft',
  'under_review',
  'approved_finance',
  'signed',
  'active',
  'amended',
  'extended',
  'in_ipc',
  'in_settlement',
  'closed'
];

const STAGE_LABELS_AR = {
  draft: 'مسودة العقد',
  under_review: 'قيد المراجعة القانونية والهندسية',
  approved_finance: 'معتمد مالياً وميزانية',
  signed: 'موقّع رسمياً بين الطرفين',
  active: 'سارٍ وقيد التنفيذ الميداني',
  amended: 'معدل بأوامر تغيير (VO)',
  extended: 'ممدد بملحق زمني معتمد',
  in_ipc: 'مستخلصات جارية معتمدة',
  in_settlement: 'مرحلة التسوية والحساب الختامي',
  closed: 'مغلق ومستلم نهائياً (DLP انقضت)'
};

class ContractLifecycleService {
  /**
   * الانتقال بالعقد إلى مرحلة جديدة مع التوثيق الجنائي والرقمي
   */
  static async transitionStage(contractId, targetStage, details = {}, user = {}) {
    const cId = Number(contractId);
    if (!CONTRACT_STAGES.includes(targetStage)) {
      throw new Error(`المرحلة المطلوبة [${targetStage}] غير معرفة. المراحل المعتمدة: ${CONTRACT_STAGES.join(', ')}`);
    }

    return await transaction(async (tx) => {
      const contract = await tx.get(`
        SELECT c.*, p.name as project_name 
        FROM project_contracts c
        LEFT JOIN projects p ON c.project_id = p.id
        WHERE c.id = ?
      `, [cId]);

      if (!contract) {
        throw new Error(`العقد رقم [${cId}] غير موجود`);
      }

      // إنهاء المرحلة السابقة
      await tx.run(`
        UPDATE contract_lifecycle 
        SET exited_at = CURRENT_TIMESTAMP 
        WHERE contract_id = ? AND exited_at IS NULL
      `, [cId]);

      // إنشاء التوقيع الرقمي المشفر إذا كانت المرحلة signed أو active
      let signatureHash = details.signature_hash || null;
      let signatureDate = details.signature_date || null;

      if (targetStage === 'signed' || (!signatureHash && contract.status === 'draft' && targetStage === 'active')) {
        signatureDate = signatureDate || new Date().toISOString().split('T')[0];
        const payload = `${cId}:${contract.contract_no}:${contract.contract_value}:${contract.first_party}:${contract.second_party}:${signatureDate}`;
        signatureHash = crypto.createHash('sha256').update(payload).digest('hex');
      }

      const docsJson = details.documents_json
        ? (typeof details.documents_json === 'string' ? details.documents_json : JSON.stringify(details.documents_json))
        : null;

      const userName = user.username || user.full_name || 'SYSTEM';

      // إدراج سجل المرحلة الجديدة
      const insertRes = await tx.run(`
        INSERT INTO contract_lifecycle (
          contract_id, stage, entered_by, approved_by, approval_notes,
          documents_json, signature_date, signature_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        cId,
        targetStage,
        userName,
        details.approved_by || userName,
        details.approval_notes || `الانتقال إلى مرحلة: ${STAGE_LABELS_AR[targetStage]}`,
        docsJson,
        signatureDate,
        signatureHash
      ]);

      // تحديث حالة العقد الرئيسية في project_contracts
      await tx.run(`
        UPDATE project_contracts 
        SET status = ? 
        WHERE id = ?
      `, [targetStage, cId]);

      // إذا أصبح العقد active يتم تنشيط المشروع تلقائياً
      if (targetStage === 'active' && contract.project_id) {
        await tx.run(`
          UPDATE projects 
          SET status = 'active' 
          WHERE id = ? AND status = 'draft'
        `, [contract.project_id]);
      }

      return {
        success: true,
        lifecycle_id: insertRes.lastInsertRowid || insertRes.insertId,
        contract_id: cId,
        stage: targetStage,
        stage_label: STAGE_LABELS_AR[targetStage],
        signature_hash: signatureHash,
        entered_at: new Date().toISOString(),
        message: `تم انتقال العقد رقم [${contract.contract_no || cId}] إلى مرحلة [${STAGE_LABELS_AR[targetStage]}] بنجاح`
      };
    });
  }

  /**
   * جلب السجل التاريخي الكامل لجميع المراحل التي مر بها العقد
   */
  static async getLifecycleHistory(contractId) {
    const cId = Number(contractId);
    const contract = await get(`
      SELECT c.*, p.name as project_name 
      FROM project_contracts c
      LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.id = ?
    `, [cId]);

    if (!contract) {
      throw new Error(`العقد رقم [${cId}] غير موجود`);
    }

    const history = await query(`
      SELECT * FROM contract_lifecycle 
      WHERE contract_id = ? 
      ORDER BY id ASC
    `, [cId]);

    // إذا لم يكن للعقد سجل حياة بعد، نهيئ له مرحلته الحالية
    if (history.length === 0) {
      const currentStage = contract.status || 'draft';
      const initialEntry = await this.transitionStage(cId, currentStage, {
        approval_notes: 'تهيئة سجل دورة حياة العقد التأسيسي'
      }, { username: 'SYSTEM' });
      return {
        contract: {
          id: cId,
          contract_no: contract.contract_no,
          title: contract.title,
          current_stage: currentStage,
          current_stage_label: STAGE_LABELS_AR[currentStage] || currentStage
        },
        stages: [initialEntry]
      };
    }

    const formattedStages = history.map(h => {
      let durationHours = null;
      if (h.exited_at && h.entered_at) {
        const start = new Date(h.entered_at);
        const end = new Date(h.exited_at);
        durationHours = Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;
      }
      return {
        ...h,
        stage_label: STAGE_LABELS_AR[h.stage] || h.stage,
        duration_hours: durationHours,
        is_current: h.exited_at === null
      };
    });

    return {
      contract: {
        id: cId,
        contract_no: contract.contract_no,
        title: contract.title,
        project_name: contract.project_name,
        current_stage: contract.status,
        current_stage_label: STAGE_LABELS_AR[contract.status] || contract.status
      },
      stages: formattedStages
    };
  }

  /**
   * جلب العقود الجاهزة للانتقال أو التي قاربت على الانتهاء
   */
  static async getExpiringContracts(daysThreshold = 30) {
    const days = Number(daysThreshold) || 30;
    const contracts = await query(`
      SELECT c.*, p.name as project_name, p.code as project_code,
             CAST((julianday(c.end_date) - julianday(CURRENT_DATE)) AS INTEGER) as days_remaining
      FROM project_contracts c
      LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.end_date IS NOT NULL 
        AND c.status NOT IN ('closed', 'cancelled')
        AND CAST((julianday(c.end_date) - julianday(CURRENT_DATE)) AS INTEGER) <= ?
      ORDER BY days_remaining ASC
    `, [days]);

    return {
      success: true,
      threshold_days: days,
      count: contracts.length,
      contracts: contracts.map(c => ({
        ...c,
        stage_label: STAGE_LABELS_AR[c.status] || c.status,
        urgency: c.days_remaining <= 7 ? 'critical' : (c.days_remaining <= 30 ? 'warning' : 'info')
      }))
    };
  }
}

module.exports = {
  ContractLifecycleService,
  CONTRACT_STAGES,
  STAGE_LABELS_AR
};

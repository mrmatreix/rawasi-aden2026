/**
 * materialAuditScheduler.js
 * 
 * مجدول ومراقب الجرد الدوري التلقائي للمستودعات والمخازن (Periodic Inventory Audit Scheduler)
 * يقوم بفحص المستودعات دورياً وإنشاء مسودات الجرد المجدولة مع لقطات التجميد التلقائية
 */

const { query, get } = require('../database/db');
const MaterialManagementService = require('./materialManagementService');
const materialDomainEventBus = require('./materialDomainEventBus');

class MaterialAuditScheduler {
  constructor() {
    this.timer = null;
    this.checkIntervalMs = 60 * 60 * 1000; // فحص كل ساعة
    this.auditThresholdDays = 30; // جرد كل 30 يوماً كحد أقصى لكل مستودع
    this.isRunning = false;
  }

  /**
   * تهيئة وبدء تشغيل خدمة المجدول
   */
  init() {
    if (this.timer) clearInterval(this.timer);
    // تشغيل فحص فوري بعد 10 ثوانٍ من الإقلاع
    setTimeout(() => this.runScheduledCheck(), 10 * 1000);
    // جدولة الفحص الدوري
    this.timer = setInterval(() => this.runScheduledCheck(), this.checkIntervalMs);
    if (this.timer && this.timer.unref) {
      this.timer.unref();
    }
    console.log('📦 [MaterialAuditScheduler] تم تفعيل مراقب الجرد الدوري للمستودعات.');
  }

  /**
   * فحص المستودعات المستحقة للجرد وتشغيل الجرد الدوري التلقائي
   */
  async runScheduledCheck() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const warehouses = await query('SELECT * FROM warehouses WHERE status = ?', ['active']);
      const now = new Date();

      for (const wh of warehouses) {
        // فحص آخر جرد مكتمل أو قيد التنفيذ لهذا المستودع
        const lastAudit = await get(`
          SELECT * FROM inventory_audits 
          WHERE warehouse_id = ? AND status != 'cancelled'
          ORDER BY id DESC LIMIT 1
        `, [wh.id]);

        let needsAudit = false;
        if (!lastAudit) {
          needsAudit = true;
        } else {
          const lastDate = new Date(lastAudit.created_at || lastAudit.scheduled_at);
          const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
          // إذا مر أكثر من 30 يوماً ولا يوجد جرد مفتوح حالياً
          if (diffDays >= this.auditThresholdDays && lastAudit.status === 'reconciled') {
            needsAudit = true;
          }
        }

        if (needsAudit) {
          // التحقق من عدم وجود جرد نشط حالياً لنفس المستودع لتفادي التكرار
          const activeAudit = await get(`
            SELECT id FROM inventory_audits 
            WHERE warehouse_id = ? AND status IN ('draft', 'in_progress', 'minutes_sealed')
          `, [wh.id]);

          if (!activeAudit) {
            console.log(`⏰ [MaterialAuditScheduler] تشغيل جرد دوري تلقائي لمستودع [${wh.name}]`);
            await MaterialManagementService.createPeriodicAudit({
              warehouse_id: wh.id,
              auditor_name: 'لجنة الجرد الدورية (مجدول تلقائياً)',
              scheduled_date: now.toISOString().split('T')[0],
              notes: `جرد دوري آلي منشأ بواسطة النظام لمستودع ${wh.name}`
            }, { id: 1, username: 'AuditBot (نظام)' });
          }
        }
      }
    } catch (err) {
      console.error('⚠️ [MaterialAuditScheduler] خطأ أثناء فحص الجرد المجدول:', err.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * إيقاف المجدول
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const materialAuditScheduler = new MaterialAuditScheduler();
module.exports = materialAuditScheduler;

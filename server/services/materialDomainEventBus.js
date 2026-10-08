/**
 * materialDomainEventBus.js
 * 
 * ناقل أحداث المجال وسجل التدقيق المشفر غير القابل للتلاعب (Domain Event Bus & Cryptographic Event Store)
 * يطبق مبادئ البنية القائمة على الأحداث (Event-Driven Architecture - EDA) وقابلية التدقيق الشاملة:
 * 1. تسجيل كافة أحداث دورة حياة المواد (Audit Trail) بسلسلة كتلية هاشية (Hash-Chained Audit Ledger).
 * 2. منع التلاعب بالسجلات التاريخية بحساب SHA-256 مرتبط بالحدث السابق.
 * 3. فك الارتباط (Decoupling) بين منطق الأعمال ومعالجات التدقيق والإشعارات والقيود.
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const { run, query, get } = require('../database/db');
const { logAudit } = require('./auditService');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

class MaterialDomainEventBus extends EventEmitter {
  constructor() {
    super();
    this.initDefaultListeners();
  }

  /**
   * ربط المستمعين الافتراضيين للأحداث لتوثيق سجل التدقيق المركزي تلقائياً
   */
  initDefaultListeners() {
    this.on('domainEvent', async (event) => {
      try {
        await logAudit(null, {
          action: event.eventName,
          entity_type: event.aggregateType,
          entity_id: event.aggregateId,
          details: {
            eventId: event.eventId,
            payload: event.payload,
            eventHash: event.eventHash,
            userId: event.userId,
            userName: event.userName
          }
        });
      } catch (err) {
        console.error('⚠️ [MaterialEventBus] Error in audit listener:', err.message);
      }
    });
  }

  /**
   * حساب الهاش المشفر للحدث بناءً على الحدث السابق والبيانات الحالية
   */
  computeEventHash(prevHash, eventName, aggregateId, payloadStr, timestamp) {
    return crypto
      .createHash('sha256')
      .update(`${prevHash}:${eventName}:${aggregateId}:${payloadStr}:${timestamp}`)
      .digest('hex');
  }

  /**
   * نشر وتسجيل حدث مجال جديد مع ربطه بالسلسلة المشفرة
   */
  async publish(eventName, aggregateType, aggregateId, payload, user = null) {
    const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = new Date().toISOString();
    const payloadStr = JSON.stringify(payload || {});
    const userId = user?.id || null;
    const userName = user?.username || user?.full_name || 'System';

    try {
      // 1. جلب هاش آخر حدث مسجل في السلسلة
      const lastEvent = await get('SELECT event_hash FROM material_domain_events ORDER BY id DESC LIMIT 1');
      const prevHash = lastEvent?.event_hash || GENESIS_HASH;

      // 2. حساب الهاش الجديد
      const eventHash = this.computeEventHash(prevHash, eventName, aggregateId, payloadStr, timestamp);

      // 3. الحفظ في جدول الأحداث غير القابل للتعديل
      await run(`
        INSERT INTO material_domain_events (
          event_id, event_name, aggregate_type, aggregate_id, 
          payload, user_id, user_name, timestamp, prev_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        eventId, eventName, aggregateType, String(aggregateId),
        payloadStr, userId, userName, timestamp, prevHash, eventHash
      ]);

      const domainEvent = {
        eventId,
        eventName,
        aggregateType,
        aggregateId,
        payload,
        userId,
        userName,
        timestamp,
        prevHash,
        eventHash
      };

      // 4. إطلاق الحدث للمستمعين المتزامنين وغير المتزامنين
      this.emit('domainEvent', domainEvent);
      this.emit(eventName, domainEvent);

      return domainEvent;
    } catch (err) {
      console.error(`⚠️ [MaterialEventBus] Failed to persist event [${eventName}]:`, err.message);
      // لا نوقف العملية ولكن نطلق الحدث محلياً
      const fallbackEvent = { eventId, eventName, aggregateType, aggregateId, payload, timestamp };
      this.emit(eventName, fallbackEvent);
      return fallbackEvent;
    }
  }

  /**
   * جلب سجل أحداث كيان معين مرتبة زمنياً
   */
  async getAggregateHistory(aggregateType, aggregateId) {
    return await query(`
      SELECT * FROM material_domain_events 
      WHERE aggregate_type = ? AND aggregate_id = ?
      ORDER BY id ASC
    `, [aggregateType, String(aggregateId)]);
  }

  /**
   * جلب أحدث الأحداث العامة
   */
  async getRecentEvents(limit = 50) {
    return await query(`
      SELECT * FROM material_domain_events 
      ORDER BY id DESC LIMIT ?
    `, [limit]);
  }

  /**
   * التحقق الرياضي والمشفر من سلامة سلسلة الأحداث وعدم التلاعب بها
   */
  async verifyChainIntegrity() {
    const events = await query('SELECT * FROM material_domain_events ORDER BY id ASC');
    if (!events || events.length === 0) {
      return { isValid: true, message: 'سلسلة الأحداث فارغة، لا يوجد تلاعب.', verifiedCount: 0 };
    }

    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];

      // فحص ترابط الهاش السابق
      if (evt.prev_hash !== expectedPrevHash) {
        return {
          isValid: false,
          error: `انقطاع في سلسلة التدقيق عند الحدث رقم #${evt.id} (${evt.event_id}). الهاش السابق المسجل لا يطابق الهاش المتوقع.`,
          corruptedEventId: evt.event_id,
          expectedPrevHash,
          actualPrevHash: evt.prev_hash
        };
      }

      // فحص صحة تجزئة الحدث الحالي
      const computedHash = this.computeEventHash(
        evt.prev_hash,
        evt.event_name,
        evt.aggregate_id,
        evt.payload,
        evt.timestamp
      );

      if (computedHash !== evt.event_hash) {
        return {
          isValid: false,
          error: `تم اكتشاف تلاعب في محتوى الحدث رقم #${evt.id} (${evt.event_id}). الهاش المحسوب لا يطابق الهاش المخزن.`,
          corruptedEventId: evt.event_id,
          computedHash,
          storedHash: evt.event_hash
        };
      }

      expectedPrevHash = evt.event_hash;
    }

    return {
      isValid: true,
      message: 'سلسلة التدقيق المشفرة سليمة بنسبة 100%، وتم التحقق من كافة التوقيعات.',
      verifiedCount: events.length,
      latestHash: expectedPrevHash
    };
  }
}

// تصدير كائن أحادي (Singleton)
const materialDomainEventBus = new MaterialDomainEventBus();
module.exports = materialDomainEventBus;

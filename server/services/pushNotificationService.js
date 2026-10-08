/**
 * خدمة إشعارات الهواتف الذكية وبوابة العملاء (Push Notifications Service)
 * تدعم Firebase Cloud Messaging (FCM) + قاعدة البيانات المحلية
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 */

const db = require('../database/db');

class PushNotificationService {
  constructor() {
    this.fcmEnabled = false;
    this.initFcm();
  }

  initFcm() {
    // التحقق من وجود مفتاح Firebase Cloud Messaging
    const fcmServerKey = process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY;
    if (fcmServerKey) {
      this.fcmServerKey = fcmServerKey;
      this.fcmEnabled = true;
      console.log('🔔 [Push Notifications] FCM Server Key configured and active.');
    } else {
      console.log('ℹ️ [Push Notifications] Running in in-app notification mode (FCM Key not provided in .env).');
    }
  }

  /**
   * تسجيل أو تحديث رمز جهاز العميل (Device Token)
   */
  async registerDevice(clientUserId, deviceToken, platform = 'android') {
    if (!clientUserId || !deviceToken) return false;
    try {
      await db.run(`
        UPDATE client_users 
        SET device_token = ?, device_platform = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [deviceToken, platform, clientUserId]);
      return true;
    } catch (err) {
      console.error('Error registering client device token:', err);
      return false;
    }
  }

  /**
   * إرسال إشعار لمستخدم عميل محدد
   */
  async sendToClientUser(clientUserId, notification) {
    const {
      title,
      body,
      type = 'alert',
      projectId = null,
      referenceType = null,
      referenceId = null,
      data = {}
    } = notification;

    if (!clientUserId || !title || !body) return null;

    try {
      // 1. تسجيل الإشعار في قاعدة البيانات دائماً
      const insertResult = await db.run(`
        INSERT INTO client_notifications 
        (client_user_id, project_id, type, title, body, reference_type, reference_id, is_read, sent_via_push, sent_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        clientUserId,
        projectId,
        type,
        title,
        body,
        referenceType,
        referenceId
      ]);

      const notificationId = insertResult.lastID || insertResult.lastInsertRowid;

      // 2. محاولة إرسال Push Notification للهاتف إذا كان هناك رمز جهاز مسجل
      const user = await db.get(`SELECT device_token, device_platform FROM client_users WHERE id = ?`, [clientUserId]);
      if (user && user.device_token && this.fcmEnabled) {
        await this.dispatchFcmPush(user.device_token, {
          title,
          body,
          data: {
            ...data,
            notificationId: String(notificationId),
            type,
            projectId: String(projectId || ''),
            referenceType: String(referenceType || ''),
            referenceId: String(referenceId || '')
          }
        });

        await db.run(`UPDATE client_notifications SET sent_via_push = 1 WHERE id = ?`, [notificationId]);
      }

      return { success: true, notificationId };
    } catch (err) {
      console.error('Failed to send push notification to client user:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * إرسال إشعار لجميع مستخدمي العميل المرتبطين بمشروع محدد
   */
  async sendToProjectClients(projectId, notification) {
    try {
      // جلب معرف العميل للمشروع
      const project = await db.get(`SELECT id, client_id, name FROM projects WHERE id = ?`, [projectId]);
      if (!project || !project.client_id) return [];

      // جلب جميع مستخدمي هذا العميل المصرح لهم بالوصول
      const users = await db.query(`
        SELECT id FROM client_users 
        WHERE client_id = ? AND status = 'active'
      `, [project.client_id]);

      const results = [];
      for (const u of users) {
        const res = await this.sendToClientUser(u.id, {
          ...notification,
          projectId: project.id
        });
        results.push(res);
      }
      return results;
    } catch (err) {
      console.error('Failed to send push notification to project clients:', err);
      return [];
    }
  }

  /**
   * إرسال الإشعار عبر FCM HTTP v1 / Legacy
   */
  async dispatchFcmPush(token, payload) {
    if (!this.fcmServerKey) return false;
    try {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${this.fcmServerKey}`
        },
        body: JSON.stringify({
          to: token,
          notification: {
            title: payload.title,
            body: payload.body,
            sound: 'default'
          },
          data: payload.data || {},
          priority: 'high'
        })
      });

      const resJson = await response.json();
      return Boolean(resJson.success);
    } catch (err) {
      console.warn('FCM Dispatch warning:', err.message);
      return false;
    }
  }
}

module.exports = new PushNotificationService();

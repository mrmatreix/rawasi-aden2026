/**
 * =========================================================================
 * contractAlertsService.js
 * محرك التنبيهات الذكية للعقود والمشاريع (Smart Contract Alerts Engine)
 * لشركة رواسي عدن للهندسة والمقاولات
 *
 * يغطي الأنواع الخمسة الإلزامية:
 * 1. تنبيه انتهاء العقد (expiry: 90 يوم info / 30 يوم warning / 7 أيام critical).
 * 2. تنبيه موعد المستخلص الدوري (ipc_due: بناءً على دورة الـ 30 يوماً وتغير POC).
 * 3. تنبيه استحقاق واسترداد الدفعة المقدمة (advance_payment: الرصيد وحسم النسبة).
 * 4. تنبيه استحقاق محتجزات الضمان (retention_due: بعد انتهاء فترة الصيانة DLP).
 * 5. تنبيه غرامات التأخير (penalty: احتساب غرامة اليوم وسقف النسبة المئوية).
 * =========================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const { get, query, run, transaction } = require('../database/db');

class ContractAlertsEmitter extends EventEmitter {}
const alertEvents = new ContractAlertsEmitter();

class ContractAlertsService {
  /**
   * تشغيل الفحص الشامل وتوليد كافة التنبيهات الذكية
   */
  static async scanAndGenerateAlerts() {
    return await transaction(async (tx) => {
      let createdCount = 0;
      const today = new Date().toISOString().split('T')[0];

      const contracts = await tx.query(`
        SELECT c.*, p.name as project_name, p.progress_percentage as project_progress,
               p.actual_cost as project_actual_cost
        FROM project_contracts c
        LEFT JOIN projects p ON c.project_id = p.id
        WHERE c.status NOT IN ('closed', 'cancelled')
      `);

      for (const contract of contracts) {
        const cId = contract.id;
        const pId = contract.project_id;
        const contractVal = Number(contract.contract_value || 0);

        // -------------------------------------------------------------
        // 1. تنبيه انتهاء العقد (expiry)
        // -------------------------------------------------------------
        if (contract.end_date) {
          const endDate = new Date(contract.end_date);
          const nowDate = new Date(today);
          const diffDays = Math.ceil((endDate - nowDate) / (1000 * 60 * 60 * 24));

          let severity = null;
          if (diffDays <= 7) severity = 'critical';
          else if (diffDays <= 30) severity = 'warning';
          else if (diffDays <= 90) severity = 'info';

          if (severity) {
            const desc = diffDays < 0
              ? `العقد منتهٍ منذ [${Math.abs(diffDays)}] يوماً ولم يتم إغلاقه أو تمديده رسمياً`
              : `العقد ينتهي خلال [${diffDays}] يوماً (تاريخ الانتهاء: ${contract.end_date})`;

            const inserted = await this._upsertAlert(tx, {
              contract_id: cId,
              project_id: pId,
              alert_type: 'expiry',
              severity,
              trigger_date: today,
              alert_date: today,
              amount_at_risk: contractVal,
              description: desc
            });
            if (inserted) createdCount++;
          }
        }

        // -------------------------------------------------------------
        // 2. تنبيه موعد المستخلص الدوري (ipc_due)
        // -------------------------------------------------------------
        const cycleDays = Number(contract.ipc_cycle_days || 30);
        const lastBill = await tx.get(`
          SELECT date, bill_no, created_at 
          FROM bills 
          WHERE project_id = ? AND status != 'cancelled'
          ORDER BY date DESC, id DESC LIMIT 1
        `, [pId]);

        let daysSinceLastBill = 999;
        if (lastBill && lastBill.date) {
          const lDate = new Date(lastBill.date);
          daysSinceLastBill = Math.ceil((new Date(today) - lDate) / (1000 * 60 * 60 * 24));
        } else if (contract.start_date) {
          const sDate = new Date(contract.start_date);
          daysSinceLastBill = Math.ceil((new Date(today) - sDate) / (1000 * 60 * 60 * 24));
        }

        // فحص وجود تكاليف أو إنجاز غير مفوتر
        const unbilledProgress = Number(contract.project_progress || 0);
        if (daysSinceLastBill >= cycleDays && unbilledProgress > 0) {
          const sev = daysSinceLastBill > (cycleDays + 15) ? 'critical' : 'warning';
          const inserted = await this._upsertAlert(tx, {
            contract_id: cId,
            project_id: pId,
            alert_type: 'ipc_due',
            severity: sev,
            trigger_date: today,
            alert_date: today,
            amount_at_risk: Math.round(contractVal * 0.15 * 100) / 100, // مستخلص تقديري 15%
            description: `استحقاق إصدار مستخلص دوري (مضى ${daysSinceLastBill} يوماً على آخر مستخلص مع وجود إنجاز بنسبة ${unbilledProgress}%)`
          });
          if (inserted) createdCount++;
        }

        // -------------------------------------------------------------
        // 3. تنبيه الدفعة المقدمة (advance_payment)
        // -------------------------------------------------------------
        const advPct = Number(contract.advance_payment_pct || 0);
        const advTotal = Number(contract.advance_payment_amount || (contractVal * (advPct / 100)));

        if (advTotal > 0) {
          const amortizedRes = await tx.get(`
            SELECT COALESCE(SUM(advance_deduction), 0) as total_deducted 
            FROM bills 
            WHERE project_id = ? AND status != 'cancelled'
          `, [pId]);
          const totalAmortized = Number(amortizedRes?.total_deducted || 0);
          const remainingAdvance = Math.max(0, advTotal - totalAmortized);

          if (remainingAdvance > 0) {
            const inserted = await this._upsertAlert(tx, {
              contract_id: cId,
              project_id: pId,
              alert_type: 'advance_payment',
              severity: 'info',
              trigger_date: today,
              alert_date: today,
              amount_at_risk: Math.round(remainingAdvance * 100) / 100,
              description: `رصيد دفعة مقدمة قيد الاسترداد بمبلغ (${Math.round(remainingAdvance).toLocaleString()} ${contract.currency || 'USD'}) - يجب حسم ${advPct}% من المستخلص القادم`
            });
            if (inserted) createdCount++;
          }
        }

        // -------------------------------------------------------------
        // 4. تنبيه المحتجزات والضمانات (retention_due)
        // -------------------------------------------------------------
        const retentionPct = Number(contract.retention_pct || 10);
        const retDeductedRes = await tx.get(`
          SELECT COALESCE(SUM(retention_deduction), 0) as total_ret 
          FROM bills 
          WHERE project_id = ? AND status != 'cancelled'
        `, [pId]);
        const totalRetention = Number(retDeductedRes?.total_ret || (contractVal * (retentionPct / 100)));

        if (totalRetention > 0) {
          let isDue = false;
          let retSev = 'info';
          if (contract.retention_due_date) {
            const rDate = new Date(contract.retention_due_date);
            const rDiff = Math.ceil((rDate - new Date(today)) / (1000 * 60 * 60 * 24));
            if (rDiff <= 0) {
              isDue = true;
              retSev = 'critical';
            } else if (rDiff <= 30) {
              isDue = true;
              retSev = 'warning';
            }
          }

          if (isDue) {
            const inserted = await this._upsertAlert(tx, {
              contract_id: cId,
              project_id: pId,
              alert_type: 'retention_due',
              severity: retSev,
              trigger_date: today,
              alert_date: today,
              amount_at_risk: Math.round(totalRetention * 100) / 100,
              description: `استحقاق الإفراج عن محتجز الضمان النهائي (Retention Release) بمبلغ (${Math.round(totalRetention).toLocaleString()} ${contract.currency || 'USD'}) لانقضاء فترة الصيانة DLP`
            });
            if (inserted) createdCount++;
          }
        }

        // -------------------------------------------------------------
        // 5. تنبيه غرامات التأخير (penalty)
        // -------------------------------------------------------------
        if (contract.end_date) {
          const endDate = new Date(contract.end_date);
          const nowDate = new Date(today);
          const daysOverdue = Math.ceil((nowDate - endDate) / (1000 * 60 * 60 * 24));

          if (daysOverdue > 0 && Number(contract.project_progress || 0) < 100) {
            const penaltyPerDay = Number(contract.penalty_per_day || (contractVal * 0.001)); // 0.1% باليوم كقيمة افتراضية
            const maxPenaltyPct = Number(contract.max_penalty_pct || 10);
            const maxPenaltyAmount = contractVal * (maxPenaltyPct / 100);

            const calculatedPenalty = Math.min(daysOverdue * penaltyPerDay, maxPenaltyAmount);
            const penSev = calculatedPenalty >= maxPenaltyAmount ? 'critical' : 'warning';

            const inserted = await this._upsertAlert(tx, {
              contract_id: cId,
              project_id: pId,
              alert_type: 'penalty',
              severity: penSev,
              trigger_date: today,
              alert_date: today,
              amount_at_risk: Math.round(calculatedPenalty * 100) / 100,
              description: `تأخير في تسليم المشروع بمقدار [${daysOverdue}] يوماً - إجمالي غرامة التأخير المستحقة التعاقدية: (${Math.round(calculatedPenalty).toLocaleString()} ${contract.currency || 'USD'})`
            });
            if (inserted) createdCount++;
          }
        }
      }

      return {
        success: true,
        scanned_contracts: contracts.length,
        new_alerts_created: createdCount,
        timestamp: new Date().toISOString()
      };
    });
  }

  /**
   * فحص وإدراج التنبيه دون تكرار التنبيهات المعلقة النشطة
   */
  static async _upsertAlert(tx, alertData) {
    const existing = await tx.get(`
      SELECT id, severity, description 
      FROM contract_alerts 
      WHERE contract_id = ? AND alert_type = ? AND status = 'pending'
    `, [alertData.contract_id, alertData.alert_type]);

    if (existing) {
      // تحديث الخطورة والمبلغ إن تغيرت
      await tx.run(`
        UPDATE contract_alerts 
        SET severity = ?, amount_at_risk = ?, description = ?, alert_date = ? 
        WHERE id = ?
      `, [alertData.severity, alertData.amount_at_risk, alertData.description, alertData.alert_date, existing.id]);
      return false;
    }

    await tx.run(`
      INSERT INTO contract_alerts (
        contract_id, project_id, alert_type, severity, trigger_date,
        alert_date, amount_at_risk, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      alertData.contract_id,
      alertData.project_id,
      alertData.alert_type,
      alertData.severity,
      alertData.trigger_date,
      alertData.alert_date,
      alertData.amount_at_risk,
      alertData.description
    ]);

    // بث الإشعار الفوري للمشتركين
    alertEvents.emit('new_alert', {
      type: alertData.alert_type,
      severity: alertData.severity,
      description: alertData.description,
      amount: alertData.amount_at_risk,
      timestamp: new Date().toISOString()
    });

    return true;
  }

  /**
   * جلب تنبيهات عقد محدد
   */
  static async getContractAlerts(contractId) {
    const cId = Number(contractId);
    const alerts = await query(`
      SELECT ca.*, p.name as project_name 
      FROM contract_alerts ca
      LEFT JOIN projects p ON ca.project_id = p.id
      WHERE ca.contract_id = ?
      ORDER BY 
        CASE ca.severity 
          WHEN 'critical' THEN 1 
          WHEN 'warning' THEN 2 
          ELSE 3 
        END ASC, ca.id DESC
    `, [cId]);

    return {
      success: true,
      contract_id: cId,
      total_alerts: alerts.length,
      alerts
    };
  }

  /**
   * إقرار ومتابعة التنبيه (Acknowledge Alert)
   */
  static async acknowledgeAlert(alertId, user = {}, notes = '') {
    const aId = Number(alertId);
    const alert = await get('SELECT * FROM contract_alerts WHERE id = ?', [aId]);
    if (!alert) throw new Error('التنبيه غير موجود');

    const userName = user.username || user.full_name || 'SYSTEM_ACK';
    await run(`
      UPDATE contract_alerts 
      SET status = 'acknowledged', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [userName, aId]);

    return {
      success: true,
      alert_id: aId,
      status: 'acknowledged',
      acknowledged_by: userName,
      message: 'تم الإقرار بالتنبيه واعتماد متابعته بنجاح'
    };
  }

  /**
   * حل التنبيه نهائياً (Resolve Alert)
   */
  static async resolveAlert(alertId, user = {}) {
    const aId = Number(alertId);
    const userName = user.username || user.full_name || 'SYSTEM_RESOLVER';
    await run(`
      UPDATE contract_alerts 
      SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [userName, aId]);

    return {
      success: true,
      alert_id: aId,
      status: 'resolved',
      resolved_by: userName,
      message: 'تم حل ومعالجة التنبيه بنجاح'
    };
  }

  /**
   * لوحة ملخص التنبيهات للشركة بأكملها (Alerts Dashboard)
   */
  static async getAlertsDashboard(filters = {}) {
    let whereSql = ` WHERE 1=1 `;
    const params = [];

    if (filters.status) {
      whereSql += ` AND ca.status = ? `;
      params.push(filters.status);
    } else {
      whereSql += ` AND ca.status IN ('pending', 'acknowledged') `;
    }

    if (filters.severity) {
      whereSql += ` AND ca.severity = ? `;
      params.push(filters.severity);
    }

    if (filters.alert_type) {
      whereSql += ` AND ca.alert_type = ? `;
      params.push(filters.alert_type);
    }

    if (filters.project_id) {
      whereSql += ` AND ca.project_id = ? `;
      params.push(Number(filters.project_id));
    }

    const alerts = await query(`
      SELECT ca.*, c.contract_no, c.title as contract_title,
             p.name as project_name, p.code as project_code
      FROM contract_alerts ca
      LEFT JOIN project_contracts c ON ca.contract_id = c.id
      LEFT JOIN projects p ON ca.project_id = p.id
      ${whereSql}
      ORDER BY 
        CASE ca.severity 
          WHEN 'critical' THEN 1 
          WHEN 'warning' THEN 2 
          ELSE 3 
        END ASC, ca.id DESC
    `, params);

    // إحصائيات الخطورة
    let criticalCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let totalRiskAmount = 0;

    alerts.forEach(a => {
      if (a.severity === 'critical') criticalCount++;
      else if (a.severity === 'warning') warningCount++;
      else if (a.severity === 'info') infoCount++;
      totalRiskAmount += Number(a.amount_at_risk || 0);
    });

    return {
      success: true,
      summary: {
        total_active_alerts: alerts.length,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        total_amount_at_risk: Math.round(totalRiskAmount * 100) / 100
      },
      alerts
    };
  }

  /**
   * تشغيل الجدولة اليومية التلقائية لفحص التنبيهات
   */
  static startDailyAlertScheduler() {
    // تشغيل فحص فوري عند بدء السيرفر
    this.scanAndGenerateAlerts().catch(e => console.warn('Alert scan initial check note:', e.message));

    // جدولة يومية كل 24 ساعة (أو فحص دوري كل 6 ساعات)
    const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 ساعات
    const timer = setInterval(() => {
      this.scanAndGenerateAlerts()
        .then(r => console.log(`🛡️ [ContractAlertsScheduler] فحص التنبيهات الدوري: تم بنجاح (${r.new_alerts_created} تنبيه جديد)`))
        .catch(e => console.error('❌ [ContractAlertsScheduler] خطأ أثناء فحص التنبيهات:', e.message));
    }, INTERVAL_MS);

    timer.unref();
    console.log('⏰ [ContractAlertsScheduler] تم تفعيل مراقب تنبيهات العقود الذكي الدوري (كل 6 ساعات).');
  }

  /**
   * الحصول على مرسل الأحداث الفورية
   */
  static getEventBus() {
    return alertEvents;
  }

  /**
   * ربط خادم WebSocket الأصلي (RFC 6455) بالخادم الرئيسي بدون أي حزم خارجية
   */
  static attachWebSocket(server) {
    if (!server || this._wsAttached) return;
    this._wsAttached = true;
    const clients = new Set();

    server.on('upgrade', (req, socket, head) => {
      const url = req.url ? req.url.split('?')[0] : '';
      const validPaths = ['/ws/alerts', '/ws/contracts', '/ws', '/alerts/ws'];
      if (!validPaths.some(p => url === p || url === p + '/')) {
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`
      ];

      // إذا كان العميل يطلب بروتوكولاً محدداً
      const requestedProtocols = req.headers['sec-websocket-protocol'];
      if (requestedProtocols) {
        const first = requestedProtocols.split(',')[0].trim();
        responseHeaders.push(`Sec-WebSocket-Protocol: ${first}`);
      }

      // إرسال ترويسات التبديل
      socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
      clients.add(socket);

      // الاستماع للبيانات الواردة من العميل (Masked Frames & Ping/Pong/Close)
      socket.on('data', (buffer) => {
        try {
          let offset = 0;
          while (offset < buffer.length) {
            if (offset + 2 > buffer.length) break;
            const firstByte = buffer[offset];
            const secondByte = buffer[offset + 1];

            const opcode = firstByte & 0x0F;
            const isMasked = (secondByte & 0x80) === 0x80;
            let payloadLen = secondByte & 0x7F;
            offset += 2;

            if (payloadLen === 126) {
              if (offset + 2 > buffer.length) break;
              payloadLen = buffer.readUInt16BE(offset);
              offset += 2;
            } else if (payloadLen === 127) {
              if (offset + 8 > buffer.length) break;
              payloadLen = Number(buffer.readBigUInt64BE(offset));
              offset += 8;
            }

            let maskKey = null;
            if (isMasked) {
              if (offset + 4 > buffer.length) break;
              maskKey = buffer.slice(offset, offset + 4);
              offset += 4;
            }

            if (offset + payloadLen > buffer.length) break;
            let payload = buffer.slice(offset, offset + payloadLen);
            offset += payloadLen;

            if (isMasked && maskKey) {
              const unmasked = Buffer.alloc(payload.length);
              for (let i = 0; i < payload.length; i++) {
                unmasked[i] = payload[i] ^ maskKey[i % 4];
              }
              payload = unmasked;
            }

            // 1. إطار الإغلاق Close Frame (0x8)
            if (opcode === 0x8) {
              const closeFrame = Buffer.from([0x88, 0x00]);
              if (socket.writable) socket.write(closeFrame);
              clients.delete(socket);
              socket.end();
              return;
            }

            // 2. إطار فحص النبض Ping (0x9) -> الرد بـ Pong (0xA)
            if (opcode === 0x9) {
              const pongHeader = Buffer.from([0x8A, payload.length]);
              if (socket.writable) socket.write(Buffer.concat([pongHeader, payload]));
              return;
            }

            // 3. إطار Pong (0xA)
            if (opcode === 0xA) {
              continue;
            }

            // 4. إطار نصي عادي Text Frame (0x1)
            if (opcode === 0x1) {
              const msgStr = payload.toString('utf8');
              try {
                const parsed = JSON.parse(msgStr);
                if (parsed.type === 'ping' || parsed.action === 'ping') {
                  const pongFrame = ContractAlertsService._encodeWsFrame({ type: 'PONG', timestamp: Date.now() });
                  if (socket.writable) socket.write(pongFrame);
                }
              } catch {}
            }
          }
        } catch (err) {
          console.warn('[ContractAlertsWebSocket] Warning parsing frame:', err.message);
        }
      });

      socket.on('close', () => clients.delete(socket));
      socket.on('error', () => {
        clients.delete(socket);
        socket.destroy();
      });

      // إرسال رسالة الترحيب بعد تدفق الـ Handshake بنجاح
      setImmediate(() => {
        if (socket.writable) {
          const welcomeFrame = ContractAlertsService._encodeWsFrame({
            type: 'CONNECTED',
            status: 'online',
            message: 'نظام شركة رواسي عدن - تم الاتصال بخادم التنبيهات الفورية (WebSocket) بنجاح 🟢',
            timestamp: new Date().toISOString()
          });
          socket.write(welcomeFrame);
        }
      });
    });

    // بث أي تنبيه تعاقدي جديد لجميع المتصلين فورياً
    alertEvents.on('alert', (alertData) => {
      const frame = ContractAlertsService._encodeWsFrame({ type: 'ALERT', alert: alertData });
      for (const client of clients) {
        if (client.writable) {
          try { client.write(frame); } catch {}
        }
      }
    });

    console.log('⚡ [ContractAlertsWebSocket] تم تفعيل خادم الإشعارات الفورية عبر WebSocket الأصلي (/ws/alerts).');
  }

  static _encodeWsFrame(data) {
    const payload = Buffer.from(JSON.stringify(data), 'utf8');
    const length = payload.length;
    let header;
    if (length <= 125) {
      header = Buffer.from([0x81, length]);
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    return Buffer.concat([header, payload]);
  }
}

module.exports = ContractAlertsService;

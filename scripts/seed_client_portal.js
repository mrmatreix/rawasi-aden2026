/**
 * بيانات تجريبية أولية لبوابة وتطبيق العملاء (Client Portal Seeder)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 */

const bcrypt = require('bcryptjs');
const db = require('../server/database/db');

async function seedClientPortal() {
  console.log('🚀 [Client Portal Seeder] Starting initialization...');

  try {
    // 1. إنشاء أو التأكد من وجود عميل معتمد
    let client = await db.get("SELECT id FROM clients WHERE email = 'contact@manara.com' OR name LIKE '%المنارة%'");
    let clientId;

    if (!client) {
      const res = await db.run(`
        INSERT INTO clients (name, company, phone, email, address, previous_balance, total_paid, total_due, current_balance, notes)
        VALUES ('شركة المنارة للاستثمار والتطوير العقاري', 'مجموعة المنارة القابضة', '777123456', 'contact@manara.com', 'عدن - المنصورة - شارع التسعين', 0, 45000000, 150000000, 105000000, 'عميل VIP معتمد لمشروع الأبراج السكنية')
      `);
      clientId = res.lastID || res.lastInsertRowid;
      console.log(`✅ Client created with ID: ${clientId}`);
    } else {
      clientId = client.id;
      console.log(`ℹ️ Client already exists with ID: ${clientId}`);
    }

    // 2. إنشاء مشروع هندسي للعميل
    let project = await db.get("SELECT id FROM projects WHERE client_id = ?", [clientId]);
    let projectId;

    if (!project) {
      const pRes = await db.run(`
        INSERT INTO projects (code, name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, expected_profit, actual_profit, status, start_date, end_date, notes)
        VALUES ('PRJ-MNR-01', 'مشروع برج المنارة السكني والتجاري (14 طابق)', ?, 150000000, 120000000, 52000000, 42.5, 30000000, 14000000, 'active', '2026-01-15', '2026-12-30', 'تنفيذ أعمال الأساسات والهيكل الخرساني والتشطيبات الأولية')
      `, [clientId]);
      projectId = pRes.lastID || pRes.lastInsertRowid;
      console.log(`✅ Project created with ID: ${projectId}`);
    } else {
      projectId = project.id;
      console.log(`ℹ️ Project exists with ID: ${projectId}`);
    }

    // 3. إنشاء عقد المشروع
    const existingContract = await db.get("SELECT id FROM project_contracts WHERE project_id = ?", [projectId]);
    if (!existingContract) {
      await db.run(`
        INSERT INTO project_contracts (project_id, client_id, contract_no, contract_date, start_date, end_date, duration_days, contract_value, advance_payment_pct, advance_payment_amount, retention_pct, notes)
        VALUES (?, ?, 'CON-MNR-2026-01', '2026-01-10', '2026-01-15', '2026-12-30', 350, 150000000, 10, 15000000, 5, 'عقد تنفيذ أعمال مقاولات متكاملة بنظام تسليم مفتاح')
      `, [projectId, clientId]);
      console.log('✅ Contract created');
    }

    // 4. إنشاء مستخدم بوابة العميل (Login Credentials)
    const existingUser = await db.get("SELECT id FROM client_users WHERE email = 'client@manara.com'");
    let clientUserId;

    if (!existingUser) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync('Client@123456', salt);

      const uRes = await db.run(`
        INSERT INTO client_users (client_id, email, phone, password_hash, full_name, role, status, two_factor_enabled, two_factor_pin, created_at)
        VALUES (?, 'client@manara.com', '777123456', ?, 'م. أحمد صالح المنارة', 'owner', 'active', 1, '123456', CURRENT_TIMESTAMP)
      `, [clientId, hash]);

      clientUserId = uRes.lastID || uRes.lastInsertRowid;
      console.log(`✅ Client User created with ID: ${clientUserId} (Email: client@manara.com, Pass: Client@123456, PIN: 123456)`);
    } else {
      clientUserId = existingUser.id;
      console.log(`ℹ️ Client User exists with ID: ${clientUserId}`);
    }

    // 5. منح صلاحيات الوصول للمشروع
    const existingAccess = await db.get("SELECT id FROM client_project_access WHERE client_user_id = ? AND project_id = ?", [clientUserId, projectId]);
    if (!existingAccess) {
      await db.run(`
        INSERT INTO client_project_access 
        (client_user_id, project_id, can_view_progress, can_view_invoices, can_view_payments, can_view_reports, can_view_drawings, can_approve_invoices, can_send_messages, granted_by)
        VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 1)
      `, [clientUserId, projectId]);
      console.log('✅ Project Access granted');
    }

    // 6. إضافة مستخلصين تجريبيين (واحد معتمد وواحد بانتظار الاعتماد)
    const billsCount = await db.get("SELECT COUNT(id) AS count FROM bills WHERE project_id = ?", [projectId]);
    if (!billsCount || billsCount.count === 0) {
      await db.run(`
        INSERT INTO bills (bill_no, bill_type, project_id, client_id, amount, gross_amount, deduction, advance_deduction, retention_deduction, net_amount, paid_amount, remaining_amount, payment_status, status, client_approval_status, client_approved_at, client_approval_notes, date)
        VALUES 
        ('IPC-MNR-01', 'مستخلص جاري رقم 1', ?, ?, 35000000, 35000000, 3500000, 1750000, 1750000, 31500000, 31500000, 0, 'paid', 'معتمد', 'approved', '2026-03-01 10:00:00', 'تم اعتماد أعمال الأساسات والحفريات والصبة الخرسانية المسلحة للقواعد', '2026-02-28'),
        ('IPC-MNR-02', 'مستخلص جاري رقم 2', ?, ?, 28000000, 28000000, 2800000, 1400000, 1400000, 25200000, 13500000, 11700000, 'partially_paid', 'معتمد', 'pending', NULL, NULL, '2026-04-15')
      `, [projectId, clientId, projectId, clientId]);
      console.log('✅ Invoices (IPCs) seeded');
    }

    // 7. إضافة سندات قبض للدفعات المسددة
    const paymentsCount = await db.get("SELECT COUNT(id) AS count FROM payments WHERE project_id = ? AND client_id = ?", [projectId, clientId]);
    if (!paymentsCount || paymentsCount.count === 0) {
      await db.run(`
        INSERT INTO payments (receipt_no, type, client_id, project_id, amount, currency, payment_method, bank_name, check_no, receipt_category, status, date, notes)
        VALUES 
        ('REC-MNR-001', 'قبض', ?, ?, 15000000, 'ر.ي', 'تحويل بنكي', 'بنك القطيبي الإسلامي', 'TRX-998811', 'advance_payment', 'posted', '2026-01-20', 'سداد الدفعة المقدمة لمشروع برج المنارة (10%)'),
        ('REC-MNR-002', 'قبض', ?, ?, 30000000, 'ر.ي', 'شيك', 'بنك التضامن', 'CHK-450091', 'bill_collection', 'posted', '2026-03-05', 'سداد قيمة المستخلص الجاري رقم 1 كاملاً')
      `, [clientId, projectId, clientId, projectId]);
      console.log('✅ Payments (Receipt Vouchers) seeded');
    }

    // 8. إضافة إشعار أولي ورسالة ترحيب
    const notifCount = await db.get("SELECT COUNT(id) AS count FROM client_notifications WHERE client_user_id = ?", [clientUserId]);
    if (!notifCount || notifCount.count === 0) {
      await db.run(`
        INSERT INTO client_notifications (client_user_id, project_id, type, title, body, reference_type, reference_id, is_read, created_at)
        VALUES 
        (?, ?, 'ipc_issued', 'مستخلص جديد بانتظار اعتمادك (IPC-MNR-02)', 'تم رفع المستخلص الجاري رقم 2 لمشروع برج المنارة بقيمة صافية 25,200,000 ر.ي، يرجى المراجعة والاعتماد.', 'invoice', 2, 0, CURRENT_TIMESTAMP),
        (?, ?, 'payment_received', 'تم تأكيد استلام دفعة مالية', 'تم قيد سند القبض رقم REC-MNR-002 بقيمة 30,000,000 ر.ي في حساب مشروعكم.', 'payment', 2, 0, CURRENT_TIMESTAMP)
      `, [clientUserId, projectId, clientUserId, projectId]);

      await db.run(`
        INSERT INTO client_messages (client_user_id, project_id, direction, subject, body, priority, status, reply_body, replied_at, created_at)
        VALUES (?, ?, 'outgoing', 'طلب تزويدنا بالمخططات التفصيلية للطابق السادس', 'نرجو من الفريق الهندسي تزويدنا بمخططات التوزيع المعماري المعتمدة للطابق المتكرر.', 'normal', 'replied', 'أهلاً بك مهندس أحمد، تم رفع المخطط المحدث في تبويب المخططات وهو متاح للاطلاع والتحميل.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [clientUserId, projectId]);

      console.log('✅ Notifications and Messages seeded');
    }

    console.log('🎉 [Client Portal Seeder] Completed successfully!');
    return true;
  } catch (err) {
    console.error('❌ Seeder Error:', err);
    throw err;
  }
}

if (require.main === module) {
  seedClientPortal().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = seedClientPortal;

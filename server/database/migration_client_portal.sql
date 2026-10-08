-- =========================================================================
-- migration_client_portal.sql
-- نظام رواسي عدن للهندسة والمقاولات
-- ترقية بوابة وتطبيق العملاء المخصص (Client Portal & Mobile App)
-- متوافق بالكامل مع محركي SQLite و MySQL
-- المبدأ الحاكم: Deny by Default (عزل تام للبيانات المالية الداخلية)
-- =========================================================================

-- 1. جدول مستخدمي بوابة العملاء (Client Users)
CREATE TABLE IF NOT EXISTS client_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  phone VARCHAR(50),
  password_hash TEXT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role VARCHAR(30) DEFAULT 'viewer', -- owner (مالك), manager (مدير ممثل), viewer (مطلع فقط)
  permissions TEXT DEFAULT '{"view_projects":true,"view_invoices":true,"view_payments":true,"approve_invoices":false,"send_messages":true}',
  status VARCHAR(20) DEFAULT 'active', -- active (نشط), inactive (معطل), suspended (موقوف)
  two_factor_enabled INTEGER DEFAULT 1,
  two_factor_pin VARCHAR(20) DEFAULT '123456',
  otp_code VARCHAR(10),
  otp_expires_at DATETIME,
  last_login_at DATETIME,
  last_login_ip VARCHAR(50),
  device_token TEXT,
  device_platform VARCHAR(20), -- android, ios, web
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cu_client_id ON client_users(client_id);
CREATE INDEX IF NOT EXISTS idx_cu_email ON client_users(email);
CREATE INDEX IF NOT EXISTS idx_cu_status ON client_users(status);

-- 2. جدول صلاحيات وصول مستخدمي العميل للمشاريع (Client Project Access)
CREATE TABLE IF NOT EXISTS client_project_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  can_view_progress INTEGER DEFAULT 1,
  can_view_invoices INTEGER DEFAULT 1,
  can_view_payments INTEGER DEFAULT 1,
  can_view_reports INTEGER DEFAULT 1,
  can_view_drawings INTEGER DEFAULT 1,
  can_view_correspondence INTEGER DEFAULT 1,
  can_approve_invoices INTEGER DEFAULT 0,
  can_send_messages INTEGER DEFAULT 1,
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  granted_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_user_id, project_id),
  FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cpa_user_proj ON client_project_access(client_user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_cpa_project ON client_project_access(project_id);

-- 3. جدول إشعارات العملاء (Client Notifications)
CREATE TABLE IF NOT EXISTS client_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_user_id INTEGER NOT NULL,
  project_id INTEGER,
  type VARCHAR(50) NOT NULL, -- ipc_issued, payment_received, report_submitted, alert, message_reply
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  reference_type VARCHAR(50), -- invoice, payment, project, report, message
  reference_id INTEGER,
  is_read INTEGER DEFAULT 0,
  sent_via_push INTEGER DEFAULT 0,
  sent_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cn_user_read ON client_notifications(client_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_cn_created ON client_notifications(created_at);

-- 4. جدول رسائل وتواصل العملاء مع الإدارة (Client Messages & Tickets)
CREATE TABLE IF NOT EXISTS client_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_user_id INTEGER NOT NULL,
  project_id INTEGER,
  direction VARCHAR(20) DEFAULT 'outgoing', -- outgoing (من العميل), incoming (من الإدارة للعميل)
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  attachment_url TEXT,
  priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
  status VARCHAR(20) DEFAULT 'open', -- open, under_review, replied, closed
  replied_by INTEGER,
  reply_body TEXT,
  replied_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_user_id) REFERENCES client_users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cm_user ON client_messages(client_user_id);
CREATE INDEX IF NOT EXISTS idx_cm_project ON client_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_cm_status ON client_messages(status);

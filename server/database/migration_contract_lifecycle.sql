-- =========================================================================
-- migration_contract_lifecycle.sql
-- نظام رواسي عدن للهندسة والمقاولات
-- ترقية دورة حياة العقود والمحفزات الذكية (Contract Lifecycle & Smart Alerts)
-- متوافق بالكامل مع محركي SQLite و MySQL
-- =========================================================================

-- 1. جدول سجل مراحل دورة حياة العقد (10 مراحل مستندية)
CREATE TABLE IF NOT EXISTS contract_lifecycle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  stage VARCHAR(30) NOT NULL, -- draft / under_review / approved_finance / signed / active / amended / extended / in_ipc / in_settlement / closed
  entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  exited_at DATETIME,
  entered_by VARCHAR(100),
  approved_by VARCHAR(100),
  approval_notes TEXT,
  documents_json TEXT,
  signature_date DATE,
  signature_hash VARCHAR(64), -- SHA-256 للتوثيق والختم الرقمي
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cl_contract ON contract_lifecycle(contract_id);
CREATE INDEX IF NOT EXISTS idx_cl_stage ON contract_lifecycle(stage);
CREATE INDEX IF NOT EXISTS idx_cl_entered_at ON contract_lifecycle(entered_at);

-- 2. جدول التنبيهات الذكية للعقود والمشاريع (5 أنواع من التنبيهات)
CREATE TABLE IF NOT EXISTS contract_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  project_id INTEGER,
  alert_type VARCHAR(30) NOT NULL, -- expiry / ipc_due / advance_payment / retention_due / penalty
  severity VARCHAR(20) NOT NULL,   -- info / warning / critical
  trigger_date DATE,
  alert_date DATE,
  amount_at_risk DECIMAL(15,2) DEFAULT 0.00,
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending / acknowledged / resolved / dismissed
  resolved_by VARCHAR(100),
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ca_contract ON contract_alerts(contract_id);
CREATE INDEX IF NOT EXISTS idx_ca_project ON contract_alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_ca_status ON contract_alerts(status);
CREATE INDEX IF NOT EXISTS idx_ca_severity ON contract_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_ca_type ON contract_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_ca_alert_date ON contract_alerts(alert_date);

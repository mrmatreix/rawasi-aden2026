-- =========================================================================
-- migration_cash_flow.sql
-- نظام رواسي عدن للهندسة والمقاولات
-- ترقية نظام التدقيق النقدي وتوقعات التدفق (Cash Flow Projections)
-- متوافق بالكامل مع محركي SQLite و MySQL
-- =========================================================================

-- 1. ترقية جدول العقود لدعم دورات الاستحقاق والمحجوزات وخدمات الإشراف (إن لم تكن موجودة)
-- نستخدم استعلامات فحص الأعمدة أو محاولة الإضافة الآمنة
CREATE TABLE IF NOT EXISTS cash_flow_projections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  contract_id INTEGER,
  projection_month VARCHAR(7) NOT NULL, -- YYYY-MM
  expected_inflow_type VARCHAR(50),     -- مستخلص / دفعة_مقدمة / محجوز / خدمة_إشراف
  expected_inflow_amount DECIMAL(15,2) DEFAULT 0.00,
  expected_inflow_date DATE,
  expected_outflow_type VARCHAR(50),    -- مورد / راتب / مقاول_باطن / ضريبة / ضمان
  expected_outflow_amount DECIMAL(15,2) DEFAULT 0.00,
  expected_outflow_date DATE,
  confidence_level VARCHAR(20) DEFAULT 'medium', -- high / medium / low
  source_document VARCHAR(50),                   -- bill / contract / po / payroll / tax
  status VARCHAR(20) DEFAULT 'planned',          -- planned / confirmed / realized / cancelled
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- فهارس تسريع الاستعلامات
CREATE INDEX IF NOT EXISTS idx_cfp_month ON cash_flow_projections(projection_month);
CREATE INDEX IF NOT EXISTS idx_cfp_project ON cash_flow_projections(project_id);
CREATE INDEX IF NOT EXISTS idx_cfp_contract ON cash_flow_projections(contract_id);
CREATE INDEX IF NOT EXISTS idx_cfp_status ON cash_flow_projections(status);
CREATE INDEX IF NOT EXISTS idx_cfp_inflow_type ON cash_flow_projections(expected_inflow_type);
CREATE INDEX IF NOT EXISTS idx_cfp_outflow_type ON cash_flow_projections(expected_outflow_type);

-- 2. جدول إعدادات وسيناريوهات التدفق النقدي المحفوظة
CREATE TABLE IF NOT EXISTS cash_flow_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_name VARCHAR(50) NOT NULL, -- realistic / optimistic / pessimistic
  projection_month VARCHAR(7) NOT NULL,
  total_inflow DECIMAL(15,2) DEFAULT 0.00,
  total_outflow DECIMAL(15,2) DEFAULT 0.00,
  net_flow DECIMAL(15,2) DEFAULT 0.00,
  cumulative_balance DECIMAL(15,2) DEFAULT 0.00,
  parameters_json TEXT,
  calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cfs_month_name ON cash_flow_scenarios(projection_month, scenario_name);

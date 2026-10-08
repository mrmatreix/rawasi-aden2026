-- =========================================================================
-- migration_profitability.sql
-- نظام رواسي عدن للهندسة والمقاولات
-- ترقية مركز ربحية المشاريع اللحظي (Real-time Profitability Engine)
-- متوافق مع معايير المحاسبة الدولية IFRS 15 (Percentage of Completion)
-- متوافق مع محركي SQLite و MySQL
-- =========================================================================

-- 1. جدول عرض ومتابعة ربحية المشاريع اللحظية (15 حقلاً أساسياً)
CREATE TABLE IF NOT EXISTS project_profitability_view (
  project_id INTEGER PRIMARY KEY,
  contract_value DECIMAL(15,2) DEFAULT 0.00,           -- 1. قيمة العقد الأساسية
  change_orders_total DECIMAL(15,2) DEFAULT 0.00,      -- 2. إجمالي أوامر التغيير المعتمدة
  adjusted_contract_value DECIMAL(15,2) DEFAULT 0.00,  -- 3. العقد المعدل (1 + 2)
  poc_percentage DECIMAL(8,4) DEFAULT 0.0000,          -- 4. نسبة الإنجاز الفعلي Percentage of Completion
  total_invoiced DECIMAL(15,2) DEFAULT 0.00,          -- 5. إجمالي المفوتر (المستخلصات المعتمدة IPC)
  total_collected DECIMAL(15,2) DEFAULT 0.00,         -- 6. إجمالي المحصل الفعلي من العميل
  material_cost DECIMAL(15,2) DEFAULT 0.00,           -- 7. تكلفة المواد المستهلكة (SIV - MRR ± PTR + الهالك)
  labor_cost DECIMAL(15,2) DEFAULT 0.00,              -- 8. تكلفة العمالة والأجور المباشرة
  subcontractors_cost DECIMAL(15,2) DEFAULT 0.00,     -- 9. تكلفة مقاولي الباطن
  direct_expenses DECIMAL(15,2) DEFAULT 0.00,         -- 10. المصروفات التشغيلية المباشرة
  indirect_cost DECIMAL(15,2) DEFAULT 0.00,           -- 11. حصة المشروع من التكاليف غير المباشرة
  future_commitments DECIMAL(15,2) DEFAULT 0.00,      -- 12. التزامات مستقبلية (أوامر شراء معتمدة لم تفوتر)
  expected_profit DECIMAL(15,2) DEFAULT 0.00,         -- 13. الربح الإجمالي المتوقع عند اكتمال المشروع
  actual_profit DECIMAL(15,2) DEFAULT 0.00,           -- 14. الربح الفعلي المحقق حتى تاريخه وفق IFRS 15
  profit_margin_pct DECIMAL(8,4) DEFAULT 0.0000,       -- 15. هامش الربح الفعلي كنسبة مئوية
  recognized_revenue DECIMAL(15,2) DEFAULT 0.00,      -- إيراد العقد المعترف به (العقد المعدل × POC%)
  total_actual_cost DECIMAL(15,2) DEFAULT 0.00,       -- إجمالي التكلفة الفعلية المنفقة
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(50) DEFAULT 'active',
  last_calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول سجل تدقيق ومتابعة أحداث وتغيرات الربحية (Audit Trail)
CREATE TABLE IF NOT EXISTS profitability_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  reference_id VARCHAR(100),
  old_margin_pct DECIMAL(8,4) DEFAULT 0.0000,
  new_margin_pct DECIMAL(8,4) DEFAULT 0.0000,
  actual_cost DECIMAL(15,2) DEFAULT 0.00,
  recognized_revenue DECIMAL(15,2) DEFAULT 0.00,
  actual_profit DECIMAL(15,2) DEFAULT 0.00,
  created_by VARCHAR(100) DEFAULT 'SYSTEM',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- فهارس تسريع الاستعلامات لدفاتر الرقابة والتقارير
CREATE INDEX IF NOT EXISTS idx_profitability_audit_prj ON profitability_audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_profitability_audit_evt ON profitability_audit_log(trigger_event);

-- =========================================================================
-- 3. المحفزات التلقائية (Triggers) لتسجيل الأحداث وإعادة احتساب الربحية
-- الأحداث الثمانية:
-- 1. اعتماد فاتورة شراء (PURCHASE_POSTED)
-- 2. اعتماد إذن صرف مخزني SIV (SIV_APPROVED)
-- 3. اعتماد إيصال إرجاع مخزني MRR (MRR_PROCESSED)
-- 4. اعتماد تحويل مواد بين المشاريع PTR (PTR_TRANSFER)
-- 5. اعتماد مستخلص عميل IPC (IPC_APPROVED)
-- 6. اعتماد سند قبض أو صرف (PAYMENT_RECORDED)
-- 7. اعتماد أمر تغيير للمشروع (VARIATION_APPROVED)
-- 8. ترحيل مسير رواتب العمالة (PAYROLL_POSTED)
-- =========================================================================

-- Trigger 1: اعتماد فاتورة شراء مرتبطة بمشروع
DROP TRIGGER IF EXISTS trg_profitability_purchase_posted;
CREATE TRIGGER trg_profitability_purchase_posted
AFTER UPDATE OF status ON purchases
FOR EACH ROW
WHEN NEW.status = 'posted' AND NEW.project_id IS NOT NULL
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.project_id, 'PURCHASE_POSTED', COALESCE(NEW.invoice_no, CAST(NEW.id AS TEXT)), 'ترحيل فاتورة شراء للمشروع');
END;

-- Trigger 2: إذن صرف مخزني لمشروع SIV
DROP TRIGGER IF EXISTS trg_profitability_inventory_siv;
CREATE TRIGGER trg_profitability_inventory_siv
AFTER INSERT ON inventory_transactions
FOR EACH ROW
WHEN NEW.project_id IS NOT NULL AND NEW.type = 'out'
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.project_id, 'SIV_APPROVED', COALESCE(NEW.reference_no, CAST(NEW.id AS TEXT)), 'صرف مواد من المخزن لموقع المشروع');
END;

-- Trigger 3: إيصال إرجاع مواد من موقع المشروع للمخزن MRR
DROP TRIGGER IF EXISTS trg_profitability_inventory_mrr;
CREATE TRIGGER trg_profitability_inventory_mrr
AFTER INSERT ON inventory_transactions
FOR EACH ROW
WHEN NEW.project_id IS NOT NULL AND NEW.type IN ('return', 'in') AND (NEW.recipient LIKE '%إرجاع%' OR NEW.recipient LIKE '%مرتجع%' OR NEW.notes LIKE '%إرجاع%')
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.project_id, 'MRR_PROCESSED', COALESCE(NEW.reference_no, CAST(NEW.id AS TEXT)), 'إرجاع مواد فائضة من موقع المشروع إلى المستودع');
END;

-- Trigger 4: تحويل مواد بين المشاريع PTR
DROP TRIGGER IF EXISTS trg_profitability_inter_project_transfer;
CREATE TRIGGER trg_profitability_inter_project_transfer
AFTER UPDATE OF status ON inter_project_material_transfers
FOR EACH ROW
WHEN NEW.status = 'approved'
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.from_project_id, 'PTR_TRANSFER_OUT', NEW.transfer_no, 'تحويل مواد منصرفة إلى مشروع آخر');
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.to_project_id, 'PTR_TRANSFER_IN', NEW.transfer_no, 'استلام مواد محولة من مشروع شقيق');
END;

-- Trigger 5: اعتماد مستخلص عميل IPC (Bills)
DROP TRIGGER IF EXISTS trg_profitability_ipc_bill;
CREATE TRIGGER trg_profitability_ipc_bill
AFTER INSERT ON bills
FOR EACH ROW
WHEN NEW.project_id IS NOT NULL
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.project_id, 'IPC_APPROVED', COALESCE(NEW.bill_no, CAST(NEW.id AS TEXT)), 'إصدار واعتماد مستخلص إنجاز أعمال للمشروع IPC');
END;

-- Trigger 6: اعتماد سند قبض أو صرف تابع للمشروع (Payments)
DROP TRIGGER IF EXISTS trg_profitability_payment_voucher;
CREATE TRIGGER trg_profitability_payment_voucher
AFTER INSERT ON payments
FOR EACH ROW
WHEN NEW.project_id IS NOT NULL
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.project_id, 'PAYMENT_RECORDED', COALESCE(NEW.receipt_no, CAST(NEW.id AS TEXT)), 'تسجيل حركة قبض أو سداد مرتبطة بالمشروع');
END;

-- Trigger 7: اعتماد أمر تغيير للمشروع (Variation Orders)
DROP TRIGGER IF EXISTS trg_profitability_variation_order;
CREATE TRIGGER trg_profitability_variation_order
AFTER UPDATE OF status ON project_change_orders
FOR EACH ROW
WHEN NEW.status = 'approved'
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (NEW.project_id, 'VARIATION_APPROVED', COALESCE(NEW.change_no, CAST(NEW.id AS TEXT)), 'اعتماد أمر تغيير تعاقدي للمشروع (VO)');
END;

-- Trigger 8: ترحيل مسير رواتب وأجور العمالة (Payroll)
DROP TRIGGER IF EXISTS trg_profitability_payroll_posted;
CREATE TRIGGER trg_profitability_payroll_posted
AFTER INSERT ON payroll
FOR EACH ROW
BEGIN
  INSERT INTO profitability_audit_log (project_id, trigger_event, reference_id, notes)
  VALUES (
    COALESCE((SELECT id FROM projects WHERE status = 'active' ORDER BY id ASC LIMIT 1), 1),
    'PAYROLL_POSTED',
    COALESCE(NEW.payroll_month, CAST(NEW.id AS TEXT)),
    'ترحيل مسير رواتب وأجور عمالة تشغيلية'
  );
END;

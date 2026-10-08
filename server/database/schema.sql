-- ============================================================================
-- مخطط قاعدة بيانات نظام رواسي عدن للهندسة والمقاولات (Rawasi Aden System)
-- متوافق مع SQLite و MySQL
-- ============================================================================

-- 1. جدول الأدوار والصلاحيات
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    permissions TEXT NOT NULL, -- JSON format or comma-separated
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role_id INTEGER REFERENCES roles(id),
    role TEXT DEFAULT 'admin',
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active', -- active, inactive
    permissions TEXT, -- JSON array or comma-separated permissions
    is_logged_in INTEGER DEFAULT 0,
    session_token TEXT,
    last_heartbeat DATETIME,
    last_login_at DATETIME,
    last_login_ip TEXT,
    last_login_device TEXT,
    active_sessions TEXT,
    security_settings TEXT,
    two_factor_pin TEXT DEFAULT '123456',
    two_factor_enabled INTEGER DEFAULT 1,
    branch_id INTEGER DEFAULT 1,
    branch TEXT DEFAULT 'المركز الرئيسي',
    department_id INTEGER DEFAULT 1,
    department TEXT DEFAULT 'الإدارة العامة',
    allowed_projects TEXT DEFAULT '*', -- '*' or JSON array of project IDs [1, 2]
    allowed_branches TEXT DEFAULT '*', -- '*' or JSON array of branch codes/IDs
    allowed_departments TEXT DEFAULT '*', -- '*' or JSON array of department codes/IDs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جداول الفروع والأقسام لنظام الصلاحيات المقيدة (Scoped Access Control)
CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    manager_name TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول العملاء
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    previous_balance REAL DEFAULT 0,
    total_paid REAL DEFAULT 0,
    total_due REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. جداول إدارة علاقات الموردين (SRM & Vendor Master Data)
CREATE TABLE IF NOT EXISTS vendor_industry_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    icon TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendor_payment_document_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name_ar TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    industry_category TEXT NOT NULL DEFAULT 'مواد بناء',
    contact_person TEXT,
    phone TEXT,
    phone_number TEXT,
    email TEXT,
    address TEXT,
    bank_name TEXT,
    bank_account_no TEXT,
    bank_iban TEXT,
    bank_details_encrypted TEXT,
    default_currency TEXT NOT NULL DEFAULT 'YER',
    supply_lead_time_days INTEGER NOT NULL DEFAULT 3,
    payment_document_type TEXT NOT NULL DEFAULT 'إيصال عادي',
    status TEXT NOT NULL DEFAULT 'active',
    tax_id TEXT,
    commercial_reg_no TEXT,
    credit_limit REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    category TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- فهارس الأداء للموردين وتجميعات الـ SRM
CREATE INDEX IF NOT EXISTS idx_suppliers_industry_status ON suppliers (industry_category, status);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_status ON purchases (supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_type_status ON payments (supplier_id, type, status);

-- عرض التجميعات المالية الديناميكية للموردين في الوقت الفعلي (Zero N+1 Query Aggregation View)
CREATE VIEW IF NOT EXISTS view_vendor_financial_profiles AS
SELECT 
    v.id AS id,
    v.id AS vendor_id,
    COALESCE(v.company_name, v.name) AS company_name,
    COALESCE(v.industry_category, v.category, 'مواد بناء') AS industry_category,
    v.contact_person,
    COALESCE(v.phone_number, v.phone) AS phone_number,
    v.email,
    v.address,
    v.bank_name,
    v.bank_account_no,
    v.bank_iban,
    v.bank_details_encrypted,
    COALESCE(v.default_currency, v.currency, 'YER') AS default_currency,
    COALESCE(v.supply_lead_time_days, 3) AS supply_lead_time_days,
    COALESCE(v.payment_document_type, 'إيصال عادي') AS payment_document_type,
    COALESCE(v.status, 'active') AS status,
    COALESCE(v.tax_id, v.tax_number) AS tax_id,
    v.commercial_reg_no,
    v.notes,
    v.created_at,
    v.updated_at,
    
    CASE 
        WHEN COALESCE(inv.total_invoices_count, 0) > 0 THEN inv.total_invoices_count
        WHEN v.invoice_attachment IS NOT NULL AND v.invoice_attachment != '' AND v.invoice_attachment != '[]' THEN 1
        ELSE 0
    END AS total_purchase_invoices_count,
    ROUND(COALESCE(v.balance, 0.0) + COALESCE(inv.total_invoiced_amount, 0.0), 2) AS total_invoiced_amount,
    ROUND(COALESCE(pay.total_amount_paid, 0.0), 2) AS total_amount_paid,
    ROUND((COALESCE(v.balance, 0.0) + COALESCE(inv.total_invoiced_amount, 0.0)) - COALESCE(pay.total_amount_paid, 0.0), 2) AS outstanding_balance
FROM suppliers v
LEFT JOIN (
    SELECT 
        supplier_id,
        COUNT(id) AS total_invoices_count,
        SUM(COALESCE(total_amount, 0.0)) AS total_invoiced_amount
    FROM purchases
    WHERE status != 'cancelled' OR status IS NULL
    GROUP BY supplier_id
) inv ON inv.supplier_id = v.id
LEFT JOIN (
    SELECT 
        supplier_id,
        SUM(amount) AS total_amount_paid
    FROM (
        SELECT supplier_id, COALESCE(amount, 0.0) AS amount
        FROM payments 
        WHERE supplier_id IS NOT NULL 
          AND type = 'صرف' 
          AND (status IN ('cleared', 'posted', 'approved') OR status IS NULL)
        UNION ALL
        SELECT supplier_id, COALESCE(paid_amount, 0.0) AS amount
        FROM purchases
        WHERE supplier_id IS NOT NULL 
          AND paid_amount > 0 
          AND (status != 'cancelled' OR status IS NULL)
        UNION ALL
        SELECT supplier_id, COALESCE(amount, 0.0) AS amount
        FROM expenses
        WHERE supplier_id IS NOT NULL
          AND (status IN ('cleared', 'posted', 'approved') OR status IS NULL)
          AND (receipt_no IS NULL OR receipt_no NOT IN (SELECT receipt_no FROM payments WHERE receipt_no IS NOT NULL))
    )
    GROUP BY supplier_id
) pay ON pay.supplier_id = v.id;

-- 5. جدول المشاريع
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    contract_value REAL DEFAULT 0,    -- قيمة العقد
    estimated_cost REAL DEFAULT 0,    -- القيمة التقديرية
    actual_cost REAL DEFAULT 0,       -- التكلفة الفعلية
    progress_percentage REAL DEFAULT 0, -- نسبة الإنجاز %
    expected_profit REAL DEFAULT 0,   -- الربح المتوقع
    actual_profit REAL DEFAULT 0,     -- الربح الفعلي
    status TEXT DEFAULT 'active',     -- active, completed, paused
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. جدول المواد والأصناف
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT, -- حديد، أسمنت، بلوك، خرسانة، أدوات صحية، كهربائية
    unit TEXT,     -- طن، كيس، متر مكعب، حبة
    min_quantity REAL DEFAULT 10,
    current_quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. حركات المخزون (صرف، توريد، تحويل)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id),
    project_id INTEGER REFERENCES projects(id),
    type TEXT NOT NULL, -- in (توريد), out (صرف لمشروع), transfer
    quantity REAL NOT NULL,
    unit_price REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    reference_no TEXT,
    recipient TEXT,     -- المستلم أو المهندس المشرف
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. فواتير المشتريات
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT UNIQUE,
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending', -- paid, partial, pending
    payment_method TEXT DEFAULT 'نقدي',    -- نقدي، شيك، تحويل بنكي
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. جدول المصروفات (سندات الصرف)
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE,
    expense_type TEXT NOT NULL, -- مواد بناء، أجور عمالة، معدات، نقل ومواصلات، مصروفات إدارية، أخرى
    project_id INTEGER REFERENCES projects(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    account_id INTEGER REFERENCES accounts(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ر.ي',
    payment_method TEXT DEFAULT 'نقدي', -- نقدي، تحويل بنكي، شيك
    check_no TEXT,                      -- رقم الشيك (إلزامي عند الصرف بشيك)
    bank_name TEXT,                     -- اسم البنك
    recipient TEXT,
    date DATE NOT NULL,
    status TEXT DEFAULT 'posted',       -- draft, under_review, approved, posted, closed, reversed, cancelled
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_by_name TEXT,
    reviewed_at DATETIME,
    review_notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    approval_notes TEXT,
    posted_by INTEGER REFERENCES users(id),
    posted_by_name TEXT,
    posted_at DATETIME,
    reversed_by INTEGER REFERENCES users(id),
    reversed_by_name TEXT,
    reversed_at DATETIME,
    reversal_reason TEXT,
    reversal_ref_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. جدول الفواتير والمستخلصات
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no TEXT UNIQUE,
    bill_type TEXT DEFAULT 'مستخلص', -- مستخلص جاري، مستخلص ختامي، فاتورة أعمال
    project_id INTEGER REFERENCES projects(id),
    client_id INTEGER REFERENCES clients(id),
    contract_id INTEGER REFERENCES project_contracts(id),
    amount REAL NOT NULL,           -- قيمة المستخلص الإجمالية
    gross_amount REAL DEFAULT 0,
    deduction REAL DEFAULT 0,       -- إجمالي الاستقطاعات
    advance_deduction REAL DEFAULT 0,
    retention_deduction REAL DEFAULT 0,
    net_amount REAL NOT NULL,       -- صافي المستخلص المستحق
    paid_amount REAL DEFAULT 0,     -- إجمالي المسدد من هذا المستخلص
    remaining_amount REAL DEFAULT 0,-- المتبقي غير المسدد
    payment_status TEXT DEFAULT 'unpaid', -- unpaid, partially_paid, paid
    status TEXT DEFAULT 'معتمد',     -- مسودة، معتمد، محصل جزئي، محصل كامل، reversed
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. جدول المدفوعات والتحصيلات (سندات القبض والصرف)
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE,
    type TEXT NOT NULL, -- 'قبض' أو 'صرف'
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    contract_id INTEGER REFERENCES project_contracts(id),
    bill_id INTEGER REFERENCES bills(id),
    account_id INTEGER REFERENCES accounts(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ر.ي',
    exchange_rate REAL DEFAULT 1.0,
    local_amount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'نقدي', -- نقدي، تحويل بنكي، شيك
    check_no TEXT,                      -- رقم الشيك (إلزامي عند القبض أو الصرف بشيك)
    bank_name TEXT,                     -- اسم البنك
    date DATE NOT NULL,
    receipt_category TEXT DEFAULT 'general', -- general, advance_payment, bill_collection, retention_release
    status TEXT DEFAULT 'posted',       -- draft, under_review, approved, posted, closed, reversed, cancelled
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_by_name TEXT,
    reviewed_at DATETIME,
    review_notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    approval_notes TEXT,
    posted_by INTEGER REFERENCES users(id),
    posted_by_name TEXT,
    posted_at DATETIME,
    reversed_by INTEGER REFERENCES users(id),
    reversed_by_name TEXT,
    reversed_at DATETIME,
    reversal_reason TEXT,
    reversal_ref_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. جدول النثريات والعهد
CREATE TABLE IF NOT EXISTS custodies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    custody_no TEXT UNIQUE,             -- رقم العهدة التسلسلي الفريد
    operation_type TEXT NOT NULL,       -- صرف عهدة، تصفية عهدة، نثريات
    employee_id INTEGER REFERENCES employees(id),
    employee_no TEXT,                   -- الرقم الوظيفي
    employee_name TEXT NOT NULL,
    related_custody_id INTEGER REFERENCES custodies(id), -- رقم العهدة الأصلية عند التصفية
    related_custody_no TEXT,
    total_amount REAL NOT NULL,
    spent_amount REAL DEFAULT 0,
    remaining_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    status TEXT DEFAULT 'مفتوحة',       -- مفتوحة، مصفاة بالكامل، تصفية جزئية
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. جدول حركة الصندوق والبنك
CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    previous_balance REAL DEFAULT 0,
    cash_in REAL DEFAULT 0,
    cash_out REAL DEFAULT 0,
    withdrawals REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. دليل الحسابات
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- أصول، خصوم، حقوق ملكية، إيرادات، مصروفات
    parent_id INTEGER REFERENCES accounts(id),
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14.ب جدول مراكز التكلفة
CREATE TABLE IF NOT EXISTS cost_centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,          -- كود مركز التكلفة
    name TEXT NOT NULL,                 -- اسم مركز التكلفة
    type TEXT DEFAULT 'مشروع',          -- نوع المركز: مشروع، إدارة عامة، معدات، فرع
    project_id INTEGER REFERENCES projects(id),
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 15. القيود اليومية العامة
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_no TEXT UNIQUE NOT NULL,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    reference_type TEXT, -- سند قبض، سند صرف، فاتورة، مستخلص، قيد يدوي
    reference_id INTEGER,
    total_debit REAL DEFAULT 0,
    total_credit REAL DEFAULT 0,
    status TEXT DEFAULT 'posted',       -- draft, under_review, approved, posted, closed, reversed
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    posted_by INTEGER REFERENCES users(id),
    posted_by_name TEXT,
    posted_at DATETIME,
    reversed_by INTEGER REFERENCES users(id),
    reversed_by_name TEXT,
    reversed_at DATETIME,
    reversal_reason TEXT,
    reversal_ref_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_journal_balance CHECK (total_debit > 0 AND abs(total_debit - total_credit) < 0.001)
);

-- مشغلات حماية التوازن المحاسبي الصارم (منع أي إدراج أو تعديل غير متوازن)
CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_insert
BEFORE INSERT ON journal_entries
BEGIN
  SELECT CASE 
    WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
    THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن حفظ قيد غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_update
BEFORE UPDATE ON journal_entries
BEGIN
  SELECT CASE 
    WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
    THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن تحديث قيد ليصبح غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
  END;
END;

-- 16. سطور القيود اليومية (طرفين مدين ودائن)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id),
    project_id INTEGER REFERENCES projects(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    notes TEXT
);

-- 17. إعدادات النظام ومعلومات الشركة
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

-- الموارد البشرية: الموظفون، الحضور، الإجازات، السلف ومسيرات الرواتب
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_no TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
    national_id TEXT, phone TEXT, job_title TEXT, department TEXT, project_id INTEGER REFERENCES projects(id),
    employment_type TEXT DEFAULT 'دوام كامل', hire_date DATE, basic_salary REAL DEFAULT 0, currency TEXT DEFAULT 'ر.ي',
    status TEXT DEFAULT 'active', bank_name TEXT, bank_account TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL, status TEXT DEFAULT 'present', check_in TEXT, check_out TEXT, overtime_hours REAL DEFAULT 0, notes TEXT,
    UNIQUE(employee_id, date)
);
CREATE TABLE IF NOT EXISTS employee_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type TEXT DEFAULT 'سنوية', start_date DATE NOT NULL, end_date DATE NOT NULL, days_count REAL DEFAULT 1, status TEXT DEFAULT 'pending', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employee_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount REAL NOT NULL, recovered_amount REAL DEFAULT 0, installment_amount REAL DEFAULT 0, date DATE NOT NULL, status TEXT DEFAULT 'active', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_month TEXT NOT NULL, basic_salary REAL DEFAULT 0, overtime_amount REAL DEFAULT 0, deductions REAL DEFAULT 0,
    net_salary REAL DEFAULT 0, status TEXT DEFAULT 'draft', paid_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, payroll_month)
);

-- ============================================================================
-- جداول إدارة المشاريع الهندسية والمقاولات الـ 14 (Project Management Suite)
-- ============================================================================

-- 1. عقد المشروع (Project Contract)
CREATE TABLE IF NOT EXISTS project_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),
    contract_no TEXT,
    title TEXT,
    first_party TEXT,       -- المالك / العميل
    second_party TEXT,      -- المقاول: شركة رواسي عدن
    contract_date DATE,
    start_date DATE,
    end_date DATE,
    duration_days INTEGER,
    contract_value REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    advance_payment_pct REAL DEFAULT 0,
    advance_payment_amount REAL DEFAULT 0,
    retention_pct REAL DEFAULT 10,
    penalty_per_day REAL DEFAULT 0,
    max_penalty_pct REAL DEFAULT 10,
    payment_terms TEXT,
    scope_of_work TEXT,
    status TEXT DEFAULT 'ساري', -- مسودة، ساري، مكتمل، ملغي
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- فهارس الأداء للمستخلصات والعقود ودورة حياة العميل
CREATE INDEX IF NOT EXISTS idx_project_contracts_client ON project_contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_bills_client_project_status ON bills (client_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_contract_status ON bills (contract_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_client_bill_type ON payments (client_id, bill_id, type, status);
CREATE INDEX IF NOT EXISTS idx_payments_contract_type ON payments (contract_id, type, status);

-- عرض التجميعات المالية الديناميكية للعملاء في الوقت الفعلي (Zero N+1 Client Financial Profile View)
CREATE VIEW IF NOT EXISTS view_client_financial_profiles AS
SELECT
    c.id,
    c.id AS client_id,
    c.name,
    c.company,
    c.phone,
    c.email,
    c.address,
    COALESCE(c.currency, 'ر.ي') AS currency,
    COALESCE(c.previous_balance, 0.0) AS previous_balance,
    COALESCE(cnt.total_contracts_count, 0) AS total_contracts_count,
    ROUND(COALESCE(cnt.total_contracts_value, 0.0), 2) AS total_contracts_value,
    COALESCE(prj.total_projects_count, 0) AS total_projects_count,
    COALESCE(b.total_bills_count, 0) AS total_bills_count,
    ROUND(COALESCE(b.total_gross_billed, 0.0), 2) AS total_gross_billed,
    ROUND(COALESCE(b.total_net_billed, 0.0), 2) AS total_net_billed,
    ROUND(COALESCE(b.total_advance_deductions, 0.0), 2) AS total_advance_deductions,
    ROUND(COALESCE(b.total_retention_deductions, 0.0), 2) AS total_retention_deductions,
    ROUND(COALESCE(pay_adv.total_advance_received, 0.0), 2) AS total_advance_received,
    ROUND(MAX(0.0, COALESCE(pay_adv.total_advance_received, 0.0) - COALESCE(b.total_advance_deductions, 0.0)), 2) AS remaining_advance_balance,
    ROUND(COALESCE(pay_ret.total_retention_released, 0.0), 2) AS total_retention_released,
    ROUND(MAX(0.0, COALESCE(b.total_retention_deductions, 0.0) - COALESCE(pay_ret.total_retention_released, 0.0)), 2) AS active_retention_balance,
    ROUND(COALESCE(pay.total_collected, 0.0), 2) AS total_collected,
    ROUND((COALESCE(c.previous_balance, 0.0) + COALESCE(b.total_net_billed, 0.0)) - COALESCE(pay.total_collected, 0.0), 2) AS outstanding_balance
FROM clients c
LEFT JOIN (
    SELECT client_id, COUNT(id) AS total_projects_count
    FROM projects
    GROUP BY client_id
) prj ON prj.client_id = c.id
LEFT JOIN (
    SELECT 
        COALESCE(pc.client_id, p.client_id) AS client_id,
        COUNT(pc.id) AS total_contracts_count,
        SUM(COALESCE(pc.contract_value, 0.0)) AS total_contracts_value
    FROM project_contracts pc
    LEFT JOIN projects p ON pc.project_id = p.id
    WHERE pc.status != 'ملغي'
    GROUP BY COALESCE(pc.client_id, p.client_id)
) cnt ON cnt.client_id = c.id
LEFT JOIN (
    SELECT 
        client_id,
        COUNT(id) AS total_bills_count,
        SUM(COALESCE(gross_amount, amount, 0.0)) AS total_gross_billed,
        SUM(COALESCE(net_amount, amount, 0.0)) AS total_net_billed,
        SUM(COALESCE(advance_deduction, 0.0)) AS total_advance_deductions,
        SUM(COALESCE(retention_deduction, 0.0)) AS total_retention_deductions
    FROM bills
    WHERE status NOT IN ('draft', 'reversed', 'cancelled')
    GROUP BY client_id
) b ON b.client_id = c.id
LEFT JOIN (
    SELECT client_id, SUM(COALESCE(amount, 0.0)) AS total_collected
    FROM payments
    WHERE type = 'قبض' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
    GROUP BY client_id
) pay ON pay.client_id = c.id
LEFT JOIN (
    SELECT client_id, SUM(COALESCE(amount, 0.0)) AS total_advance_received
    FROM payments
    WHERE type = 'قبض' AND receipt_category = 'advance_payment' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
    GROUP BY client_id
) pay_adv ON pay_adv.client_id = c.id
LEFT JOIN (
    SELECT client_id, SUM(COALESCE(amount, 0.0)) AS total_retention_released
    FROM payments
    WHERE type = 'قبض' AND receipt_category = 'retention_release' AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL)
    GROUP BY client_id
) pay_ret ON pay_ret.client_id = c.id;

-- 2. المخططات الهندسية (Engineering Drawings & Schematics)
CREATE TABLE IF NOT EXISTS project_drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    drawing_no TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'معماري', -- معماري، إنشائي، كهروميكانيكي MEP، تنفيذي Shop Drawing، كما نفذ As-Built، أخرى
    scale TEXT DEFAULT '1:100',
    revision TEXT DEFAULT 'Rev 0',
    submission_date DATE,
    approval_date DATE,
    status TEXT DEFAULT 'معتمد', -- معتمد، معتمد بملاحظات، قيد المراجعة، مرفوض
    engineer_name TEXT,
    file_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول الكميات BOQ (Bill of Quantities)
CREATE TABLE IF NOT EXISTS project_boq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_no TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT DEFAULT 'أعمال خرسانية', -- أعمال ترابية وحفر، أعمال خرسانية، أعمال مباني وعزل، أعمال تشطيبات، أعمال كهروميكانيكية، أعمال خارجية
    unit TEXT NOT NULL, -- م3، م2، م.ط، طن، كجم، حبة، مقطوع، نقطة
    contract_qty REAL DEFAULT 0,
    executed_qty REAL DEFAULT 0,
    unit_rate REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'جاري التنفيذ', -- لم يبدأ، جاري التنفيذ، مكتمل
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. عروض الأسعار (Quotations & Price Offers)
CREATE TABLE IF NOT EXISTS project_quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES clients(id),
    quotation_no TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    valid_until DATE,
    items_json TEXT,
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    tax_vat REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    payment_terms TEXT,
    delivery_period TEXT,
    status TEXT DEFAULT 'مسودة', -- مسودة، مُرسل، معتمد، مرفوض
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. الميزانية والتكلفة المستهدفة (Budget & Target Cost)
CREATE TABLE IF NOT EXISTS project_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- مواد بناء، أجور عمالة ومقاولين، معدات وآليات، نقل ومحروقات، مصاريف موقع وإشراف، نثريات وطوارئ
    planned_cost REAL DEFAULT 0,
    actual_cost REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. أوامر التغيير والإضافيات (Change Orders & Variations)
CREATE TABLE IF NOT EXISTS project_change_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    change_no TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'إضافة بند جديد', -- إضافة بند جديد، تعديل كميات ومواصفات، حذف واستبعاد
    request_date DATE NOT NULL,
    approval_date DATE,
    amount REAL DEFAULT 0,
    time_extension_days INTEGER DEFAULT 0,
    reason TEXT DEFAULT 'طلب المالك', -- طلب المالك، تعديل تصميمي، ظروف الموقع، أخرى
    status TEXT DEFAULT 'معتمد', -- مسودة، قيد المراجعة، معتمد، مرفوض
    requested_by TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. فواتير ومشتريات المشروع المباشرة (Project Purchases & Invoices)
CREATE TABLE IF NOT EXISTS project_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    invoice_no TEXT,
    supplier_id INTEGER REFERENCES suppliers(id),
    supplier_name TEXT,
    item_description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit TEXT,
    unit_price REAL DEFAULT 0,
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'مدفوع', -- مدفوع، مدفوع جزئي، غير مدفوع
    payment_method TEXT DEFAULT 'نقدي',
    date DATE NOT NULL,
    receipt_no TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
CREATE TABLE IF NOT EXISTS project_labor_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    worker_name_or_team TEXT NOT NULL,
    trade TEXT NOT NULL, -- نجار مسلح، حداد تسليح، بناء، معلم لياسة، كهربائي، سباك، عمالة عادية، مقاول باطن
    workers_count INTEGER DEFAULT 1,
    daily_rate REAL DEFAULT 0,
    days_or_hours REAL DEFAULT 1,
    total_amount REAL NOT NULL,
    expense_category TEXT DEFAULT 'أجور عمالة', -- أجور عمالة، مقطوعية مقاول باطن، محروقات معدات، نثريات وضيافة موقع
    payment_status TEXT DEFAULT 'مدفوع', -- مدفوع، مستحق
    supervisor_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. مستخلصات وشهادات دفع المشروع (Project Invoices & Interim Payment Certificates)
CREATE TABLE IF NOT EXISTS project_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),
    invoice_no TEXT NOT NULL,
    invoice_type TEXT DEFAULT 'مستخلص جاري', -- مستخلص جاري، مستخلص ختامي، دفعة مقدمة
    period_from DATE,
    period_to DATE,
    cumulative_work_done REAL DEFAULT 0,
    previous_bills_amount REAL DEFAULT 0,
    current_gross_amount REAL DEFAULT 0,
    advance_deduction REAL DEFAULT 0,
    retention_deduction REAL DEFAULT 0,
    other_deductions REAL DEFAULT 0,
    net_amount REAL NOT NULL,
    status TEXT DEFAULT 'معتمد للصرف', -- مسودة، مقدم للاستشاري، معتمد للصرف، محصل جزئي، محصل كامل
    date DATE NOT NULL,
    approval_date DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. التقارير اليومية للموقع (Daily Site Reports)
CREATE TABLE IF NOT EXISTS project_daily_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_no TEXT NOT NULL,
    date DATE NOT NULL,
    weather TEXT DEFAULT 'مشمس ومناسب للعمل',
    manpower_count INTEGER DEFAULT 0,
    equipment_summary TEXT,
    work_performed TEXT NOT NULL,
    materials_received TEXT,
    safety_notes TEXT,
    delays_obstacles TEXT,
    site_engineer TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. التقارير الأسبوعية للموقع (Weekly Site Reports)
CREATE TABLE IF NOT EXISTS project_weekly_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_no TEXT NOT NULL,
    week_no INTEGER DEFAULT 1,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    planned_progress_pct REAL DEFAULT 0,
    actual_progress_pct REAL DEFAULT 0,
    achievements_summary TEXT NOT NULL,
    next_week_plan TEXT,
    critical_issues TEXT,
    prepared_by TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. محاضر الاستلام والفحص الهندسي (Handover & Inspection Minutes)
CREATE TABLE IF NOT EXISTS project_handover_minutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    minute_no TEXT NOT NULL,
    type TEXT NOT NULL, -- استلام نجارة مسلحة، استلام حدادة مسلحة، استلام صب خرسانة، استلام أعمال مباني ولياسة، استلام كهروميكانيكي، محضر استلام ابتدائي، محضر استلام نهائي
    location_axis TEXT,
    inspection_date DATE NOT NULL,
    inspector_name TEXT NOT NULL,
    contractor_rep TEXT,
    status TEXT DEFAULT 'معتمد ومقبول', -- معتمد ومقبول، مقبول بملاحظات، مرفوض ويعاد الفحص
    punch_list TEXT,
    recommendations TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. المراسلات والخطابات مع المالك والاستشاري (Correspondence & Transmittals)
CREATE TABLE IF NOT EXISTS project_correspondence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ref_no TEXT NOT NULL,
    direction TEXT NOT NULL, -- صادر إلى المالك، صادر إلى الاستشاري، وارد من المالك، وارد من الاستشاري
    subject TEXT NOT NULL,
    date DATE NOT NULL,
    priority TEXT DEFAULT 'عادي', -- عادي، هام، عاجل جداً
    summary_body TEXT NOT NULL,
    required_action TEXT,
    response_status TEXT DEFAULT 'قيد الإجراء', -- قيد الإجراء، تم الرد، منتهي ومغلق
    sender TEXT,
    recipient TEXT,
    attachment_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. الحساب الختامي وتصفية المشروع (Final Account & Project Settlement)
CREATE TABLE IF NOT EXISTS project_final_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    settlement_no TEXT NOT NULL UNIQUE,
    date DATE NOT NULL,
    original_contract_val REAL DEFAULT 0,
    approved_change_orders_val REAL DEFAULT 0,
    revised_contract_val REAL DEFAULT 0,
    total_executed_work_val REAL DEFAULT 0,
    total_client_payments_received REAL DEFAULT 0,
    released_retention_val REAL DEFAULT 0,
    penalties_deductions_val REAL DEFAULT 0,
    final_balance_due REAL DEFAULT 0,
    due_to TEXT DEFAULT 'لصالح المقاول', -- لصالح المقاول، لصالح المالك
    status TEXT DEFAULT 'معتمد وموقع', -- مسودة، معتمد وموقع، مغلق ومصفى
    prepared_by TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========================================================
-- جداول الإدارات المؤسسية الجديدة (ERP Modules Support)
-- ========================================================

-- جدول تهيئة العملات وأسعار الصرف
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,          -- YER, SAR, USD
    name TEXT NOT NULL,                 -- ريال يمني، ريال سعودي، دولار أمريكي
    symbol TEXT NOT NULL,               -- ر.ي، ر.س، $
    rate_to_base REAL DEFAULT 1.0,      -- سعر الصرف مقابل العملة الأساسية (الريال اليمني)
    is_base INTEGER DEFAULT 0,          -- 1 إذا كانت العملة الأساسية
    status TEXT DEFAULT 'active',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول تهيئة أنواع الإجازات
CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,          -- سنوية، مرضية، طارئة، بدون راتب، حج/عمرة
    days_allowed INTEGER DEFAULT 30,    -- رصيد الأيام المسموح بها سنوياً
    is_paid INTEGER DEFAULT 1,          -- 1 مدفوعة، 0 غير مدفوعة
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول تقييم أداء الموظفين
CREATE TABLE IF NOT EXISTS employee_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    evaluator_name TEXT,
    period TEXT NOT NULL,               -- شهري، ربع سنوي، سنوي
    evaluation_date DATE NOT NULL,
    score REAL DEFAULT 100,             -- الدرجة من 100
    rating TEXT DEFAULT 'ممتاز',        -- ممتاز، جيد جداً، جيد، مقبول، ضعيف
    strengths TEXT,                     -- نقاط القوة
    improvements TEXT,                  -- مجالات التطوير
    recommendations TEXT,               -- توصيات الحوافز والترقيات
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول الفترات المحاسبية وإغلاق الحسابات
CREATE TABLE IF NOT EXISTS accounting_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_name TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT DEFAULT 'open',          -- open, closed
    closed_at DATETIME NULL,
    closed_by TEXT NULL,
    reopened_at DATETIME NULL,
    reopened_by TEXT NULL,
    reopen_reason TEXT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول سجل التدقيق والرقابة المالية (Audit Log)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,                -- INSERT, UPDATE, DELETE, CLOSE_PERIOD, REOPEN_PERIOD, POST_PAYROLL
    entity_type TEXT NOT NULL,           -- journal_entry, payment, expense, custody, payroll, project, period
    entity_id TEXT NULL,
    details TEXT NULL,
    old_values TEXT NULL,                -- JSON state before modification
    new_values TEXT NULL,                -- JSON state after modification
    reason TEXT NULL,                    -- سبب التغيير أو العكس الإلزامي
    ip_address TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- جناح المشتريات المتقدمة والمطابقة الثلاثية (Enterprise Procurement Suite)
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_no TEXT UNIQUE NOT NULL,
    project_id INTEGER REFERENCES projects(id),
    boq_item_id INTEGER REFERENCES project_boq(id),
    department TEXT DEFAULT 'إدارة المشاريع',
    required_date DATE,
    urgency TEXT DEFAULT 'عادي',
    estimated_total REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_id INTEGER NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id),
    item_name TEXT NOT NULL,
    unit TEXT,
    quantity REAL NOT NULL,
    estimated_price REAL DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS rfqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_no TEXT UNIQUE NOT NULL,
    requisition_id INTEGER REFERENCES purchase_requisitions(id),
    title TEXT NOT NULL,
    date DATE NOT NULL,
    closing_date DATE,
    winner_supplier_id INTEGER REFERENCES suppliers(id),
    winner_quote_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    created_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rfq_vendor_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    quote_reference TEXT,
    total_price REAL NOT NULL,
    delivery_days INTEGER DEFAULT 1,
    payment_terms TEXT,
    is_selected INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_no TEXT UNIQUE NOT NULL,
    requisition_id INTEGER REFERENCES purchase_requisitions(id),
    rfq_id INTEGER REFERENCES rfqs(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    warehouse_id INTEGER,
    date DATE NOT NULL,
    expected_delivery_date DATE,
    payment_terms TEXT DEFAULT '30 يوم من تاريخ الاستلام',
    delivery_terms TEXT DEFAULT 'موقع المشروع',
    currency TEXT DEFAULT 'ر.ي',
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'draft',
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id),
    item_name TEXT NOT NULL,
    unit TEXT,
    ordered_qty REAL NOT NULL,
    received_qty REAL DEFAULT 0,
    billed_qty REAL DEFAULT 0,
    unit_price REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    total_price REAL NOT NULL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_no TEXT UNIQUE NOT NULL,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    warehouse_id INTEGER NOT NULL,
    delivery_note_no TEXT,
    received_date DATE NOT NULL,
    receiver_name TEXT NOT NULL,
    inspector_name TEXT,
    inspection_status TEXT DEFAULT 'accepted',
    status TEXT DEFAULT 'posted',
    created_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_id INTEGER NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_item_id INTEGER REFERENCES purchase_order_items(id),
    item_id INTEGER REFERENCES items(id),
    item_name TEXT NOT NULL,
    unit TEXT,
    received_qty REAL NOT NULL,
    accepted_qty REAL NOT NULL,
    rejected_qty REAL DEFAULT 0,
    rejection_reason TEXT,
    unit_cost REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    batch_number TEXT,
    expiry_date DATE
);

-- ============================================================================
-- جناح المستودعات والتقييم المخزني والجرد (Multi-Warehouse & Valuation)
-- ============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'central',
    project_id INTEGER REFERENCES projects(id),
    location TEXT,
    manager_name TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    quantity REAL DEFAULT 0,
    reorder_level REAL DEFAULT 10,
    safety_stock REAL DEFAULT 5,
    last_cost REAL DEFAULT 0,
    average_cost REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(warehouse_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_no TEXT UNIQUE NOT NULL,
    from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    quantity REAL NOT NULL,
    unit_cost REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    transfer_date DATE NOT NULL,
    status TEXT DEFAULT 'completed',
    created_by INTEGER REFERENCES users(id),
    received_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_no TEXT UNIQUE NOT NULL,
    return_type TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    total_amount REAL NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    boq_item_id INTEGER REFERENCES project_boq(id),
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'posted',
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjustment_no TEXT UNIQUE NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    system_qty REAL NOT NULL,
    physical_qty REAL NOT NULL,
    diff_qty REAL NOT NULL,
    unit_cost REAL NOT NULL,
    diff_amount REAL NOT NULL,
    adjustment_type TEXT NOT NULL,
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'posted',
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_valuation_layers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    grn_id INTEGER REFERENCES goods_receipt_notes(id),
    date DATE NOT NULL,
    initial_qty REAL NOT NULL,
    remaining_qty REAL NOT NULL,
    unit_cost REAL NOT NULL,
    landed_cost_allocated REAL DEFAULT 0,
    batch_number TEXT,
    expiry_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- جناح إدارة المواد المتقدم، الجرد والتسويات، الحجر والتوالف، وتحويلات المشاريع (DDD Material Management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_no TEXT UNIQUE NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    audit_type TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    scheduled_at DATETIME,
    executed_at DATETIME,
    snapshot_taken_at DATETIME,
    initiated_by INTEGER REFERENCES users(id),
    auditor_id INTEGER REFERENCES users(id),
    auditor_name TEXT NOT NULL,
    witness_name TEXT,
    category_filter TEXT,
    total_items_audited INTEGER DEFAULT 0,
    total_overage_qty REAL DEFAULT 0,
    total_shortage_qty REAL DEFAULT 0,
    total_overage_amount REAL DEFAULT 0,
    total_shortage_amount REAL DEFAULT 0,
    net_variance_amount REAL DEFAULT 0,
    digital_signature TEXT,
    hash_signature TEXT,
    minutes_doc TEXT,
    reconciled_at DATETIME,
    reconciled_by INTEGER REFERENCES users(id),
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_audit_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    system_qty REAL NOT NULL,
    physical_qty REAL DEFAULT 0,
    diff_qty REAL DEFAULT 0,
    unit_cost REAL NOT NULL,
    diff_amount REAL DEFAULT 0,
    discrepancy_type TEXT DEFAULT 'match',
    condition_status TEXT DEFAULT 'good',
    auditor_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_quarantine_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarantine_no TEXT UNIQUE NOT NULL,
    item_id INTEGER NOT NULL REFERENCES items(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    project_id INTEGER REFERENCES projects(id),
    quantity REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_loss_amount REAL NOT NULL,
    reason TEXT NOT NULL,
    inspection_notes TEXT,
    bin_location TEXT DEFAULT 'QUARANTINE_BIN_01',
    status TEXT DEFAULT 'quarantined',
    quarantined_by INTEGER REFERENCES users(id),
    quarantined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolution_date DATETIME,
    resolution_notes TEXT,
    resolved_by INTEGER REFERENCES users(id),
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_material_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_no TEXT UNIQUE NOT NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    boq_item_id INTEGER REFERENCES project_boq(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    total_amount REAL NOT NULL,
    condition_status TEXT NOT NULL,
    qc_inspector_id INTEGER REFERENCES users(id),
    qc_inspector_name TEXT NOT NULL,
    qc_notes TEXT,
    qc_passed INTEGER DEFAULT 1,
    salvage_percentage REAL DEFAULT 100,
    credited_amount REAL NOT NULL,
    scrap_loss_amount REAL DEFAULT 0,
    return_date DATE NOT NULL,
    status TEXT DEFAULT 'inspected',
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    quarantine_id INTEGER REFERENCES material_quarantine_items(id),
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inter_project_material_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_no TEXT UNIQUE NOT NULL,
    from_project_id INTEGER NOT NULL REFERENCES projects(id),
    to_project_id INTEGER NOT NULL REFERENCES projects(id),
    from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    quantity REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_amount REAL NOT NULL,
    from_boq_item_id INTEGER REFERENCES project_boq(id),
    to_boq_item_id INTEGER REFERENCES project_boq(id),
    routing_rules_applied TEXT,
    status TEXT DEFAULT 'requested',
    requested_by INTEGER REFERENCES users(id),
    requested_by_name TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    received_by INTEGER REFERENCES users(id),
    received_by_name TEXT,
    rejection_reason TEXT,
    transfer_date DATE NOT NULL,
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_domain_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    event_name TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    user_id INTEGER,
    user_name TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    prev_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL
);

-- ============================================================================
-- جناح التسويات البنكية ومحفظة الشيكات (Bank Reconciliation & Cheques)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id),
    bank_name TEXT NOT NULL,
    account_number TEXT UNIQUE NOT NULL,
    iban TEXT,
    currency TEXT DEFAULT 'ر.ي',
    current_balance REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
    statement_date DATE NOT NULL,
    opening_balance REAL DEFAULT 0,
    closing_balance REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    file_name TEXT,
    status TEXT DEFAULT 'draft',
    imported_by INTEGER REFERENCES users(id),
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    value_date DATE,
    description TEXT NOT NULL,
    reference_no TEXT,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    is_reconciled INTEGER DEFAULT 0,
    matched_entity_type TEXT,
    matched_entity_id TEXT,
    matched_at DATETIME,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reconciliation_no TEXT UNIQUE NOT NULL,
    bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
    statement_id INTEGER REFERENCES bank_statements(id),
    reconciliation_date DATE NOT NULL,
    bank_statement_balance REAL NOT NULL,
    book_balance REAL NOT NULL,
    deposits_in_transit REAL DEFAULT 0,
    outstanding_cheques REAL DEFAULT 0,
    bank_charges_unrecorded REAL DEFAULT 0,
    adjusted_bank_balance REAL NOT NULL,
    adjusted_book_balance REAL NOT NULL,
    variance REAL DEFAULT 0,
    status TEXT DEFAULT 'balanced',
    prepared_by INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    approved_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cheques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cheque_no TEXT NOT NULL,
    type TEXT NOT NULL,
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    drawer_name TEXT,
    beneficiary_name TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ر.ي',
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'pending',
    project_id INTEGER REFERENCES projects(id),
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    payment_id INTEGER REFERENCES payments(id),
    expense_id INTEGER REFERENCES expenses(id),
    clearance_date DATE,
    bounce_date DATE,
    bounce_reason TEXT,
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- جناح الضرائب والخصم من المنبع والضمانات البنكية (Tax Engine & Guarantees)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tax_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tax_code TEXT UNIQUE NOT NULL,
    tax_name TEXT NOT NULL,
    rate_percentage REAL NOT NULL,
    type TEXT NOT NULL,
    law_reference TEXT,
    is_active INTEGER DEFAULT 1,
    legal_disclaimer TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tax_withholdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    withholding_no TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id),
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    source_doc_type TEXT NOT NULL,
    source_doc_id INTEGER NOT NULL,
    base_amount REAL NOT NULL,
    tax_rate REAL NOT NULL,
    tax_amount REAL NOT NULL,
    tax_period TEXT NOT NULL,
    date DATE NOT NULL,
    tax_number TEXT,
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_guarantees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guarantee_no TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    client_id INTEGER REFERENCES clients(id),
    issuing_bank TEXT NOT NULL,
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ر.ي',
    cash_margin_pct REAL DEFAULT 10,
    cash_margin_amount REAL NOT NULL,
    commission_fee REAL DEFAULT 0,
    issue_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    status TEXT DEFAULT 'active',
    release_date DATE,
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    release_journal_entry_id INTEGER REFERENCES journal_entries(id),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- وحدة 15: التحكم المتقدم في المشاريع (Advanced Project Control Suite)
-- ============================================================================

-- 1. أنشطة WBS
CREATE TABLE IF NOT EXISTS project_wbs_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES project_wbs_activities(id) ON DELETE SET NULL,
    wbs_code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    discipline TEXT,
    activity_type TEXT DEFAULT 'task',
    weight REAL DEFAULT 1.0,
    planned_start DATE,
    planned_finish DATE,
    planned_duration_days REAL DEFAULT 0,
    actual_start DATE,
    actual_finish DATE,
    actual_duration_days REAL DEFAULT 0,
    percent_complete REAL DEFAULT 0,
    es_days REAL, ef_days REAL, ls_days REAL, lf_days REAL,
    total_float_days REAL, free_float_days REAL,
    is_critical INTEGER DEFAULT 0,
    status TEXT DEFAULT 'not_started',
    priority TEXT DEFAULT 'medium',
    assigned_to INTEGER REFERENCES users(id),
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. الاعتماديات بين الأنشطة
CREATE TABLE IF NOT EXISTS project_wbs_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    predecessor_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
    successor_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
    dependency_type TEXT DEFAULT 'FS',
    lag_days REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(predecessor_id, successor_id)
);

-- 3. الخط الأساسي للجدول الزمني
CREATE TABLE IF NOT EXISTS project_wbs_baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    planned_start DATE,
    planned_finish DATE,
    planned_duration_days REAL,
    is_current INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. شهادات المهندس/الاستشاري لنسبة الإنجاز
CREATE TABLE IF NOT EXISTS project_engineer_certifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pct REAL NOT NULL CHECK(pct >= 0 AND pct <= 100),
    certified_by INTEGER REFERENCES users(id),
    certified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    certifier_name TEXT,
    certifier_role TEXT,
    inspection_date DATE,
    notes TEXT,
    attachment_base64 TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. لقطات EVM التاريخية
CREATE TABLE IF NOT EXISTS project_evm_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status_date DATE NOT NULL,
    bac REAL, pv REAL, ev REAL, ac REAL,
    cv REAL, sv REAL, cpi REAL, spi REAL,
    eac REAL, etc REAL, vac REAL,
    completion_pct REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, status_date)
);

-- 6. سجل المخاطر (Risk Register - ISO 31000)
CREATE TABLE IF NOT EXISTS project_risk_register (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    risk_ref TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    probability INTEGER NOT NULL CHECK(probability BETWEEN 1 AND 5),
    impact INTEGER NOT NULL CHECK(impact BETWEEN 1 AND 5),
    risk_score INTEGER,
    risk_rating TEXT,
    financial_impact REAL DEFAULT 0,
    schedule_impact_days INTEGER DEFAULT 0,
    treatment_type TEXT DEFAULT 'mitigate',
    treatment_plan TEXT,
    owner_id INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'open',
    review_date DATE,
    last_reviewed_at DATETIME,
    last_reviewed_by INTEGER REFERENCES users(id),
    closure_notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. سجل المطالبات والنزاعات
CREATE TABLE IF NOT EXISTS project_claims_register (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    claim_ref TEXT,
    claim_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    claimed_amount REAL DEFAULT 0,
    claimed_days INTEGER DEFAULT 0,
    approved_amount REAL DEFAULT 0,
    approved_days INTEGER DEFAULT 0,
    submitted_date DATE,
    responsible_party TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'مفتوح',
    supporting_docs TEXT,
    response_notes TEXT,
    resolution_date DATE,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. تقارير عدم المطابقة (NCR)
CREATE TABLE IF NOT EXISTS project_non_conformance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ncr_ref TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT,
    discipline TEXT,
    severity TEXT DEFAULT 'medium',
    responsible_party TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    due_date DATE,
    closed_date DATE,
    status TEXT DEFAULT 'مفتوح',
    verified_by INTEGER REFERENCES users(id),
    verification_notes TEXT,
    reported_by INTEGER REFERENCES users(id),
    reported_date DATE DEFAULT (date('now')),
    attachments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. طلبات المعلومات (RFI)
CREATE TABLE IF NOT EXISTS project_rfi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rfi_ref TEXT,
    subject TEXT NOT NULL,
    description TEXT,
    discipline TEXT,
    submitted_to TEXT,
    submitted_by INTEGER REFERENCES users(id),
    submitted_date DATE DEFAULT (date('now')),
    required_response_date DATE,
    response_date DATE,
    response TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'معلق',
    attachments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. موارد الأنشطة
CREATE TABLE IF NOT EXISTS project_wbs_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    unit TEXT,
    planned_qty REAL DEFAULT 0,
    actual_qty REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- جناح إغلاق المشروع والتقارير التحليلية بنمط CQRS (Command Query Segregation)
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_closeouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    closeout_no TEXT UNIQUE NOT NULL,
    closeout_date DATE NOT NULL,
    closed_by INTEGER REFERENCES users(id),
    closed_by_name TEXT,
    status TEXT DEFAULT 'closed',
    total_contract_value REAL DEFAULT 0,
    total_billed_amount REAL DEFAULT 0,
    total_actual_cost REAL DEFAULT 0,
    gross_profit REAL DEFAULT 0,
    profit_margin_percent REAL DEFAULT 0,
    total_wastage_cost REAL DEFAULT 0,
    site_stock_value REAL DEFAULT 0,
    retention_amount REAL DEFAULT 0,
    net_client_payable REAL DEFAULT 0,
    notes TEXT,
    hash_signature TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- نموذج قراءة مستخلص العميل الخارجي (Client-Facing BoQ Read Model DTO)
CREATE TABLE IF NOT EXISTS project_closeout_client_boq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closeout_id INTEGER NOT NULL REFERENCES project_closeouts(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    boq_item_id INTEGER REFERENCES project_boq(id),
    item_no TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    unit TEXT NOT NULL,
    contract_qty REAL NOT NULL,
    billed_qty REAL NOT NULL,
    contract_unit_rate REAL NOT NULL,
    billable_amount REAL NOT NULL,
    previous_billed_amount REAL DEFAULT 0,
    current_billed_amount REAL DEFAULT 0,
    retention_percent REAL DEFAULT 5.0,
    retention_amount REAL DEFAULT 0,
    net_payable REAL NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- نموذج قراءة مستخلص الرقابة والتدقيق الداخلي (Internal Audit BoQ Read Model)
CREATE TABLE IF NOT EXISTS project_closeout_internal_audit_boq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closeout_id INTEGER NOT NULL REFERENCES project_closeouts(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    boq_item_id INTEGER REFERENCES project_boq(id),
    item_no TEXT NOT NULL,
    item_name TEXT NOT NULL,
    category TEXT,
    unit TEXT NOT NULL,
    baseline_qty REAL NOT NULL,
    purchased_qty REAL DEFAULT 0,
    received_qty REAL DEFAULT 0,
    issued_qty REAL DEFAULT 0,
    consumed_qty REAL DEFAULT 0,
    site_stock_balance REAL DEFAULT 0,
    remaining_baseline REAL DEFAULT 0,
    returned_qty REAL DEFAULT 0,
    damaged_qty REAL DEFAULT 0,
    wastage_qty REAL DEFAULT 0,
    wastage_percent REAL DEFAULT 0,
    budgeted_unit_cost REAL DEFAULT 0,
    budgeted_cost REAL DEFAULT 0,
    actual_unit_cost REAL DEFAULT 0,
    total_actual_cost REAL DEFAULT 0,
    cost_variance REAL DEFAULT 0,
    contract_unit_rate REAL DEFAULT 0,
    contract_revenue REAL DEFAULT 0,
    gross_profit REAL DEFAULT 0,
    profit_margin_percent REAL DEFAULT 0,
    variance_status TEXT DEFAULT 'NORMAL',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_closeouts_proj ON project_closeouts(project_id);
CREATE INDEX IF NOT EXISTS idx_client_boq_closeout ON project_closeout_client_boq(closeout_id);
CREATE INDEX IF NOT EXISTS idx_audit_boq_closeout ON project_closeout_internal_audit_boq(closeout_id);

-- =========================================================================
-- جداول وقوادح حماية دفتر الأستاذ العام والتقارير المالية
-- =========================================================================

CREATE TABLE IF NOT EXISTS cash_flow_account_mappings (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
    activity TEXT NOT NULL CHECK (activity IN ('operating','investing','financing','excluded')),
    is_active INTEGER DEFAULT 1,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS party_account_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_type TEXT NOT NULL CHECK (party_type IN ('client','supplier')),
    party_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(party_type, party_id)
);

CREATE INDEX IF NOT EXISTS idx_je_status_date ON journal_entries(status, date);
CREATE INDEX IF NOT EXISTS idx_jel_entry_account ON journal_entry_lines(entry_id, account_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jel_project ON journal_entry_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_jel_cost_center ON journal_entry_lines(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_payments_date_type_status ON payments(date, type, status);
CREATE INDEX IF NOT EXISTS idx_expenses_date_status ON expenses(date, status);

CREATE TRIGGER IF NOT EXISTS trg_journal_line_leaf_insert
BEFORE INSERT ON journal_entry_lines
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
    FROM accounts a
    WHERE a.id = NEW.account_id
      AND EXISTS (
          SELECT 1
          FROM accounts c
          WHERE c.parent_id = a.id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'لا يمكن تسجيل العملية على حساب أب. يجب اختيار الحساب الفرعي الأخير.'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_line_leaf_update
BEFORE UPDATE OF account_id ON journal_entry_lines
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
    FROM accounts a
    WHERE a.id = NEW.account_id
      AND EXISTS (
          SELECT 1
          FROM accounts c
          WHERE c.parent_id = a.id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'لا يمكن تحديث القيد إلى حساب أب. يجب اختيار الحساب الفرعي الأخير.'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_line_values_insert
BEFORE INSERT ON journal_entry_lines
FOR EACH ROW
WHEN (NEW.debit <= 0 AND NEW.credit <= 0)
  OR (NEW.debit > 0 AND NEW.credit > 0)
  OR (NEW.debit < 0 OR NEW.credit < 0)
BEGIN
    SELECT RAISE(
        ABORT,
        'سطر القيد غير صالح: يجب أن يكون إما مدين أكبر من الصفر فقط أو دائن أكبر من الصفر فقط.'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_line_values_update
BEFORE UPDATE OF debit, credit ON journal_entry_lines
FOR EACH ROW
WHEN (NEW.debit <= 0 AND NEW.credit <= 0)
  OR (NEW.debit > 0 AND NEW.credit > 0)
  OR (NEW.debit < 0 OR NEW.credit < 0)
BEGIN
    SELECT RAISE(
        ABORT,
        'سطر القيد غير صالح: يجب أن يكون إما مدين أكبر من الصفر فقط أو دائن أكبر من الصفر فقط.'
    );
END;


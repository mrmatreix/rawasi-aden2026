-- ============================================================================
-- مخطط قاعدة بيانات نظام رواسي عدن للهندسة والمقاولات (Rawasi Aden System)
-- متوافق 100% مع محرك MySQL (InnoDB, utf8mb4_unicode_ci)
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. جدول الأدوار والصلاحيات
CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(150) NOT NULL,
    permissions TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role_id INT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    email VARCHAR(150) NULL,
    phone VARCHAR(50) NULL,
    status VARCHAR(20) DEFAULT 'active',
    permissions TEXT NULL,
    is_logged_in TINYINT DEFAULT 0,
    session_token VARCHAR(255) NULL,
    last_heartbeat DATETIME NULL,
    last_login_at DATETIME NULL,
    last_login_ip VARCHAR(100) NULL,
    last_login_device VARCHAR(255) NULL,
    active_sessions TEXT NULL,
    security_settings TEXT NULL,
    two_factor_pin VARCHAR(20) DEFAULT '123456',
    two_factor_enabled TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. جدول العملاء
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    company VARCHAR(200) NULL,
    phone VARCHAR(50) NULL,
    email VARCHAR(150) NULL,
    address TEXT NULL,
    previous_balance DECIMAL(15,2) DEFAULT 0,
    total_paid DECIMAL(15,2) DEFAULT 0,
    total_due DECIMAL(15,2) DEFAULT 0,
    current_balance DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. جدول الموردين
CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NULL,
    phone VARCHAR(50) NULL,
    email VARCHAR(150) NULL,
    address TEXT NULL,
    balance DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. جدول المشاريع
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NULL,
    name VARCHAR(255) NOT NULL,
    client_id INT NULL,
    contract_value DECIMAL(15,2) DEFAULT 0,
    estimated_cost DECIMAL(15,2) DEFAULT 0,
    actual_cost DECIMAL(15,2) DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    expected_profit DECIMAL(15,2) DEFAULT 0,
    actual_profit DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    start_date DATE NULL,
    end_date DATE NULL,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. جدول المواد والأصناف
CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NULL,
    unit VARCHAR(50) NULL,
    min_quantity DECIMAL(15,2) DEFAULT 10,
    current_quantity DECIMAL(15,2) DEFAULT 0,
    unit_price DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. حركات المخزون
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NULL,
    project_id INT NULL,
    type VARCHAR(50) NOT NULL,
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    reference_no VARCHAR(100) NULL,
    recipient VARCHAR(150) NULL,
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. فواتير المشتريات
CREATE TABLE IF NOT EXISTS purchases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_no VARCHAR(100) UNIQUE NULL,
    supplier_id INT NULL,
    project_id INT NULL,
    total_amount DECIMAL(15,2) NOT NULL,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'pending',
    payment_method VARCHAR(50) DEFAULT 'نقدي',
    currency VARCHAR(20) DEFAULT 'ر.ي',
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. جدول المصروفات
CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receipt_no VARCHAR(100) UNIQUE NULL,
    expense_type VARCHAR(100) NOT NULL,
    project_id INT NULL,
    supplier_id INT NULL,
    account_id INT NULL,
    cost_center_id INT NULL,
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    payment_method VARCHAR(50) DEFAULT 'نقدي',
    check_no VARCHAR(100) NULL,
    bank_name VARCHAR(150) NULL,
    recipient VARCHAR(150) NULL,
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. جدول الفواتير والمستخلصات
CREATE TABLE IF NOT EXISTS bills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bill_no VARCHAR(100) UNIQUE NULL,
    bill_type VARCHAR(100) DEFAULT 'مستخلص',
    project_id INT NULL,
    client_id INT NULL,
    amount DECIMAL(15,2) NOT NULL,
    deduction DECIMAL(15,2) DEFAULT 0,
    net_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    status VARCHAR(50) DEFAULT 'معتمد',
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. جدول المدفوعات وسندات القبض والصرف
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receipt_no VARCHAR(100) UNIQUE NULL,
    type VARCHAR(50) NOT NULL,
    client_id INT NULL,
    supplier_id INT NULL,
    project_id INT NULL,
    account_id INT NULL,
    cost_center_id INT NULL,
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    payment_method VARCHAR(50) DEFAULT 'نقدي',
    check_no VARCHAR(100) NULL,
    bank_name VARCHAR(150) NULL,
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. جدول النثريات والعهد
CREATE TABLE IF NOT EXISTS custodies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    custody_no VARCHAR(100) UNIQUE NULL,
    operation_type VARCHAR(100) NOT NULL,
    employee_id INT NULL,
    employee_no VARCHAR(50) NULL,
    employee_name VARCHAR(150) NOT NULL,
    related_custody_id INT NULL,
    related_custody_no VARCHAR(100) NULL,
    total_amount DECIMAL(15,2) NOT NULL,
    spent_amount DECIMAL(15,2) DEFAULT 0,
    remaining_amount DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    status VARCHAR(50) DEFAULT 'مفتوحة',
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. جدول حركة الصندوق والبنك
CREATE TABLE IF NOT EXISTS cash_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    previous_balance DECIMAL(15,2) DEFAULT 0,
    cash_in DECIMAL(15,2) DEFAULT 0,
    cash_out DECIMAL(15,2) DEFAULT 0,
    withdrawals DECIMAL(15,2) DEFAULT 0,
    current_balance DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    date DATE NOT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. دليل الحسابات
CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(100) NOT NULL,
    parent_id INT NULL,
    balance DECIMAL(15,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14.ب جدول مراكز التكلفة
CREATE TABLE IF NOT EXISTS cost_centers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(100) DEFAULT 'مشروع',
    project_id INT NULL,
    status VARCHAR(50) DEFAULT 'active',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. القيود اليومية العامة
CREATE TABLE IF NOT EXISTS journal_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entry_no VARCHAR(100) UNIQUE NOT NULL,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    reference_type VARCHAR(100) NULL,
    reference_id INT NULL,
    total_debit DECIMAL(15,2) DEFAULT 0,
    total_credit DECIMAL(15,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. سطور القيود اليومية
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entry_id INT NOT NULL,
    account_id INT NULL,
    project_id INT NULL,
    cost_center_id INT NULL,
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    notes TEXT NULL,
    FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. إعدادات النظام ومعلومات الشركة
CREATE TABLE IF NOT EXISTS settings (
    `key` VARCHAR(150) PRIMARY KEY,
    `value` LONGTEXT NOT NULL,
    description TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- الموارد البشرية
CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY, employee_no VARCHAR(50) NOT NULL UNIQUE, full_name VARCHAR(200) NOT NULL,
    national_id VARCHAR(100) NULL, phone VARCHAR(50) NULL, job_title VARCHAR(150) NULL, department VARCHAR(150) NULL,
    project_id INT NULL, employment_type VARCHAR(50) DEFAULT 'دوام كامل', hire_date DATE NULL,
    basic_salary DECIMAL(15,2) DEFAULT 0, currency VARCHAR(20) DEFAULT 'ر.ي', status VARCHAR(30) DEFAULT 'active',
    bank_name VARCHAR(150) NULL, bank_account VARCHAR(150) NULL, notes TEXT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS attendance (
    id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT NOT NULL, date DATE NOT NULL, status VARCHAR(30) DEFAULT 'present',
    check_in VARCHAR(20) NULL, check_out VARCHAR(20) NULL, overtime_hours DECIMAL(8,2) DEFAULT 0, notes TEXT NULL,
    UNIQUE KEY uq_attendance_employee_date (employee_id, date), FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS employee_leaves (
    id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT NOT NULL, leave_type VARCHAR(50) DEFAULT 'سنوية', start_date DATE NOT NULL, end_date DATE NOT NULL,
    days_count DECIMAL(8,2) DEFAULT 1, status VARCHAR(30) DEFAULT 'pending', notes TEXT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS employee_advances (
    id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT NOT NULL, amount DECIMAL(15,2) NOT NULL, recovered_amount DECIMAL(15,2) DEFAULT 0,
    installment_amount DECIMAL(15,2) DEFAULT 0, date DATE NOT NULL, status VARCHAR(30) DEFAULT 'active', notes TEXT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS payroll (
    id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT NOT NULL, payroll_month VARCHAR(7) NOT NULL, basic_salary DECIMAL(15,2) DEFAULT 0,
    overtime_amount DECIMAL(15,2) DEFAULT 0, deductions DECIMAL(15,2) DEFAULT 0, net_salary DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'draft', paid_date DATE NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payroll_employee_month (employee_id, payroll_month), FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- جداول إدارة المشاريع الهندسية والمقاولات الـ 14 (Project Management Suite)
-- ============================================================================

-- 1. عقد المشروع
CREATE TABLE IF NOT EXISTS project_contracts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    contract_no VARCHAR(100) NULL,
    title VARCHAR(255) NULL,
    first_party VARCHAR(255) NULL,
    second_party VARCHAR(255) NULL,
    contract_date DATE NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    duration_days INT DEFAULT 0,
    contract_value DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    advance_payment_pct DECIMAL(5,2) DEFAULT 0,
    advance_payment_amount DECIMAL(15,2) DEFAULT 0,
    retention_pct DECIMAL(5,2) DEFAULT 10,
    penalty_per_day DECIMAL(15,2) DEFAULT 0,
    max_penalty_pct DECIMAL(5,2) DEFAULT 10,
    payment_terms TEXT NULL,
    scope_of_work TEXT NULL,
    status VARCHAR(50) DEFAULT 'ساري',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. المخططات الهندسية
CREATE TABLE IF NOT EXISTS project_drawings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    drawing_no VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'معماري',
    scale VARCHAR(50) DEFAULT '1:100',
    revision VARCHAR(50) DEFAULT 'Rev 0',
    submission_date DATE NULL,
    approval_date DATE NULL,
    status VARCHAR(50) DEFAULT 'معتمد',
    engineer_name VARCHAR(150) NULL,
    file_name VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. جدول الكميات BOQ
CREATE TABLE IF NOT EXISTS project_boq (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    item_no VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'أعمال خرسانية',
    unit VARCHAR(50) NOT NULL,
    contract_qty DECIMAL(15,2) DEFAULT 0,
    executed_qty DECIMAL(15,2) DEFAULT 0,
    unit_rate DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'جاري التنفيذ',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. عروض الأسعار
CREATE TABLE IF NOT EXISTS project_quotations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NULL,
    client_id INT NULL,
    quotation_no VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    valid_until DATE NULL,
    items_json LONGTEXT NULL,
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount DECIMAL(15,2) DEFAULT 0,
    tax_vat DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(20) DEFAULT 'ر.ي',
    payment_terms TEXT NULL,
    delivery_period VARCHAR(100) NULL,
    status VARCHAR(50) DEFAULT 'مسودة',
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. الميزانية والتكلفة المستهدفة
CREATE TABLE IF NOT EXISTS project_budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    category VARCHAR(150) NOT NULL,
    planned_cost DECIMAL(15,2) DEFAULT 0,
    actual_cost DECIMAL(15,2) DEFAULT 0,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. أوامر التغيير والإضافيات
CREATE TABLE IF NOT EXISTS project_change_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    change_no VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(100) DEFAULT 'إضافة بند جديد',
    request_date DATE NOT NULL,
    approval_date DATE NULL,
    amount DECIMAL(15,2) DEFAULT 0,
    time_extension_days INT DEFAULT 0,
    reason VARCHAR(255) DEFAULT 'طلب المالك',
    status VARCHAR(50) DEFAULT 'معتمد',
    requested_by VARCHAR(150) NULL,
    approved_by VARCHAR(150) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. مشتريات وفواتير المشروع المباشرة
CREATE TABLE IF NOT EXISTS project_purchases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    invoice_no VARCHAR(100) NULL,
    supplier_id INT NULL,
    supplier_name VARCHAR(200) NULL,
    item_description TEXT NOT NULL,
    quantity DECIMAL(15,2) DEFAULT 1,
    unit VARCHAR(50) NULL,
    unit_price DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'مدفوع',
    payment_method VARCHAR(50) DEFAULT 'نقدي',
    date DATE NOT NULL,
    receipt_no VARCHAR(100) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. العمالة والمصروفات الميدانية
CREATE TABLE IF NOT EXISTS project_labor_expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    date DATE NOT NULL,
    worker_name_or_team VARCHAR(200) NOT NULL,
    trade VARCHAR(100) NOT NULL,
    workers_count INT DEFAULT 1,
    daily_rate DECIMAL(15,2) DEFAULT 0,
    days_or_hours DECIMAL(15,2) DEFAULT 1,
    total_amount DECIMAL(15,2) NOT NULL,
    expense_category VARCHAR(100) DEFAULT 'أجور عمالة',
    payment_status VARCHAR(50) DEFAULT 'مدفوع',
    supervisor_name VARCHAR(150) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. مستخلصات وشهادات دفع المشروع IPC
CREATE TABLE IF NOT EXISTS project_invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    client_id INT NULL,
    invoice_no VARCHAR(100) NOT NULL,
    invoice_type VARCHAR(100) DEFAULT 'مستخلص جاري',
    period_from DATE NULL,
    period_to DATE NULL,
    cumulative_work_done DECIMAL(15,2) DEFAULT 0,
    previous_bills_amount DECIMAL(15,2) DEFAULT 0,
    current_gross_amount DECIMAL(15,2) DEFAULT 0,
    advance_deduction DECIMAL(15,2) DEFAULT 0,
    retention_deduction DECIMAL(15,2) DEFAULT 0,
    other_deductions DECIMAL(15,2) DEFAULT 0,
    net_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'معتمد للصرف',
    date DATE NOT NULL,
    approval_date DATE NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. التقارير اليومية للموقع
CREATE TABLE IF NOT EXISTS project_daily_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    report_no VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    weather VARCHAR(100) DEFAULT 'مشمس ومناسب للعمل',
    manpower_count INT DEFAULT 0,
    equipment_summary TEXT NULL,
    work_performed LONGTEXT NOT NULL,
    materials_received TEXT NULL,
    safety_notes TEXT NULL,
    delays_obstacles TEXT NULL,
    site_engineer VARCHAR(150) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. التقارير الأسبوعية للموقع
CREATE TABLE IF NOT EXISTS project_weekly_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    report_no VARCHAR(100) NOT NULL,
    week_no INT DEFAULT 1,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    planned_progress_pct DECIMAL(5,2) DEFAULT 0,
    actual_progress_pct DECIMAL(5,2) DEFAULT 0,
    achievements_summary LONGTEXT NOT NULL,
    next_week_plan TEXT NULL,
    critical_issues TEXT NULL,
    prepared_by VARCHAR(150) NULL,
    approved_by VARCHAR(150) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. محاضر الاستلام والفحص الهندسي
CREATE TABLE IF NOT EXISTS project_handover_minutes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    minute_no VARCHAR(100) NOT NULL,
    type VARCHAR(150) NOT NULL,
    location_axis VARCHAR(150) NULL,
    inspection_date DATE NOT NULL,
    inspector_name VARCHAR(150) NOT NULL,
    contractor_rep VARCHAR(150) NULL,
    status VARCHAR(100) DEFAULT 'معتمد ومقبول',
    punch_list TEXT NULL,
    recommendations TEXT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. المراسلات مع المالك والاستشاري
CREATE TABLE IF NOT EXISTS project_correspondence (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    ref_no VARCHAR(100) NOT NULL,
    direction VARCHAR(100) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    priority VARCHAR(50) DEFAULT 'عادي',
    summary_body LONGTEXT NOT NULL,
    required_action TEXT NULL,
    response_status VARCHAR(100) DEFAULT 'قيد الإجراء',
    sender VARCHAR(150) NULL,
    recipient VARCHAR(150) NULL,
    attachment_name VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. الحساب الختامي وتصفية المشروع
CREATE TABLE IF NOT EXISTS project_final_settlements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    settlement_no VARCHAR(100) NOT NULL UNIQUE,
    date DATE NOT NULL,
    original_contract_val DECIMAL(15,2) DEFAULT 0,
    approved_change_orders_val DECIMAL(15,2) DEFAULT 0,
    revised_contract_val DECIMAL(15,2) DEFAULT 0,
    total_executed_work_val DECIMAL(15,2) DEFAULT 0,
    total_client_payments_received DECIMAL(15,2) DEFAULT 0,
    released_retention_val DECIMAL(15,2) DEFAULT 0,
    penalties_deductions_val DECIMAL(15,2) DEFAULT 0,
    final_balance_due DECIMAL(15,2) DEFAULT 0,
    due_to VARCHAR(100) DEFAULT 'لصالح المقاول',
    status VARCHAR(100) DEFAULT 'معتمد وموقع',
    prepared_by VARCHAR(150) NULL,
    approved_by VARCHAR(150) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================
-- جداول الإدارات المؤسسية الجديدة (ERP Modules Support)
-- ========================================================

-- جدول تهيئة العملات وأسعار الصرف
CREATE TABLE IF NOT EXISTS currencies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    rate_to_base DECIMAL(12,4) DEFAULT 1.0,
    is_base TINYINT(1) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- جدول تهيئة أنواع الإجازات
CREATE TABLE IF NOT EXISTS leave_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    days_allowed INT DEFAULT 30,
    is_paid TINYINT(1) DEFAULT 1,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- جدول تقييم أداء الموظفين
CREATE TABLE IF NOT EXISTS employee_evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    evaluator_name VARCHAR(150) NULL,
    period VARCHAR(100) NOT NULL,
    evaluation_date DATE NOT NULL,
    score DECIMAL(5,2) DEFAULT 100,
    rating VARCHAR(50) DEFAULT 'ممتاز',
    strengths TEXT NULL,
    improvements TEXT NULL,
    recommendations TEXT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;


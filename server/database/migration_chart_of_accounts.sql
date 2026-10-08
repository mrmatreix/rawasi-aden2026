-- ============================================================================
-- نظام شركة رواسي عدن للهندسة والمقاولات
-- ملف ترحيل واستيراد دليل الحسابات الشجري الموحد (112 حساباً معيارياً)
-- متوافق مع معايير المحاسبة الدولية (IFRS) وقواعد بيانات SQLite و MySQL
-- ============================================================================

-- 1. تنظيف جداول مؤقتة إن وجدت
DROP TABLE IF EXISTS accounts_import;

-- 2. إنشاء جدول الحسابات بالبنية الهرمية المعيارية الجديدة
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(30) NOT NULL,
    parent_code VARCHAR(20) NULL,
    parent_id INTEGER NULL,
    level INTEGER NOT NULL,
    is_posting BOOLEAN NOT NULL DEFAULT 0,
    currencies TEXT DEFAULT 'YER',
    report_type VARCHAR(50) NOT NULL,
    inclusion TEXT NULL DEFAULT '=',
    is_contra BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    balance REAL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. إنشاء الفهارس لتسريع الاستعلامات الشجرية والتقارير المالية
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code ON accounts (code);
CREATE INDEX IF NOT EXISTS idx_accounts_parent_code ON accounts (parent_code);
CREATE INDEX IF NOT EXISTS idx_accounts_parent_id ON accounts (parent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts (type);
CREATE INDEX IF NOT EXISTS idx_accounts_is_posting ON accounts (is_posting);
CREATE INDEX IF NOT EXISTS idx_accounts_level ON accounts (level);
CREATE INDEX IF NOT EXISTS idx_accounts_report_type ON accounts (report_type);

-- 4. إدراج جميع الحسابات المعيارية بالترتيب الهرمي (المستويات 1 إلى 5)
BEGIN TRANSACTION;

INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('1', 'الاصول', 'asset', NULL, 1, 0, 'YER', 'balance_sheet', 'الاصول', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('2', 'الالتزامات', 'liability', NULL, 1, 0, 'YER', 'balance_sheet', 'الالتزامات', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('3', 'المصاريف', 'expense', NULL, 1, 0, 'YER', 'income_statement', 'المصاريف', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('4', 'الايرادات', 'revenue', NULL, 1, 0, 'YER', 'income_statement', 'الايرادات', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('11', 'الاصول الثابتة', 'asset', '1', 2, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12', 'الاصول المتداولة', 'asset', '1', 2, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21', 'التزامات طويلة الاجل', 'liability', '2', 2, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22', 'التزامات قصيرة الاجل', 'liability', '2', 2, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('31', 'مصاريف النشاط', 'expense', '3', 2, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32', 'مصاريف ادارية', 'expense', '3', 2, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41', 'ايرادات النشاط', 'revenue', '4', 2, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('111', 'الاثاث والتجهيزات', 'asset', '11', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('112', 'السيارات', 'asset', '11', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('113', 'الأصول غير المتداولة', 'asset', '11', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('121', 'الصناديق', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('122', 'البنوك', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('123', 'العملاء', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('124', 'المخزون', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('126', 'مدينون اخرون', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('127', 'عهد وسلف الموظفين', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('128', 'الارصدة المدينة الاخرى', 'asset', '12', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('211', 'حقوق الملكية', 'equity', '21', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('221', 'الموردون', 'liability', '22', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('222', 'ارصدة دائنة', 'liability', '22', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('223', 'ارصدة دائنة - منصة تحصيل', 'liability', '22', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('224', 'الارصدة الدائنة الاخرى', 'liability', '22', 3, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('311', 'مصاريف النشاط', 'expense', '31', 3, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('321', 'مصاريف ادارية و عامة', 'expense', '32', 3, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('411', 'ايرادات النشاط', 'revenue', '41', 3, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('412', 'ايرادات اخرى', 'revenue', '41', 3, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('11101', 'الاثاث المكتبي', 'asset', '111', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('11301', 'الأصول غير المتداولة', 'asset', '113', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12101', 'صندوق الادارة', 'asset', '121', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12201', 'البنوك', 'asset', '122', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12301', 'عملاء محلييون', 'asset', '123', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12401', 'المخزون', 'asset', '124', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12601', 'اشعارات مدينة', 'asset', '126', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12701', 'عهد الموظفين ( عهد تشغيليه)', 'asset', '127', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12801', 'المصروفات المدفوعه مقدماً', 'asset', '128', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12802', 'الايرادات المستحقة', 'asset', '128', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21101', 'راس المال', 'equity', '211', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21102', 'الاحتياطيات', 'equity', '211', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21103', 'مجمعات الإهلاك', 'asset', '211', 4, 0, 'YER', 'balance_sheet', '=', 1, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22101', 'موردون محلييون', 'liability', '221', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22102', 'موردون خارجيون', 'liability', '221', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22201', 'اوراق الدفع', 'liability', '222', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22202', 'دائنون متنوعون', 'liability', '222', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22301', 'حسابات مفوترين تحصيل', 'liability', '223', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22302', 'حسابات تحصيل المؤسسة المالية', 'liability', '223', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22303', 'حسابات وسيطة - تحصيل', 'liability', '223', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22401', 'المصاريف المستحقة', 'liability', '224', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22402', 'الايرادات المدفوعة مقدما', 'liability', '224', 4, 0, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('31101', 'عمولات بنكية', 'expense', '311', 4, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101', 'المرتبات والاجور', 'expense', '321', 4, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102', 'المصاريف الادارية', 'expense', '321', 4, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41101', 'عمولات', 'revenue', '411', 4, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41201', 'ايرادات راسمالية', 'revenue', '412', 4, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41203', 'ايرادات اخرى', 'revenue', '412', 4, 0, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('11101001', 'الاثاث المكتبي', 'asset', '11101', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('11301001', 'مصاريف التأسيس', 'asset', '11301', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12101001', 'صندوق الادارة', 'asset', '12101', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12201001', 'بنوك', 'asset', '12201', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12201002', 'البنك المركزي اليمني', 'asset', '12201', 5, 1, 'YER,SAR,USD', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12301001', 'عملاء محلييون', 'asset', '12301', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12401001', 'المخزون', 'asset', '12401', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12601001', 'اشعارات مدينة', 'asset', '12601', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12601002', 'اوراق قبض', 'asset', '12601', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12701001', 'عهد الموظفين', 'asset', '12701', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12701002', 'سلف الموظفين', 'asset', '12701', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('12801001', 'مصاريف مدفوعه مقدماً', 'asset', '12801', 5, 1, 'USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21101001', 'راس المال', 'equity', '21101', 5, 1, 'YER,SAR,USD', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21101002', 'الارباح والخسائر', 'equity', '21101', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21102001', 'الاحتياطي القانوني', 'equity', '21102', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21102002', 'الاحتياطي النقدي', 'equity', '21102', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('21103001', 'مجمع الإهلاكات', 'asset', '21103', 5, 1, 'YER', 'balance_sheet', '=', 1, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22101001', 'موردون محلييون', 'liability', '22101', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22102001', 'موردون خارجيون', 'liability', '22102', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22201001', 'اوراق الدفع', 'liability', '22201', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22202001', 'ضرائب مرتبات واجور  مستحقه الدفع', 'liability', '22202', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22202002', 'التامينات الاجتماعية مستحقه الدفع', 'liability', '22202', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22202003', 'ح دائنون تيسير', 'liability', '22202', 5, 1, 'SAR,USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22202004', 'صندوق تنميه المهارات', 'liability', '22202', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22301001', 'حسابات مفوترين تحصيل', 'liability', '22301', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22302001', 'حسابات تحصيل المؤسسة المالية', 'liability', '22302', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22303001', 'حسابات وسيطة - تحصيل', 'liability', '22303', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22401001', 'مرتبات واجور مستحقه الدفع', 'liability', '22401', 5, 1, 'USD,YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('22401002', 'المصاريف المستحقه', 'liability', '22401', 5, 1, 'YER', 'balance_sheet', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('31101001', 'عمولات بنكية', 'expense', '31101', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101001', 'بدل انتقال', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101002', 'بدل مظهر', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101003', 'بدل طبيعة العمل', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101004', 'بدل معيشة', 'expense', '32101', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101005', 'تامين صحي', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101006', 'مصاريف التامين الاجتماعي', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101007', 'ضريبه المرتبات والاجور', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101008', 'المرتبات والاجور الاساسيه', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101009', 'اكراميات', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32101010', 'صندوق تنميه المهارات', 'expense', '32101', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102001', 'م. ماء وكهرباء', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102002', 'م.تلفون وانترنت', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102003', 'م. صيانة المكتب', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102004', 'م. برمجيات وصيناتها', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102005', 'مصاريف تشغيليه متنوعه', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102006', 'مصاريف ضيافة', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102007', 'مصاريف دعايه واعلان و تسويق', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102008', 'م بدل السفر والانتقال والمواصلات', 'expense', '32102', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('32102009', 'مصروف نثريات', 'expense', '32102', 5, 1, 'USD,YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41101001', 'عمولة تحصيل', 'revenue', '41101', 5, 1, 'YER,SAR,USD', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41201001', 'ايرادات بيع اصول', 'revenue', '41201', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41203001', 'ايرادات اخرى', 'revenue', '41203', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41203002', 'ايرادات فروق عمله', 'revenue', '41203', 5, 1, 'YER,SAR,USD', 'income_statement', '=', 0, 1, 'active');
INSERT INTO accounts (code, name, type, parent_code, level, is_posting, currencies, report_type, inclusion, is_contra, is_active, status)
VALUES ('41203003', 'ايراد الجزاءات والغياب', 'revenue', '41203', 5, 1, 'YER', 'income_statement', '=', 0, 1, 'active');

-- 5. تحديث parent_id استناداً إلى parent_code لربط المعرفات الرقمية
UPDATE accounts
SET parent_id = (SELECT p.id FROM accounts p WHERE p.code = accounts.parent_code)
WHERE parent_code IS NOT NULL;

COMMIT;

-- ============================================================================
-- 6. استعلامات التحقق الإحصائي وصحة البنية الهرمية
-- ============================================================================

-- 1. إجمالي الحسابات المسجلة (المتوقع: 112 حساباً)
SELECT COUNT(*) as total_accounts FROM accounts;

-- 2. توزيع الحسابات حسب المستويات الهرمية (1 إلى 5)
SELECT level, COUNT(*) as count FROM accounts GROUP BY level ORDER BY level;

-- 3. عدد الحسابات القابلة للترحيل وقبول القيود والسندات (Level 5)
SELECT COUNT(*) as posting_accounts FROM accounts WHERE is_posting = 1;

-- 4. توزيع الحسابات حسب التصنيف المحاسبي المعتمد (IFRS)
SELECT type, COUNT(*) as count FROM accounts GROUP BY type ORDER BY count DESC;

-- 5. التحقق الصارم: عدم وجود أي حساب فرعي بدون أب
SELECT child.code, child.name 
FROM accounts child
LEFT JOIN accounts parent ON child.parent_code = parent.code
WHERE child.parent_code IS NOT NULL AND parent.id IS NULL;

-- 6. التحقق الصارم: التأكد من أن الحسابات القابلة للترحيل (is_posting=1) هي حسابات طرفية ليس لها أبناء
SELECT a.code, a.name, COUNT(c.id) as children_count
FROM accounts a
LEFT JOIN accounts c ON c.parent_code = a.code
WHERE a.is_posting = 1 AND c.id IS NOT NULL
GROUP BY a.id;

-- 7. توزيع العملات على الحسابات
SELECT currencies, COUNT(*) as accounts_count FROM accounts GROUP BY currencies;

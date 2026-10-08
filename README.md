# 🏗️ نظام رواسي عدن للهندسة والمقاولات

### Rawasi Aden Integrated Construction Management System

<p align="center">
  <img src="images/logo.svg" alt="Rawasi Aden Logo" width="120" />
</p>

<p align="center">
  <strong>النظام المحاسبي والإداري المتكامل لإدارة شركات المقاولات والهندسة المدنية</strong><br>
  <em>Integrated Accounting & Construction Management Platform</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-Proprietary-red" alt="License">
  <img src="https://img.shields.io/badge/platform-Web%20%7C%20Windows%20%7C%20Android-green" alt="Platform">
  <img src="https://img.shields.io/badge/lang-العربية-gold" alt="Language">
</p>

---

## 📌 نبذة عن النظام

نظام سحابي ومحلي متكامل لإدارة شركات المقاولات والهندسة المدنية، مصمم ومطور خصيصاً لشركة **رواسي عدن للهندسة والمقاولات** وفق أعلى المعايير الفنية والمالية:

- 🎨 **واجهة فاخرة** (Dark Navy & Gold Luxury Theme)
- 🔗 **بنية معمارية موزعة** (Modular Architecture)
- 💾 **قاعدة بيانات مزدوجة** (SQLite محلي + Cloudflare D1)
- 📱 **Multi-Platform** (Web / Windows EXE / Android APK / PWA)
- 📊 **متوافق مع IFRS 15** (Revenue Recognition)
- 🛡️ **حماية متقدمة** (2FA + Hash Chain + Audit Trail)

---

## 🌟 الميزات الرئيسية

### 🏗️ 1. إدارة المشاريع الإنشائية

- **مركز مستندات المشروع (21 تبويباً):** عقد، مخططات، BOQ، عروض أسعار، ميزانية، أوامر تغيير، مشتريات، عمالة، مستخلصات، تقارير يومية/أسبوعية، محاضر استلام، مراسلات، حساب ختامي، أرشيف، عرض سعر متكامل، رقابة ذكية، WBS، EVM، مخاطر، **Sprint Board**.
- **جدول الكميات (BOQ) المتقدم:** محرك داخلي + استيراد/تصدير Excel + ربط بالمخزون والموردين.
- **المستخلصات (FIDIC IPC):** إصدار آلي من إنجاز BOQ مع استقطاعات تلقائية.
- **القيمة المكتسبة (EVM):** SPI، CPI، TCPI لحظياً.
- **الجدول الزمني (WBS/CPM):** مع المسار الحرج والاعتماديات.

### 💰 2. المحاسبة والمالية

- **القيد المزدوج الكامل:** كل حركة تُنتج قيداً متوازناً تلقائياً.
- **دليل حسابات شجري** متعدد المستويات.
- **سندات القبض والصرف** مع ترويسة رسمية وطباعة PDF.
- **العهد والنثريات** مع تتبع كامل للتصفية.
- **الصندوق والبنك** مع كشف تفصيلي لكل حساب.
- **الفترات المحاسبية** مع إقفال نهائي بكلمة مرور المدير.
- **سجل التدقيق (Audit Trail)** لكافة العمليات.

### 📊 3. التقارير المالية

- **ميزان المراجعة** بالأرصدة والمجاميع.
- **قائمة الدخل** و**الأرباح والخسائر**.
- **الميزانية العمومية** (أصول/خصوم جنباً إلى جنب).
- **التدفقات النقدية** (تشغيلي/استثماري/تمويلي).
- **ربحية المشاريع ومراكز التكلفة**.
- **كشوف حساب العملاء والموردين**.
- **تصدير Excel** يدعم العربية (UTF-8).

### 🎯 4. مركز ربحية المشروع (Real-time Profitability Center)

- حساب **15 حقلاً** من حقول الربحية تلقائياً:
  - قيمة العقد، أوامر التغيير، العقد المعدل، نسبة الإنجاز POC
  - المفوتر، المحصل، تكاليف المواد/العمالة/المقاولين
  - المصروفات المباشرة/غير المباشرة، الالتزامات المستقبلية
  - الربح المتوقع، الفعلي، هامش الربح %
- **تحديث فوري** مع كل عملية (< 500ms).
- **تنبيهات ذكية** عند تجاوز نسب معينة.
- **متوافق مع IFRS 15** (POC Method).

### 📦 5. المخزون والمشتريات (DDD Architecture)

- **دورة مواد كاملة:** شراء → استلام → صرف → إرجاع → تحويل → هالك.
- **جرد دوري ومفاجئ** مع محاضر رقابية.
- **حجر المواد التالفة والخردة**.
- **مرتجعات الموقع** مع فحص جودة QC.
- **التحويلات بين المشاريع** (Maker-Checker).
- **سجل أحداث مشفر (Hash Chain SHA-256)** — غير قابل للتلاعب.

### 👥 6. الموارد البشرية (HR)

- **ملفات الموظفين** الكاملة.
- **الحضور والانصراف** مع الأذونات.
- **الإجازات** (أنواع وسياسات مخصصة).
- **السلف** مع التقسيط التلقائي.
- **مسيرات الرواتب الشاملة** (26 عمود: 6 بدلات + 4 استقطاعات + تأمينات + ضريبة + صندوق تنمية المهارات).
- **تقييم الأداء** مع الحوافز والخصومات.

### 🏢 7. العملاء والموردين (CRM / SRM)

- **دليل العملاء** مع كشوف حساب تفصيلية.
- **ملف المورد الكامل** (SRM Profile):
  - بيانات تجارية + حسابات بنكية (IBAN)
  - سياسة الصرف ومدة التوريد
  - **ماسح ضوئي مباشر** للفواتير بالكاميرا
  - تجميعات مالية آلية (Real-time)
- **كشوف حساب مفصلة** مع طباعة PDF.

### 🔒 8. الأمان والنسخ الاحتياطي

- **مصادقة متقدمة:** 2FA (PIN + كود طوارئ) + CSRF Token + Rate Limiting.
- **سياسة الجلسات:** جهاز واحد / متعدد (سقف محدد).
- **ساعات عمل مسموحة** (تقييد الدخول خارج أوقات الدوام).
- **قفل تلقائي للشاشة** (1-60 دقيقة).
- **نسخ احتياطي مجدول:** يومي/أسبوعي مع حفظ تلقائي في مسار مخصص.
- **أرشيف مشفر شامل:** AES-256-GCM + PBKDF2 (100K).
- **مزامنة سحابية:** Cloud Vault / Google Drive / OneDrive / Webhook.
- **نسخ الخروج التلقائية** عند كل تسجيل خروج.

### 🎨 9. الواجهة وتجربة المستخدم

- **PWA كامل:** تثبيت + عمل أوفلاين.
- **Dark/Light Mode** بضغطة زر.
- **بحث شامل (Ctrl+K):** Spotlight-style Command Palette.
- **Breadcrumbs** دلالية.
- **Skeleton Loaders** أثناء التحميل.
- **Toast Notifications** احترافية.
- **تصميم متجاوب** (Desktop/Tablet/Mobile).

---

## 🏗️ البنية المعمارية

```text
rawasi-aden/
├── 📁 .github/workflows/      # CI/CD — GitHub Actions
├── 📁 android/                # تطبيق Android (Capacitor)
├── 📁 assets/                 # أصول ثابتة (خطوط، أيقونات)
├── 📁 css/                    # التنسيقات
│   └── style.css              # نظام التصميم الكامل (RTL + Luxury Theme)
├── 📁 docs/                   # توثيق فني مفصل
├── 📁 docs_presentation/      # عروض تقديمية
├── 📁 images/                 # الشعارات والصور
├── 📁 js/                     # منطق الواجهة (Frontend)
│   ├── app.js                 # المنظم العام والتنقل
│   ├── auth.js                # المصادقة والجلسات
│   ├── accounting.js          # السندات والقيود والعهد
│   ├── projects.js            # المشاريع والتكاليف
│   ├── project_hub.js         # مركز مستندات المشروع (20+ تبويب)
│   ├── project_control_ui.js  # الرقابة والتحكم (WBS/EVM/Risks)
│   ├── project_closeout.js    # إغلاق المشروع (CQRS)
│   ├── profitability.js       # 🆕 محرك ربحية المشروع
│   ├── profitability-ui.js    # 🆕 واجهة الربحية
│   ├── sprint_board.js        # 🆕 لوحة Sprint التنفيذية
│   ├── inventory.js           # المخزون والمواد
│   ├── hr.js                  # الموارد البشرية والرواتب
│   ├── reports.js             # التقارير والرسوم البيانية
│   ├── settings.js            # الإعدادات والأمان
│   ├── events.js              # Event Delegation System
│   ├── ui-ux.js               # Global Search + Toasts + Modals
│   ├── excel-export.js        # تصدير Excel العربي
│   ├── tafqeet.js             # التفقيط (المبلغ كتابة)
│   ├── xlsx.full.min.js       # SheetJS
│   └── env.js                 # كشف البيئة (Dev/Prod)
├── 📁 scripts/                # سكريبتات مساعدة
├── 📁 server/                 # 🖥️ الخادم (Backend)
│   ├── server.js              # Express.js (المنفذ 5500)
│   ├── database/
│   │   ├── db.js              # node:sqlite المدمج
│   │   ├── schema.sql         # مخطط الجداول الكامل
│   │   └── seed.js            # بذر البيانات الأولية
│   └── routes/                # 13 مسار API
│       ├── auth.js            # /api/auth
│       ├── users.js           # /api/users
│       ├── projects.js        # /api/projects
│       ├── inventory.js       # /api/inventory
│       ├── purchases.js       # /api/purchases
│       ├── expenses.js        # /api/expenses
│       ├── billing.js         # /api/billing
│       ├── payments.js        # /api/payments
│       ├── accounting.js      # /api/accounting
│       ├── reports.js         # /api/reports
│       ├── clients.js         # /api/clients
│       ├── suppliers.js       # /api/suppliers
│       └── settings.js        # /api/settings
├── 📁 src_exe/                # بناء EXE للويندوز
├── 📁 tests/                  # اختبارات آلية
├── 📁 tools/                  # أدوات تطوير
├── 📁 views/                  # 🆕 قوالب HTML منفصلة
│   ├── dashboard.html
│   ├── projects.html
│   ├── accounting.html
│   ├── inventory.html
│   ├── hr.html
│   ├── reports.html
│   ├── settings.html
│   ├── project_closeout.html
│   └── modals/                # نوافذ منفصلة
├── 📁 www/                    # نشر الويب (Cloudflare Pages)
├── index.html                 # الصفحة الرئيسية (SPA)
├── manifest.json              # PWA Manifest
├── sw.js                      # Service Worker
├── package.json               # الحزم والتبعيات
├── capacitor.config.json      # إعدادات Capacitor
├── wrangler.jsonc             # إعدادات Cloudflare Workers
├── build.ps1                  # سكريبت بناء Windows
└── README.md                  # هذا الملف
```

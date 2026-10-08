# دليل بناء ونشر تطبيق وبوابة العملاء (Client Portal & Android App)
### نظام شركة رواسي عدن للهندسة والمقاولات

---

## 📌 1. نظرة عامة والمعمارية (Architecture)

تطبيق وبوابة العملاء هو نظام مخصص لعملاء شركة **رواسي عدن للهندسة والمقاولات** يتيح لكل عميل متابعة كافة مشاريعه، نسب الإنجاز الميداني، مستخلصاته (IPCs)، سجل دفعاته ومقبوضاته، والمخططات الهندسية والتقارير اليومية مع إمكانية اعتماد أو طلب تعديل المستخلصات بضغطة زر.

### 🛡️ المبدأ الحاكم: Deny by Default
- **عزل صارم للبيانات (Strict Tenant Isolation):** كل عميل يرى فقط السجلات المرتبطة بـ `client_id` الخاص به.
- **حظر تام للبيانات المالية الداخلية:** لا يمكن للعميل رؤية التكاليف الفعلية للمشاريع (`actual_cost`)، الأرباح المتوقعة أو الفعلية (`profit`)، تفاصيل الموردين، أو رواتب المقاولين والعمال.
- **الفلترة في الـ Backend:** الفلترة تطبق على مستوى استعلامات SQL وليس على مستوى الواجهة فقط.

---

## 📱 2. هيكل مجلد التطبيق (Capacitor App Structure)

```text
client-app/
├── www/
│   ├── index.html            # شاشة تسجيل الدخول + التحقق بالـ OTP
│   ├── dashboard.html        # لوحة التحكم ومؤشرات المشاريع
│   ├── projects.html         # قائمة المشاريع ونسب الإنجاز
│   ├── project-details.html  # تفاصيل المشروع (عقد، مستخلصات، دفعات، مخططات)
│   ├── invoices.html         # سجل المستخلصات + اعتماد / رفض بملاحظات
│   ├── payments.html         # سجل سندات القبض والمبالغ المحصلة
│   ├── notifications.html    # مركز الإشعارات الفورية
│   ├── messages.html         # التواصل المباشر مع إدارة الشركة
│   ├── profile.html          # الملف الشخصي وإعدادات الأمان
│   ├── css/client-theme.css  # ثيم دارك نافي وذهبي (Mobile-First & RTL)
│   └── js/
│       ├── client-api.js     # محرك الاتصال والتخزين المحلي Offline
│       ├── client-auth.js    # إدارة الجلسة والـ JWT
│       ├── client-app.js     # المكونات المشتركة والأشرطة
│       ├── push-notifications.js # تكامل Capacitor FCM
│       └── secure-storage.js # التخزين الآمن للجلسات
├── capacitor.config.json     # إعدادات Capacitor للهواتف
└── package.json
```

---

## 🛠️ 3. خطوات بناء ونشر تطبيق أندرويد (Android Build Steps)

### المتطلبات الأساسية:
- Node.js (الإصدار 18 فما فوق)
- Android Studio (مع Android SDK 33 أو أحدث)
- JDK 17

### خطوات التنفيذ:

```bash
# 1. الانتقال إلى مجلد تطبيق العميل
cd client-app

# 2. تثبيت الحزم المطلوبة
npm install

# 3. مزامنة ملفات الويب مع بيئة أندرويد الأصلية
npx cap add android   # (لأول مرة فقط إن لم يكن مجلد android موجوداً)
npx cap sync android

# 4. فتح المشروع في Android Studio
npx cap open android
```

### استخراج ملف الـ APK النهائي (Signed Release APK):
1. في Android Studio، افتح القائمة: **Build ➔ Generate Signed Bundle / APK**.
2. اختر **APK** واضغط **Next**.
3. حدد مفتاح التوقيع الرقمي للشركة (`Key store path`) أو أنشئ مفتاحاً جديداً.
4. اختر نوع البناء **release** مع تحديد خياري التوقيع `V1 (Jar Signature)` و `V2 (Full APK Signature)`.
5. اضغط **Finish**.
6. ستجد ملف الـ APK جاهزاً في:
   ```text
   client-app/android/app/release/app-release.apk
   ```

---

## 🔔 4. إعداد خدمة الإشعارات (Firebase Cloud Messaging - FCM)

1. أنشئ مشروعاً في **Firebase Console** وأضف تطبيق Android بالمعرف:
   `com.rawasiaden.clientportal`
2. حمّل ملف `google-services.json` وضعه داخل:
   `client-app/android/app/google-services.json`
3. في ملف `.env` الخاص بالخادم (Backend)، أضف مفتاح الخادم:
   ```env
   FCM_SERVER_KEY="your-firebase-server-key"
   ```

---

## 📡 5. وضع العمل دون اتصال (Offline Mode)

- يدعم التطبيق التخزين المؤقت الذكي عبر `client-api.js` و `secure-storage.js`.
- عند ضعف أو انقطاع الإنترنت:
  1. يظهر شريط تنبيه أحمر في أعلى الشاشة يُعلم العميل بأنه يعمل دون اتصال.
  2. يتم عرض آخر نسخة بيانات تم تحميلها من الـ Cache تلقائياً.
  3. عند عودة الاتصال، يختفي الشريط ويتم تحديث البيانات لحظياً.

---

## 🔐 6. بيانات الحساب التجريبي المعتمد للاختبار

- **البريد الإلكتروني:** `client@manara.com`
- **كلمة المرور:** `Client@123456`
- **رمز التحقق بخطوتين (PIN / OTP):** `123456`
- **الشركة المعتمدة:** شركة المنارة للاستثمار والتطوير العقاري (مشروع برج المنارة).

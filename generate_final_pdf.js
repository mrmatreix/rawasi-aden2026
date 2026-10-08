const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');

const screens = [
  {
    num: "01",
    title: "بوابة الدخول والمصادقة الأمنية (Login Gateway)",
    tag: "الأمان وحماية البيانات",
    img: "01_شاشة_تسجيل_الدخول_Login.png",
    purpose: "تأمين النظام ضد الدخول غير المصرح به، والتحقق من الجلسات النشطة، ومنع التكرار المتزامن للحسابات، مع توفير أزرار دخول سريع تجريبية وأزرار إغلاق آمن مع حفظ نسخة احتياطية فورية.",
    features: [
      "تشفير كلمات المرور والربط المباشر مع جدول المستخدمين بقاعدة البيانات SQLite.",
      "فحص نبض الجلسة الدورية (Session Heartbeat) كل 25 ثانية لحماية النظام.",
      "أزرار دخول سريع للحسابات القيادية (المدير العام، المحاسب، المشرف الهندسي).",
      "زر إغلاق النظام مع أخذ نسخة احتياطية مشفرة وفورية للبيانات."
    ],
    value: "توفير أعلى معايير الخصوصية والأمان المالي وحماية أسرار ووثائق الشركة."
  },
  {
    num: "02",
    title: "لوحة المؤشرات والتحكم الرئيسية (Live Dashboard & KPIs)",
    tag: "الإدارة العليا والرقابة",
    img: "02_لوحة_التحكم_الرئيسية_Dashboard.png",
    purpose: "إعطاء الإدارة العامة والمدير التنفيذي نظرة بانورامية حية وشاملة لكافة الأرقام التشغيلية والمالية ومؤشرات أداء المشاريع في لمحة بصرية واحدة دون الحاجة للدخول في التفاصيل المعقدة.",
    features: [
      "شبكة الـ 8 بطاقات الذكية: (إجمالي الدخل، إجمالي المصروفات، صافي الأرباح، رصيد الصندوق، مستحقات العملاء، مستحقات الموردين، المشاريع النشطة، ونسب الإنجاز).",
      "رسم بياني دائري تفاعلي (Donut Chart) يوضح توزيع المصروفات حسب التصنيف والنسبة المئوية.",
      "رسم بياني خطي لمسار التدفقات النقدية (الإيرادات والمصروفات) عبر الأشهر السابقة.",
      "جدول المعاملات والمستندات الموقعية والمالية الحديثة فور حدوثها في الموقع."
    ],
    value: "اتخاذ قرارات إدارية واستثمارية حاسمة مبنية على أرقام حية ودقيقة لحظة بلحظة."
  },
  {
    num: "03",
    title: "إدارة المشاريع الإنشائية والهندسية (Projects Suite)",
    tag: "العمليات الهندسية الميدانية",
    img: "03_إدارة_المشاريع_Projects.png",
    purpose: "المتابعة المركزية للمشاريع الإنشائية المسجلة بالشركة، رصد نسب الإنجاز التراكمية، ومقارنة التكلفة التقديرية بالتكلفة الفعلية وحساب الأرباح المحققة مع الوصول المباشر لمركز مستندات كل مشروع.",
    features: [
      "بطاقات ملخص المشاريع النشطة، المكتملة، وإجمالي قيمة العقود التراكمية بالريال السعودي.",
      "شريط تقدم الإنجاز لكل مشروع بنسب مئوية ملونة ومحسوبة تلقائياً.",
      "زر الوصول الفوري لمركز مستندات المشروع الـ 14 قسماً (زر 📁 14 قسم).",
      "إمكانية طباعة تقرير حساب وبيانات المشروع الرسمي بضغطة زر واحدة."
    ],
    value: "ضبط الجداول الزمنية والتكاليف ومنع انحراف الميزانيات أو تأخر تسليم الأعمال."
  },
  {
    num: "04",
    title: "مركز مستندات المشروع الشامل - 14 قسماً (Project Hub Overview)",
    tag: "الأرشيف الهندسي والقانوني",
    img: "04_مركز_مستندات_المشروع_ProjectHub.png",
    purpose: "الأرشيف الهندسي والرقمي المتكامل للمشروع، يجمع كافة المعاملات والمستندات القانونية والفنية والمالية للمشروع تحت مظلة واحدة لضمان عدم ضياع أي مستند وسرعة مراجعة لجان الفحص والمالك.",
    features: [
      "14 قسماً تخصصياً يغطي دورة حياة المشروع من توقيع العقد حتى المخالصة والحساب الختامي.",
      "عداد حيّ لكل قسم يوضح عدد المستندات والملفات المرفوعة بداخله.",
      "إمكانية تصدير تقرير شامل لكافة وثائق ومستندات المشروع بملف واحد.",
      "ربط مباشر مع قاعدة بيانات المشاريع لتحديث المعاملات تلقائياً."
    ],
    value: "توثيق قانوني وفني متكامل يحمي الشركة في النزاعات والمطالبات ويسرع تسليم المشاريع."
  },
  {
    num: "04.1",
    title: "القسم الأول: عقد المشروع الرسمي (Official Contract & Terms)",
    tag: "المركز الهندسي - تبويب 1",
    img: "04_1_عقد_المشروع_الرسمي_Contract.png",
    purpose: "توثيق العقد الأساسي للمشروع، رقم العقد، تاريخ التوقيع، تاريخ البدء والانتهاء، الشروط الجزائية، وغرامات التأخير، مع رفع نسخة PDF ممسوحة ضوئياً من العقد الأصلي المختوم.",
    features: [
      "تسجيل القيمة التعاقدية الأصلية للمشروع مع تحديد نسبة ومبلغ الدفعة المقدمة.",
      "بيانات المالك، الاستشاري الهندسي المشرف، والممثل القانوني للطرفين.",
      "معاينة وتحميل ملف العقد المعتمد بضغطة زر.",
      "متابعة التزامات الطرفين القانونية وفترات الضمان والصيانة."
    ],
    value: "حماية الحقوق القانونية وتثبيت شروط الدفع وغرامات التأخير وفترات التسليم."
  },
  {
    num: "04.2",
    title: "القسم الثاني: المخططات الهندسية والتصميمية (Engineering Drawings & Revisions)",
    tag: "المركز الهندسي - تبويب 2",
    img: "04_2_المخططات_الهندسية_Drawings.png",
    purpose: "أرشفة وتصنيف كافة المخططات الهندسية للمشروع (معمارية، إنشائية، كهربائية، صحية، ميكانيكية، ومخططات As-Built) مع تتبع أرقام الإصدارات والمراجعات المعتمدة من الاستشاري.",
    features: [
      "تصنيف المخطط حسب التخصص (معماري، إنشائي، كهروميكانيكي MEP).",
      "تتبع رقم المراجعة والتعديل (Rev 01, Rev 02) وتاريخ الاعتماد.",
      "حفظ وتنزيل المخططات بصيغ PDF و CAD عالية الوضوح.",
      "منع استخدام المخططات القديمة والملغاة في الموقع الميداني."
    ],
    value: "ضمان دقة التنفيذ الميداني وفق أحدث المخططات المعتمدة ومنع أخطاء الصب وإعادة التكسير."
  },
  {
    num: "04.3",
    title: "القسم الثالث: جدول الكميات والمواصفات (Bill of Quantities - BOQ)",
    tag: "المركز الهندسي - تبويب 3",
    img: "04_3_جدول_الكميات_BOQ.png",
    purpose: "إدارة ومتابعة بنود جدول الكميات المعتمدة في العقد، حصر الكميات التعاقدية مقابل المنفذة فعلياً، وتتبع سعر الوحدة وإجمالي كل بند مع حساب نسب الإنجاز التراكمية.",
    features: [
      "جدول تفصيلي يتضمن: رقم البند، الوصف الدقيق، الوحدة، الكمية التعاقدية، الكمية المنفذة، وسعر الوحدة.",
      "حساب تلقائي لقيمة المنجز والمتبقي ونسبة الإنجاز لكل بند على حدة.",
      "تصدير واستيراد جدول الكميات من وإلى جداول Excel لسهولة التسعير.",
      "الربط التلقائي مع المستخلصات الجارية (IPC) لحساب قيم الأعمال المنجزة."
    ],
    value: "التحكم المطلق في بنود المشروع ومنع تجاوز الكميات المعتمدة في العقد."
  },
  {
    num: "04.4",
    title: "القسم السادس: أوامر التغيير والأعمال الإضافية (Change & Variation Orders)",
    tag: "المركز الهندسي - تبويب 6",
    img: "04_4_أوامر_التغيير_ChangeOrders.png",
    purpose: "رصد وتوثيق أي طلبات لتعديل الأعمال أو إضافة بنود جديدة خارج نطاق العقد الأصلي، وتحديد الأثر المالي والزمني المترتب عليها، ومتابعة حالة اعتمادها من المالك والاستشاري.",
    features: [
      "تسجيل وصف أمر التغيير، جهة الطلب (المالك / الاستشاري)، والسبب الفني.",
      "تحديد القيمة المالية الإضافية وتمديد المدة الزمنية الممنوحة (بالأيام).",
      "متابعة حالة الاعتماد (معتمد Approved، قيد الدراسة Under Review، مرفوض Rejected).",
      "إضافة التكلفة المعتمدة تلقائياً إلى القيمة التعاقدية المعدلة للمشروع."
    ],
    value: "ضمان عدم تنفيذ أي عمل إضافي دون تغطية مالية وزمنية معتمدة وموثقة قانونياً."
  },
  {
    num: "04.5",
    title: "القسم التاسع: المستخلصات الجارية للمالك (Interim Payment Certificates - IPC)",
    tag: "المركز الهندسي - تبويب 9",
    img: "04_5_المستخلصات_الجارية_InvoicesIPC.png",
    purpose: "إصدار ومتابعة المستخلصات الدورية عن الأعمال المنفذة بالمشروع، واحتساب الاستقطاعات النظامية (استرداد الدفعة المقدمة، محتجز الضمان 5-10%) وإصدار صافي المبلغ المستحق للصرف.",
    features: [
      "إصدار مستخلص دوري تراكمي (سابق، حالي، إجمالي حتى تاريخه).",
      "حساب آلي لخصم الدفعة المقدمة ونسبة محتجز حسن التنفيذ (Retention).",
      "متابعة تواريخ الإرسال، وتاريخ اعتماد الاستشاري، وحالة السداد الفعلي.",
      "الربط المباشر مع حركة المقبوضات وتحديث ذمة العميل تلقائياً."
    ],
    value: "تسريع دورة التحصيل المالي وضمان استرداد مستحقات الشركة بالاستناد لمحاضر الحصر."
  },
  {
    num: "04.6",
    title: "القسم العاشر: التقارير الهندسية اليومية للموقع (Daily Site Progress Reports)",
    tag: "المركز الهندسي - تبويب 10",
    img: "04_6_التقارير_اليومية_DailyReports.png",
    purpose: "التوثيق اليومي الدقيق لكافة مجريات العمل في الموقع الإنشائي (الطقس، العمالة المداومة، المعدات العاملة والمتعطلة، بنود الأعمال المنجزة، المعوقات والمواد الموردة).",
    features: [
      "تسجيل حالة الطقس ودرجات الحرارة وأثرها على صب الخرسانة.",
      "حصر كادر الموقع: أعداد المهندسين، الفنيين، والعمالة الحرفية واليومية.",
      "رصد حركات تشغيل المعدات وساعات عملها وساعات التوقف والأعطال.",
      "توثيق المعوقات الميدانية التي قد تؤدي لطلب تمديد زمني للمشروع."
    ],
    value: "بناء سجل يومي غير قابل للطعن يثبت أحداث الموقع ويحمي الشركة في مطالبات التأخير."
  },
  {
    num: "04.7",
    title: "القسم الثاني عشر: محاضر الاستلام والفحص الهندسي (Handover & Quality WIR)",
    tag: "المركز الهندسي - تبويب 12",
    img: "04_7_محاضر_الاستلام_والفحص_Handovers.png",
    purpose: "توثيق محاضر استلام الأعمال ومطابقة الجودة (Work Inspection Requests - WIR) المعتمدة من المهندس المشرف، مثل استلام حديد التسليح، استلام النجارة، نتائج كسر مكعبات الخرسانة، ومحاضر الاستلام الابتدائي والنهائي.",
    features: [
      "تسجيل تاريخ ورقم طلب الفحص مع العنصر الإنشائي وموقعه بالمشروع.",
      "حالة الاعتماد وتوقيع المهندس المشرف وملاحظات الاستشاري إن وجدت.",
      "أرشفة تقارير المختبر وفحوصات الضغط للخرسانة وقوة الشد للحديد.",
      "حفظ محاضر الاستلام الابتدائي والنهائي الرسمية للمشروع."
    ],
    value: "تأكيد التزام الشركة بأعلى معايير الجودة العالمية وتفادي رفض الأعمال أو إلغاء الضمان."
  },
  {
    num: "05",
    title: "الإيرادات وسندات القبض ومقبوضات المشاريع (Revenues & Receipts)",
    tag: "التحصيل والتدفقات المالية",
    img: "05_الإيرادات_وسندات_القبض_Revenues.png",
    purpose: "تسجيل ومتابعة كافة الدفعات المستلمة من الملاك والعملاء عن مستخلصات وأعمال المشاريع، وإصدار سندات قبض رسمية معتمدة مع تحديث ذمم العملاء ورصيد الخزينة آلياً.",
    features: [
      "سجل كامل لسندات القبض يتضمن رقم السند، التاريخ، العميل، المشروع، والمبلغ وطريقة الدفع.",
      "دعم تعدد العملات المعتمدة بالمشروع (الريال اليمني، الريال السعودي، والدولار الأمريكي).",
      "زر طباعة سند قبض فوري بنموذج رسمي موثق خالي تماماً من الخلفيات المشوهة.",
      "تحديث فوري وتلقائي لمديونيات العملاء والمبالغ المتبقية في ذمتهم بقاعدة البيانات."
    ],
    value: "تعزيز كفاءة التحصيل المالي وضمان انسيابية التدفقات النقدية للداخل لدعم عمليات الموقع."
  },
  {
    num: "06",
    title: "المصروفات وسندات الصرف المعتمدة (Expenses & Vouchers)",
    tag: "الرقابة المالية على التكاليف",
    img: "06_المصروفات_وسندات_الصرف_Expenses.png",
    purpose: "إدارة وتصنيف كافة النفقات التشغيلية والموقعية، وربط كل مصروف بمشروعه وبنده المحاسبي المحدد، مع طباعة سندات الصرف المعتمدة بالتواقيع والأختام الرسمية.",
    features: [
      "تصنيف ذكي للمصروفات (مواد بناء، خرسانة، أجور عمالة، تأجير معدات، نثريات، محروقات).",
      "الربط المباشر بالتكلفة الفعلية للمشروع فور إصدار سند الصرف واحتسابه ضمن تقرير الربحية.",
      "إصدار سند صرف رسمي (Payment Voucher) بالتفقيط التلقائي واسم المستفيد وتوقيع المدير.",
      "خصم تلقائي من رصيد الصندوق أو البنك لمنع تسجيل أي عجز نقدي غير برر."
    ],
    value: "إحكام الرقابة على المصاريف ومنع الهدر المالي أو تجاوز الميزانيات المخصصة لكل بند."
  },
  {
    num: "07",
    title: "إدارة النثريات والعهد الميدانية (Petty Cash & Custodies)",
    tag: "العمليات الميدانية والسيولة",
    img: "07_النثريات_والعهد_الميدانية_Custody.png",
    purpose: "متابعة وتصفية العهد النقدية المسلمة لمهندسي المواقع والمشرفين الميدانيين للنفقات اليومية العاجلة، مع حساب المنصرف منها والمتبقي بدقة متناهية لمنع تراكم المعلقات.",
    features: [
      "بطاقات ملخص العهدة الميدانية: (إجمالي المسلم، إجمالي المنصرف، والمتبقي الفعلي في حوزة المهندس).",
      "سجل تفصيلي لحركات صرف العهد مصنفة حسب المهندس أو المشرف الميداني والمشروع.",
      "سهولة إجراء تصفية العهدة وإغلاقها وإعادتها للصندوق أو تدويرها لفترة جديدة.",
      "دعم كامل لكافة العملات المتداولة مع إرفاق الفواتير والإيصالات الميدانية."
    ],
    value: "تفادي ضياع النثريات الميدانية وإلزام الكادر الفني بتقديم الفواتير المؤيدة للصرف أولاً بأول."
  },
  {
    num: "08",
    title: "إدارة العملاء وكشوفات الحسابات المعتمدة (Clients & Statements)",
    tag: "إدارة العلاقات والذمم المدينة",
    img: "08_إدارة_العملاء_وكشوفات_الحساب_Clients.png",
    purpose: "دليل كامل لبيانات الملاك والعملاء، متابعة المبالغ المستحقة عليهم والمسددة، مع إمكانية استخراج كشف حساب عميل تفصيلي رسمي معتمد للمطابقة والتسوية المالية.",
    features: [
      "سجل تفصيلي للعملاء مع أرقام الهواتف، العناوين، الشركات، والأرصدة المدينة والدائنة الحالية.",
      "كشف حساب عميل ديناميكي برصيد تراكمي مستمر بعد كل دفعة أو فاتورة.",
      "إظهار الرصيد الافتتاحي السابق، إجمالي المدفوعات، والمتبقي النهائي بدقة عالية.",
      "حقول مخصصة لمطابقة وتوقيع العميل والختم الرسمي للشركة للمصادقات الدورية."
    ],
    value: "توثيق الذمم المدينة بدقة وبناء علاقة احترافية شفافة وموثوقة مع ملاك المشاريع."
  },
  {
    num: "09",
    title: "الموردون وحسابات التوريد الميداني (Suppliers Management)",
    tag: "سلاسل التوريد والموردين",
    img: "09_الموردون_وحسابات_التوريد_Suppliers.png",
    purpose: "إدارة شبكة موردي مواد البناء (حديد، أسمنت، خرسانة جاهزة، أدوات كهربائية، تأجير معدات ثقيلة)، وتتبع فواتير التوريد والأرصدة المستحقة لهم وجدولة السداد.",
    features: [
      "تصنيف الموردين حسب تخصص المواد وأرقام الهواتف والحسابات البنكية.",
      "متابعة دقيقة للأرصدة المستحقة لكل مورد لتجنب تأخير المستحقات أو ازدواجية السداد.",
      "كشف حساب مورد يوضح فواتير الشراء وسندات الصرف المسددة والرصيد المتبقي.",
      "المساعدة في التفاوض مع الموردين للحصول على أفضل التسهيلات الائتمانية والأسعار التنافسية."
    ],
    value: "الحفاظ على استمرارية توريد المواد للمواقع دون توقف العمليات الخرسانية بسبب الديون."
  },
  {
    num: "10",
    title: "المخزون ومواد البناء وأذونات الصرف (Inventory & Materials)",
    tag: "إدارة الأصول والمستودعات",
    img: "10_المخزون_ومواد_البناء_Inventory.png",
    purpose: "متابعة حركة المواد الإنشائية في المستودع المركزي أو الميداني، تسجيل أذونات الصرف للمشاريع، ومراقبة الحدود الدنيا للتنبيه بنواقص المواد قبل نفادها من الموقع.",
    features: [
      "سجل أصناف مواد البناء بوحدات القياس المعيارية (طن، كيس، متر مكعب، متر طولي، حبة).",
      "نظام تنبيهات تلقائية لنواقص المخزون (Low Stock Alerts) عند وصول الصنف للحد الأدنى.",
      "إصدار أذونات صرف مواد مخزنية وتحميل تكلفتها على المشروع فوراً وخصمها من الرصيد.",
      "رصد حركات التوريد والصرف والتحويل مع تسجيل اسم المستلم الميداني لكل إرسالية."
    ],
    value: "منع هدر وسرقة المواد وضمان توفر المواد الحيوية للصب والتشييد دون أي تأخير."
  },
  {
    num: "11",
    title: "حركة الصندوق والبنك والخزينة (Cash & Bank Movements)",
    tag: "الرقابة على الخزينة والسيولة",
    img: "11_حركة_الصندوق_والبنك_Cash.png",
    purpose: "التدقيق اليومي في حركة النقدية الداخلة والخارجة من الخزينة وحسابات البنوك، وإجراء المطابقة الحسابية بين الرصيد الدفتري للنظام والرصيد الفعلي في الدرج أو الحساب البنكي.",
    features: [
      "البطاقات الخماسية الحية: (الرصيد الافتتاحي، إجمالي الداخل، إجمالي المنصرف، المسحوبات، والرصيد الحالي).",
      "سجل تفصيلي لحركات الصندوق بتسلسل زمني دقيق وأرقام السندات المرتبطة بكل حركة.",
      "تسجيل التغذية والسحوبات والتحويلات بين الصندوق والبنوك بكل سهولة.",
      "نظام رقابي صارم يمنع أي عجز نقدي أو تلاعب في الأرصدة الحقيقية."
    ],
    value: "حماية أموال وسيولة الشركة والتأكد من مطابقة النقد الفعلي لدفاتر الحسابات."
  },
  {
    num: "12",
    title: "التقارير المالية وقوائم الأرباح والخسائر (Profit & Loss Statement)",
    tag: "القوائم المالية والتحليل الربحي",
    img: "12_التقارير_المالية_الأرباح_والخسائر_ProfitLoss.png",
    purpose: "استخراج قائمة الدخل الرسمية التفاعلية للشركة خلال فترات زمنية محددة (شهرية، ربع سنوية، سنوية)، مع توزيع المصروفات واحتساب صافي الأرباح التشغيلية المحققة بدقة متناهية.",
    features: [
      "تحديد الفترة المالية من تاريخ إلى تاريخ مع احتساب فوري وتلقائي للنتائج.",
      "جدول تفصيلي لتحليل نسب بنود المصروفات وتأثير كل بند على صافي هامش الربح.",
      "تصدير التقرير المالي إلى ملفات Excel تدعم اللغة العربية (UTF-8) بالكامل.",
      "إمكانية طباعة التقرير بنموذج معتمد متعدد الصفحات مع إظهار توقيع المحاسب والمدير العام."
    ],
    value: "تزويد الشركاء والمحاسب القانوني والجهات الرسمية بتقارير مالية دورية موثوقة وموثقة."
  },
  {
    num: "13",
    title: "تقرير المركز المالي والميزانية العمومية (Balance Sheet Statement)",
    tag: "المتانة والملاءة المالية",
    img: "13_تقرير_المركز_المالي_والميزانية_BalanceSheet.png",
    purpose: "عرض الميزانية العمومية التفاعلية التي توضح أصول الشركة المتداولة والثابتة مقابل التزاماتها ومستحقات الموردين وحقوق الملكية للوقوف على الملاءة المالية الحقيقية للمؤسسة.",
    features: [
      "جدول مقارنة الأصول والالتزامات جنباً إلى جنب (Dual Balance Table) وفق المعايير المحاسبية.",
      "رصد النقدية، وقيمة المخزون، والمستحقات على العملاء كأصول متداولة حية.",
      "رصد مستحقات الموردين والعهد والالتزامات كديون قائمة واجبة السداد.",
      "إمكانية طباعة تقرير المركز المالي بنموذج رسمي معتمد للاستخدام البنكي والتمويلي."
    ],
    value: "تقييم القيمة الحقيقية للشركة وجاهزيتها المالية لدخول مناقصات ومشاريع كبرى."
  },
  {
    num: "14",
    title: "تحليل ربحية وكفاءة المشاريع (Projects Profitability & ROI)",
    tag: "الجدوى والمردود الاستثماري",
    img: "14_تحليل_ربحية_وكفاءة_المشاريع_ProjectsProfitability.png",
    purpose: "مقارنة ومفاضلة الجدوى والأرباح المحققة بين المشاريع الـ 16 المختلفة، وتحديد أي المشاريع تحقق أعلى هامش ربح وأيها يستهلك تكاليف إضافية خارج المخطط المالي.",
    features: [
      "جدول مقارنة تفصيلي يتضمن: (قيمة العقد، التكلفة الفعلية، الربح المحقق، وهامش الربح %).",
      "تقييم كفاءة مهندسي المواقع وإدارتهم الذكية لميزانية المشروع المعتمدة.",
      "تصدير بيانات الكفاءة والربحية إلى ملفات Excel بضغطة زر واحدة.",
      "كشف المشاريع المتعثرة أو منخفضة الربح لاتخاذ إجراءات تصحيحية عاجلة."
    ],
    value: "تحسين وتطوير آليات تسعير المناقصات المستقبلية بالاستناد لتكاليف المشاريع المنفذة فعلياً."
  },
  {
    num: "15",
    title: "إعدادات هوية الشركة والبيانات الرسمية (Company Settings & Identity)",
    tag: "الهوية المؤسسية والتهيئة",
    img: "15_إعدادات_النظام_وهوية_الشركة_CompanySettings.png",
    purpose: "إدارة وضبط البيانات الرسمية لشركة رواسي عدن للهندسة والمقاولات (اسم الشركة باللغتين العربية والإنجليزية، السجل التجاري، الرقم الضريبي، أرقام التواصل، وشعار الشركة الرسمي).",
    features: [
      "رفع وتعديل شعار الشركة (Logo) ليظهر تلقائياً في كافة الترويسات والسندات المطبوعة.",
      "تعديل العنوان، أرقام الهاتف، والبريد الإلكتروني ومقر الشركة الرئيسي في عدن.",
      "حفظ إعدادات العملة الافتراضية للنظام والنسب الضريبية المعمول بها.",
      "الحفظ الفوري للإعدادات في قاعدة البيانات مع انعكاسها الفوري على كل شاشات النظام."
    ],
    value: "ترسيخ الهوية المؤسسية للشركة وإظهار مظهر موحد وراقٍ في كافة الخطابات والوثائق."
  },
  {
    num: "16",
    title: "محرك إعدادات الطباعة والمعاينة الحية الفورية (Print Designer & Live Preview)",
    tag: "محرك الطباعة والتصميم",
    img: "16_محرك_إعدادات_الطباعة_والمعاينة_الحية_PrintDesigner.png",
    purpose: "التحكم الكامل في تصميم وطباعة السندات والتقارير وكشوف الحسابات عبر شاشة معاينة حية فورية تُظهر شكل المستند كما سيخرج من الطابعة، مع إزالة أي خلفيات مشوهة وضمان دقة المحاذاة.",
    features: [
      "شاشة معاينة تفاعلية حية تتبدل بين سندات القبض، وسندات الصرف، وكشوف الحسابات والتقارير.",
      "التحكم في قياس الهوامش، نمط الحدود، الخطوط الرسمية، والألوان الملكية المتناسقة.",
      "إدراج اسم المستخدم المسجل بالمشروع وتوقيت الطباعة الدقيق في ترويسة وتذييل كل ورقة.",
      "التحكم الكامل بمواقع التواقيع والأختام الرسمية المعتمدة لشركة رواسي عدن."
    ],
    value: "إخراج وثائق ومطبوعات رسمية فائقة الفخامة تليق باسم ومكانة الشركة أمام الملاك والبنوك."
  },
  {
    num: "17",
    title: "إدارة المستخدمين والصلاحيات وسجل النشاطات (Users, Roles & Security)",
    tag: "الأمان وإدارة الكادر",
    img: "17_إدارة_المستخدمين_والصلاحيات_UsersRoles.png",
    purpose: "التحكم في كادر العمل، إنشاء حسابات الموظفين (مهندس، محاسب، مدير مشروع، مدير عام)، وتخصيص صلاحيات الوصول لكل شاشة وقسم لمنع أي تجاوزات إدارية أو مالية.",
    features: [
      "جدول المستخدمين مع بيان المسمى الوظيفي، الحالة (نشط / معطل)، وآخر موعد دخول.",
      "تحديد صلاحيات دقيقة: صلاحية العرض، الإضافة، التعديل، والحذف لكل شاشة وقائمة.",
      "تغيير وتشفير كلمات المرور وإعادة ضبطها بأمان تام.",
      "سجل التدقيق الداخلي (Audit Log) لتتبع من قام بإدخال أو تعديل أي حركة مالية أو هندسية."
    ],
    value: "فصل السلطات والمسؤوليات وحماية بيانات الشركة من التعديلات غير المصرح بها."
  }
];

const imgDir = path.join(__dirname, 'عرض_النظام_للتقديم');

// Preload screenshots as Base64
console.log('Preloading screenshots as Base64...');
const screensWithBase64 = screens.map(s => {
  const p = path.join(imgDir, s.img);
  const b64 = fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : '';
  return { ...s, dataUri: 'data:image/png;base64,' + b64 };
});

// Function to generate HTML for a specific slide
function getSlideHtml(s, idx, total) {
  return `
  <div class="slide-page">
    <div class="slide-header">
      <div class="slide-header-left">
        <div class="slide-badge-num">${s.num}</div>
        <div class="slide-title">${s.title}</div>
      </div>
      <div class="slide-tag">${s.tag}</div>
    </div>

    <div class="slide-body">
      <div class="slide-img-box">
        <img src="${s.dataUri}" alt="${s.title}">
      </div>

      <div class="slide-info-box">
        <div class="section-purpose">
          <h4>🎯 الهدف الوظيفي من الشاشة:</h4>
          <p>${s.purpose}</p>
        </div>

        <div class="section-features">
          <h4>✨ أبرز المزايا والقدرات المعروضة:</h4>
          <ul>
            ${s.features.map(f => `<li>${f}</li>`).join('\n            ')}
          </ul>
        </div>

        <div class="section-value">
          <strong>القيمة التشغيلية:</strong> ${s.value}
        </div>
      </div>
    </div>

    <div class="slide-footer">
      <div>شركة رواسي عدن للهندسة والمقاولات | Rawasi Aden Contracting System</div>
      <div>شريحة ${idx + 2} من ${total}</div>
      <div>المستخدم المسجل: علوي محمد باعبيد</div>
    </div>
  </div>
  `;
}

function getCoverHtml(total) {
  return `
  <div class="cover-slide">
    <div class="cover-badge">وثيقة العرض التقديمي الرسمي والميداني 2026</div>
    <div class="cover-main">
      <h2>شركة رواسي عدن للهندسة والمقاولات العامة</h2>
      <h1>الملف التقديمي الشامل<br><span>لنظام إدارة المشاريع والمحاسبة الإنشائية</span></h1>
      <p class="cover-desc">دليل بصري وتوثيقي متكامل يستعرض شاشات وتبويبات المنظومة الرقمية، ويوضح الكفاءة الفنية والرقابة المالية للمشاريع، وإدارة المستندات الـ 14 المعتمدة لتقديمها للمالك والإدارة العامة ولجان الفحص.</p>
    </div>
    <div class="cover-footer">
      <div>المستخدم المعتمد بالمشروع: <strong>علوي محمد باعبيد</strong></div>
      <div>نطاق الوثيقة: <strong>24 شاشة وقسم تخصصي</strong></div>
      <div>تاريخ التوثيق: <strong>سبتمبر 2026</strong></div>
    </div>
  </div>
  `;
}

const cssStyles = `
  @page { size: A4 landscape; margin: 0; }
  :root {
    --navy-dark: #070d18;
    --navy-card: #0f1c2e;
    --navy-border: #1e3a5f;
    --gold-primary: #d4af37;
    --gold-light: #f59e0b;
    --gold-gradient: linear-gradient(135deg, #d4af37 0%, #b8911c 100%);
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --accent-green: #10b981;
    --accent-blue: #38bdf8;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body {
    background-color: var(--navy-dark);
    color: var(--text-main);
    line-height: 1.5;
    margin: 0;
    padding: 0;
  }
  .cover-slide {
    width: 297mm;
    height: 209mm;
    padding: 24mm 24mm;
    background: radial-gradient(circle at top center, #15253d 0%, #070d18 80%);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    break-after: page;
    border: 8px solid #13243c;
  }
  .cover-badge {
    display: inline-block;
    align-self: flex-start;
    background: rgba(212, 175, 55, 0.15);
    color: var(--gold-primary);
    border: 1.5px solid var(--gold-primary);
    padding: 6px 20px;
    border-radius: 50px;
    font-weight: 800;
    font-size: 13pt;
  }
  .cover-main {
    text-align: center;
    margin: auto 0;
  }
  .cover-main h2 {
    font-size: 20pt;
    color: var(--gold-light);
    font-weight: 700;
    margin-bottom: 8px;
  }
  .cover-main h1 {
    font-size: 32pt;
    font-weight: 900;
    color: #ffffff;
    line-height: 1.3;
    margin-bottom: 16px;
  }
  .cover-main h1 span {
    background: var(--gold-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .cover-desc {
    font-size: 13pt;
    color: #cbd5e1;
    max-width: 820px;
    margin: 0 auto;
    line-height: 1.7;
  }
  .cover-footer {
    display: flex;
    justify-content: space-between;
    border-top: 1.5px solid var(--navy-border);
    padding-top: 14px;
    font-size: 11pt;
    color: var(--text-muted);
  }
  .cover-footer strong { color: #ffffff; }
  .slide-page {
    width: 297mm;
    height: 209mm;
    padding: 10mm 15mm;
    background: var(--navy-dark);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
  }
  .slide-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--navy-border);
    margin-bottom: 10px;
  }
  .slide-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .slide-badge-num {
    background: var(--gold-gradient);
    color: #000000;
    font-weight: 900;
    font-size: 12pt;
    padding: 3px 12px;
    border-radius: 6px;
  }
  .slide-title {
    font-size: 14pt;
    font-weight: 800;
    color: #ffffff;
  }
  .slide-tag {
    background: #1e3a5f;
    color: #38bdf8;
    font-size: 9.5pt;
    padding: 3px 10px;
    border-radius: 6px;
    font-weight: 700;
  }
  .slide-body {
    display: grid;
    grid-template-columns: 1.45fr 1fr;
    gap: 18px;
    flex: 1;
    align-items: center;
  }
  .slide-img-box {
    border: 2px solid var(--navy-border);
    border-radius: 8px;
    overflow: hidden;
    background: #000000;
    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  }
  .slide-img-box img {
    width: 100%;
    height: auto;
    display: block;
  }
  .slide-info-box {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
    padding: 2px 0;
  }
  .section-purpose { margin-bottom: 8px; }
  .section-purpose h4 {
    color: var(--gold-light);
    font-size: 11pt;
    font-weight: 800;
    margin-bottom: 3px;
  }
  .section-purpose p {
    color: #e2e8f0;
    font-size: 9.5pt;
    line-height: 1.5;
  }
  .section-features { margin-bottom: 8px; }
  .section-features h4 {
    color: var(--accent-blue);
    font-size: 11pt;
    font-weight: 800;
    margin-bottom: 5px;
  }
  .section-features ul {
    list-style-type: none;
    padding: 0;
  }
  .section-features li {
    position: relative;
    padding-right: 18px;
    margin-bottom: 4px;
    font-size: 9pt;
    color: #cbd5e1;
    line-height: 1.35;
  }
  .section-features li::before {
    content: "✔";
    position: absolute;
    right: 0;
    color: var(--accent-green);
    font-weight: 900;
    font-size: 8.5pt;
  }
  .section-value {
    background: rgba(212, 175, 55, 0.1);
    border-right: 4px solid var(--gold-primary);
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 9pt;
    color: #f1f5f9;
    line-height: 1.45;
  }
  .section-value strong { color: var(--gold-light); }
  .slide-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--navy-border);
    padding-top: 5px;
    margin-top: 6px;
    font-size: 8.5pt;
    color: var(--text-muted);
  }
`;

function wrapHtml(inner) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>${cssStyles}</style></head><body>${inner}</body></html>`;
}

async function run() {
  const totalSlides = screensWithBase64.length + 1; // 25
  const batchSize = 5; // 5 batches
  const batches = [];

  // Batch 0: Cover + first 4 screens (5 slides)
  let b0 = getCoverHtml(totalSlides);
  for (let i = 0; i < 4; i++) {
    b0 += getSlideHtml(screensWithBase64[i], i, totalSlides);
  }
  batches.push(b0);

  // Remaining screens: batches of 5
  for (let i = 4; i < screensWithBase64.length; i += batchSize) {
    let b = '';
    const slice = screensWithBase64.slice(i, i + batchSize);
    slice.forEach((s, idx) => {
      b += getSlideHtml(s, i + idx, totalSlides);
    });
    batches.push(b);
  }

  console.log(`Divided presentation into ${batches.length} safe batches for rendering...`);

  const tmpUserData = path.join(os.tmpdir(), 'edge_batch_' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--headless=new',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--user-data-dir=' + tmpUserData
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const tempPdfParts = [];
  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    console.log(`Rendering batch ${bIdx + 1} of ${batches.length}...`);
    const fullHtml = wrapHtml(batches[bIdx]);
    await page.setContent(fullHtml, { waitUntil: 'load' });
    
    const partPath = path.join(os.tmpdir(), `presentation_part_${bIdx}.pdf`);
    await page.pdf({
      path: partPath,
      format: 'A4',
      landscape: true,
      printBackground: true
    });
    tempPdfParts.push(partPath);
  }

  await browser.close();
  console.log('All PDF batches rendered successfully!');

  // Merge batches using pdf-lib
  console.log('Merging all batches into master presentation document...');
  const mergedPdf = await PDFDocument.create();

  for (const partPath of tempPdfParts) {
    const partBytes = fs.readFileSync(partPath);
    const partDoc = await PDFDocument.load(partBytes);
    const copiedPages = await mergedPdf.copyPages(partDoc, partDoc.getPageIndices());
    copiedPages.forEach(p => mergedPdf.addPage(p));
    // Clean up temp part
    try { fs.unlinkSync(partPath); } catch (e) {}
  }

  const finalPdfBytes = await mergedPdf.save();

  const destWorkspace = 'c:/Users/a.ba3baid/رواسي عدن/كتالوج_عرض_نظام_رواسي_عدن_للتقديم.pdf';
  const destDesktop = 'C:/Users/a.ba3baid/Desktop/كتالوج_عرض_نظام_رواسي_عدن_للتقديم.pdf';

  fs.writeFileSync(destWorkspace, finalPdfBytes);
  fs.writeFileSync(destDesktop, finalPdfBytes);

  console.log('====================================');
  console.log('🎉 SUCCESS: FULL PRESENTATION PDF CREATED!');
  console.log('Total Pages: ' + mergedPdf.getPageCount());
  console.log('Total File Size: ' + Math.round(finalPdfBytes.length / 1024) + ' KB');
  console.log('1. Desktop Path: ' + destDesktop);
  console.log('2. Workspace Path: ' + destWorkspace);
  console.log('====================================');
}

run().catch(err => {
  console.error('Fatal error in PDF build:', err);
  process.exit(1);
});

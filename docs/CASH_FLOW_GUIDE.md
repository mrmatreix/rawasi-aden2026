# دليل نظام التدقيق النقدي وتوقعات التدفق (Cash Flow Projection Guide)
### شركة رواسي عدن للهندسة والمقاولات

---

## 1. المقدمة والهدف الاستراتيجي

في قطاع المقاولات والإنشاءات، يعتبر **التدفق النقدي (Cash Flow)** هو شريان الحياة الرئيسي للمشاريع؛ حيث تتسبب فجوات السيولة وتأخر تحصيل مستخلصات المالك في تعثر الأعمال وتوقف سلاسل الإمداد حتى لو كانت المشاريع رابحة دفترياً.

يهدف هذا النظام إلى توفير **خطة تنبؤية مستقبلية دقيقة (Rolling Cash Flow Forecast)** لفترة تمتد من شهر إلى سنة قادمة، تربط بين:
- مستخلصات العملاء المعتمدة والمخططة والمحجوزات (Inflows).
- مستحقات الموردين، رواتب الكوادر، أجور مقاولي الباطن، الضرائب، ورسوم خطابات الضمان (Outflows).
- حساب الرصيد التراكمي ومحاكاة السيناريوهات الحسابية الثلاثية: **الواقعي، المتفائل، والمتشائم**.

---

## 2. البنية الهيكلية لقاعدة البيانات

### أ. جدول سجل التوقعات `cash_flow_projections`

```sql
CREATE TABLE cash_flow_projections (
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
```

---

## 3. محددات ومنطق الاستنتاج التلقائي (Cash Flow Ingestion Engine)

تقوم دالة `CashFlowProjectionService.generateProjections(monthFrom, monthTo)` بمسح لحظي آلي لكافة دفاتر وسجلات النظام:

### 1. الإيرادات والتحصيلات المتوقعة (Expected Inflows):
1. **المستخلصات المعتمدة غير المحصلة (`bills`):**
   - تُسحب المبالغ الصافية بعد خصم الدفعة المقدمة والضمان والضرائب (`net_amount - paid_amount`).
   - درجة الثقة: `high` (وثيقة تعاقدية معتمدة قيد التحصيل).
2. **المستخلصات المخططة بناءً على تقدم الأعمال (POC Projection):**
   - احتساب المتبقي غير المفوتر من العقد وتوزيعه شهرياً استناداً لدورة المستخلص `ipc_cycle_days`.
   - درجة الثقة: `medium`.
3. **محجوزات الضمان المستردة (Retention Receivables):**
   - استحقاق الإفراج عن نسبة محتجز الضمان (Retention Release) بعد انقضاء فترة الصيانة والضمان (Defects Liability Period - DLP).
   - درجة الثقة: `medium`.
4. **أتعاب الإشراف والاستشارات المستمرة:**
   - رسوم شهرية ثابتة للعقود الاستشارية والإشرافية.
   - درجة الثقة: `high`.

### 2. المدفوعات والالتزامات المتوقعة (Expected Outflows):
1. **فواتير ومستحقات الموردين غير المسددة (`purchases`):**
   - جدولة المبالغ الآجلة غير المسددة للموردين وفق تاريخ الاستحقاق.
2. **الرواتب والأجور المجدولة (`payroll` / `employees`):**
   - احتساب متوسط كشوف المرتبات الشهرية لكافة الموظفين النشطين بنهاية كل شهر ميلادي.
3. **أجور مقاولي الباطن والعمالة التخصصية (`project_labor_expenses`):**
   - جلب المستحقات غير المسددة لمقاولي المصنعية ومسيري العمالة الميدانية.
4. **الضرائب والرسوم الحكومية (`tax_withholdings`):**
   - جدولة استقطاعات ضريبة الأرباح التجارية والصناعية المستحقة للتوريد لمصلحة الضرائب.
5. **مصاريف وعمولات خطابات الضمان البنكية:**
   - أتعاب تجديد وتغطية خطابات الضمان الابتدائية والنهائية مع البنوك.

---

## 4. محاكاة السيناريوهات الثلاثية (Cash Flow Scenarios)

1. **السيناريو الواقعي (Realistic / Base Case):**
   - تحصيل 90% من المستخلصات المجدولة في مواعيدها.
   - سداد 100% من فواتير الموردين والرواتب ومقاولي الباطن.
2. **السيناريو المتفائل (Optimistic Scenario):**
   - تحصيل 100% من المستخلصات كاملة في مواعيدها المحددة.
   - توفير 5% من مصاريف الموردين عبر التفاوض والخصومات النقدية.
3. **السيناريو المتشائم (Pessimistic Stress Test):**
   - تأخر تحصيل 30% من المستخلصات (تحصيل 70% فقط).
   - سداد 100% من الالتزامات + 5% مصاريف طوارئ وظروف موقعية قاهرة.

---

## 5. واجهات برمجة التطبيقات (API Reference)

### 1. جلب تقرير التدفق النقدي لفترة محددة:
```http
GET /api/cash-flow/projection?from=2026-10&to=2027-03
Authorization: Bearer <TOKEN>
```

### 2. جلب تفاصيل تدفق شهر محدد:
```http
GET /api/cash-flow/month/2026-10
Authorization: Bearer <TOKEN>
```

**مثال الإخراج المعياري المطابق:**
```json
{
  "period": "2026-10",
  "expected_collections": 20000.00,
  "expected_payments": 14000.00,
  "net_cash_flow": 6000.00,
  "cumulative_balance": 65000.00,
  "breakdown": {
    "by_project": [
      {
        "project_id": 1,
        "project_name": "مجمع خورمكسر الطبي",
        "inflow": 15000.00,
        "outflow": 8000.00,
        "net": 7000.00
      }
    ],
    "by_type": {
      "ipc_collections": 15000.00,
      "supervision_fees": 5000.00,
      "vendor_payments": 7000.00,
      "salaries": 5000.00,
      "subcontractors": 2000.00
    }
  }
}
```

### 3. محاكاة السيناريوهات:
```http
GET /api/cash-flow/scenarios?from=2026-10&to=2027-03
Authorization: Bearer <TOKEN>
```

### 4. إعادة التوليد والتحديث اللحظي:
```http
POST /api/cash-flow/projection/regenerate
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "from": "2026-10",
  "to": "2027-03"
}
```

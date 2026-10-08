/**
 * ============================================================================
 * نظام التحكم والرقابة المتقدمة على المشاريع - شركة رواسي عدن للهندسة والمقاولات
 * وحدة واجهة المستخدم (Project Control UI Engine)
 * المحاور الأربعة:
 * 1. نسبة الإنجاز الذكية وتدقيق المصادر الخمسة ومنع التلاعب (Smart Completion)
 * 2. إدارة الجدول الزمني وهيكل WBS والمسار الحرج (WBS & CPM Scheduler)
 * 3. إدارة القيمة المكتسبة ومؤشرات الأداء والكشف المبكر (EVM Dashboard)
 * 4. سجلات الحوكمة: المخاطر 5x5، المطالبات والنزاعات، عدم المطابقة NCR، الاستفسارات RFI
 * ============================================================================
 */

'use strict';

const ProjectControlUI = {
  currentProjectId: null,
  activeSubTab: 'risks', // for risks-claims subtabs
  cache: {
    completion: null,
    wbs: null,
    evm: null,
    risks: null
  },

  // مسار الـ API الموحد
  apiUrl(endpoint) {
    const pid = this.getProjectId();
    return `/api/project-control/${pid}/${endpoint}`;
  },

  getProjectId() {
    if (this.currentProjectId) return this.currentProjectId;
    if (window.ProjectHub && ProjectHub.currentProjectId) return ProjectHub.currentProjectId;
    const select = document.getElementById('hubProjectSelect');
    if (select && select.value) return Number(select.value);
    if (window.Projects && Projects.list && Projects.list.length > 0 && Projects.list[0].id) {
      return Projects.list[0].id;
    }
    return null;
  },

  // دالة موحدة لطلب الـ API مع إرفاق التوكنات الأمنية
  async fetch(url, options = {}) {
    options = options || {};
    options.headers = options.headers || {};
    if (!options.headers['Authorization'] && !options.headers['authorization']) {
      const token = (window.Auth && window.Auth.token)
        || sessionStorage.getItem('rawasi_token')
        || localStorage.getItem('rawasi_token');
      if (token) options.headers['Authorization'] = `Bearer ${token}`;
    }
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = (window.Auth && window.Auth.csrfToken)
        || sessionStorage.getItem('rawasi_csrf_token');
      if (csrf) options.headers['X-CSRF-Token'] = csrf;
    }
    return window.fetch(url, options);
  },

  // التحقق من وجود جلسة مصادقة نشطة
  isAuthenticated() {
    return !!((window.Auth && window.Auth.token) ||
              sessionStorage.getItem('rawasi_token') ||
              localStorage.getItem('rawasi_token'));
  },

  // بطاقة طلب تسجيل الدخول عند عدم توفر جلسة
  renderAuthRequired(container, featureTitle) {
    if (!container) return;
    container.innerHTML = `
      <div class="panel-card" style="padding: 40px 24px; text-align: center; border: 1px dashed var(--gold-primary); background: rgba(15, 23, 42, 0.7); border-radius: 12px; margin: 20px 0;">
        <div style="font-size: 2.8rem; margin-bottom: 12px;">🔒</div>
        <h4 style="color: var(--gold-light); margin-bottom: 8px; font-size: 1.15rem;">يرجى تسجيل الدخول أولاً</h4>
        <p style="color: var(--text-secondary); margin-bottom: 20px; font-size: 0.9rem; max-width: 500px; margin-left: auto; margin-right: auto; line-height: 1.6;">
          يتطلب استعراض ${featureTitle} وجود جلسة مصادقة نشطة ومعتمدة في النظام.
        </p>
        <button class="btn btn-primary" onclick="if (window.Auth && typeof Auth.showLogin === 'function') Auth.showLogin(); else location.reload();" style="padding: 9px 26px; font-weight: bold;">
          <span>🔑 تسجيل الدخول الآن</span>
        </button>
      </div>
    `;
  },

  // بطاقة طلب تحديد المشروع أولاً
  renderNoProjectSelected(container, featureTitle) {
    if (!container) return;
    container.innerHTML = `
      <div class="panel-card" style="padding: 36px 20px; text-align: center; border: 1px dashed var(--border-color); background: rgba(15, 23, 42, 0.5); border-radius: 12px; margin: 20px 0;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">📁</div>
        <h4 style="color: var(--text-primary); margin-bottom: 8px;">يرجى تحديد المشروع أولاً</h4>
        <p style="color: var(--text-secondary); margin-bottom: 18px; font-size: 0.9rem;">
          يرجى اختيار مشروع من القائمة المنسدلة في أعلى مساحة العمل لعرض مؤشرات ${featureTitle}.
        </p>
      </div>
    `;
  },

  // ==========================================================================
  // 1. نسبة الإنجاز الذكية والتدقيق الرقابي (Smart Completion)
  // ==========================================================================

  async renderSmartCompletion(projectId) {
    this.currentProjectId = projectId || this.getProjectId();
    const container = document.getElementById('hubPane_smart-completion');
    if (!container) return;

    if (!this.isAuthenticated()) {
      this.renderAuthRequired(container, 'مؤشرات تدقيق نسبة الإنجاز (Smart % Complete)');
      return;
    }

    if (!this.currentProjectId) {
      this.renderNoProjectSelected(container, 'نسبة الإنجاز الذكية');
      return;
    }

    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <p style="color: var(--gold-light); font-weight: bold;">جاري تدقيق وحساب مؤشرات الإنجاز الفيزيائي والتعاقدي...</p>
      </div>
    `;

    try {
      const res = await this.fetch(this.apiUrl('completion'));
      if (res.status === 401) {
        this.renderAuthRequired(container, 'مؤشرات تدقيق نسبة الإنجاز');
        return;
      }
      const json = await res.json();
      if (!json.success) {
        if (json.authenticated === false || (json.message && json.message.includes('تسجيل الدخول'))) {
          this.renderAuthRequired(container, 'مؤشرات تدقيق نسبة الإنجاز');
          return;
        }
        throw new Error(json.message || 'فشل جلب بيانات تدقيق الإنجاز');
      }

      this.cache.completion = json.data;
      const d = json.data || {};

      // تأمين بيانات المصادر الخمسة مع قيم افتراضية آمنة تمنع أي خطأ برمجياً
      const s = d.sources || {};
      s.boq = s.boq || { percentage: 0, items_with_progress: 0, total_items_count: 0, executed_value: 0, total_boq_value: 0 };
      s.invoices = s.invoices || { percentage: 0, approved_count: 0, approved_net_amount: 0, contract_value: 0 };
      s.daily_reports = s.daily_reports || { percentage: 0, count: 0, latest_pct: 0 };
      s.cost_ratio = s.cost_ratio || { percentage: 0, actual_cost: 0, budget: 0 };
      s.engineer_cert = s.engineer_cert || { percentage: 0, count: 0, latest: null };

      d.current_manual_percentage = Number(d.current_manual_percentage ?? 0);
      d.recommended_percentage = Number(d.recommended_percentage ?? d.recommended_pct ?? 0);
      d.variance = Number(d.variance ?? Math.round((d.current_manual_percentage - d.recommended_percentage) * 100) / 100);
      d.validation_message = d.validation_message || (Math.abs(d.variance) <= 5 ? 'نسبة الإنجاز المسجلة في المشروع متوافقة هندسياً وفيزيائياً مع المؤشرات المستندية والميدانية.' : 'يوجد تباين بين النسبة المسجلة والنسبة المحسوبة يتطلب التدقيق.');

      // تحديد ألوان وحالة الانحراف
      let statusColor = '#10b981';
      let statusText = 'متطابق وموثوق فيزيائياً ✅';
      let statusBg = 'rgba(16, 185, 129, 0.12)';
      let statusBorder = 'rgba(16, 185, 129, 0.35)';

      if (d.rational_status === 'unrealistic_critical' || Math.abs(d.variance) > 15) {
        statusColor = '#ef4444';
        statusText = '🚨 انحراف حرج غير منطقي (تجاوز كبير بدون مستندات داعمة)';
        statusBg = 'rgba(239, 68, 68, 0.12)';
        statusBorder = 'rgba(239, 68, 68, 0.4)';
      } else if (d.rational_status === 'moderate_risk' || Math.abs(d.variance) > 5) {
        statusColor = '#f59e0b';
        statusText = '⚠️ تباين ملحوظ يتطلب مراجعة المستخلصات وتقارير الموقع';
        statusBg = 'rgba(245, 158, 11, 0.12)';
        statusBorder = 'rgba(245, 158, 11, 0.4)';
      }

      container.innerHTML = `
        <div class="panel-card" style="margin-bottom: 20px;">
          <!-- شريط الرأس -->
          <div class="panel-header" style="flex-wrap: wrap; gap: 14px; border-bottom: 1px solid var(--border-light); padding-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="badge" style="background: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusBorder}; font-weight: bold; font-size: 0.85rem;">
                  ${statusText}
                </span>
                <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light); border: 1px solid rgba(212, 175, 55, 0.3);">
                  🔒 نظام منع التلاعب بالبيانات
                </span>
              </div>
              <h3 class="panel-title" style="margin: 4px 0 0 0; font-size: 1.25rem;">
                🎯 الرقابة الذكية والتدقيق الفيزيائي لنسبة الإنجاز (Smart % Complete)
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.84rem; margin: 4px 0 0 0;">
                حساب آلي عادل متعدد المصادر يمنع إدخال نسب وهمية ويعتمد على كميات BOQ، المستخلصات المعتمدة، تكلفة الأعمال، تقارير الموقع، واعتماد الاستشاري.
              </p>
            </div>
            <!-- أزرار الإجراءات -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-primary" onclick="ProjectControlUI.adoptCalculatedCompletion(${d.recommended_percentage})" style="background: linear-gradient(135deg, #059669, #10b981); border: none; font-weight: bold;">
                <span>✅ اعتماد وتطبيق النسبة المحسوبة (${d.recommended_percentage}%)</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.openManualOverrideModal(${d.current_manual_percentage}, ${d.recommended_percentage})">
                <span>✏️ تعديل يدوي مع مسوّغ معتمد</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.openEngineerCertModal()">
                <span>👨‍💼 تسجيل شهادة استشاري</span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.renderSmartCompletion()" title="تحديث البيانات">
                🔄
              </button>
            </div>
          </div>

          <!-- بطاقة المقارنة الرئيسية الكبرى -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 20px 0;">
            <!-- النسبة المسجلة الحالية -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; text-align: center; position: relative;">
              <span style="font-size: 0.82rem; color: var(--text-secondary); font-weight: bold; display: block; margin-bottom: 8px;">النسبة الحالية المسجلة بالنظام</span>
              <div style="font-size: 3rem; font-weight: 900; color: var(--gold-light); font-family: monospace; line-height: 1;">
                ${d.current_manual_percentage}%
              </div>
              <span style="font-size: 0.76rem; color: var(--text-muted); display: block; margin-top: 8px;">(مسجلة في بطاقة المشروع العامة)</span>
            </div>

            <!-- النسبة الموصى بها والمحسوبة عادلاً -->
            <div style="background: rgba(16, 185, 129, 0.08); border: 2px solid ${statusColor}; border-radius: 12px; padding: 20px; text-align: center;">
              <span style="font-size: 0.82rem; color: #34d399; font-weight: bold; display: block; margin-bottom: 8px;">النسبة المحسوبة الموزونة (الواقع الفعلي)</span>
              <div style="font-size: 3rem; font-weight: 900; color: #10b981; font-family: monospace; line-height: 1;">
                ${d.recommended_percentage}%
              </div>
              <span style="font-size: 0.76rem; color: #a7f3d0; display: block; margin-top: 8px;">مستخلصة من 5 محاور هندسية موثقة</span>
            </div>

            <!-- مؤشر الانحراف والمطابقة -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; text-align: center;">
              <span style="font-size: 0.82rem; color: var(--text-secondary); font-weight: bold; display: block; margin-bottom: 8px;">حجم الانحراف الرقابي (Variance)</span>
              <div style="font-size: 2.8rem; font-weight: 900; color: ${Math.abs(d.variance) > 15 ? '#ef4444' : (Math.abs(d.variance) > 5 ? '#f59e0b' : '#10b981')}; font-family: monospace; line-height: 1;">
                ${d.variance > 0 ? '+' : ''}${d.variance}%
              </div>
              <span style="font-size: 0.76rem; color: var(--text-muted); display: block; margin-top: 8px;">
                ${Math.abs(d.variance) <= 5 ? 'ضمن النطاق المسموح (±5%)' : (d.variance > 0 ? 'مبالغة في نسبة الإنجاز ⚠️' : 'إنجاز فعلي متقدم عن المسجل')}
              </span>
            </div>
          </div>

          <!-- رسالة التشخيص الرقابي والتبرير -->
          <div style="background: ${statusBg}; border-right: 4px solid ${statusColor}; border-radius: 6px; padding: 12px 18px; margin-bottom: 24px;">
            <strong style="color: ${statusColor}; display: block; margin-bottom: 4px;">تقرير التحقق الرقابي:</strong>
            <span style="color: #f1f5f9; font-size: 0.9rem;">${d.validation_message}</span>
          </div>

          <!-- تفكيك المصادر الخمسة لحساب النسبة (The 5 Physical Pillars) -->
          <h4 style="color: var(--gold-light); margin: 0 0 16px 0; font-size: 1.05rem;">
            📊 تفكيك مصادر احتساب نسبة الإنجاز (الأوزان النسبية والمستندات الداعمة)
          </h4>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
            
            <!-- 1. كميات BOQ المنفذة -->
            <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-light); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: #38bdf8;">1. كميات BOQ المنفذة</span>
                <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">الوزن: 35%</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <span style="font-size: 1.4rem; font-weight: 800; color: #fff;">${s.boq.percentage}%</span>
                <span style="font-size: 0.78rem; color: var(--text-secondary);">${s.boq.items_with_progress || 0} من ${s.boq.total_items_count || 0} بنود منفذة</span>
              </div>
              <div style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${Math.min(100, s.boq.percentage)}%; height: 100%; background: linear-gradient(90deg, #0284c7, #38bdf8);"></div>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>قيمة الكميات المنفذة: ${App.formatNumber(s.boq.executed_value || 0)}</span>
                <span>إجمالي العقد: ${App.formatNumber(s.boq.total_boq_value || 0)}</span>
              </div>
            </div>

            <!-- 2. المستخلصات المعتمدة -->
            <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-light); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: #10b981;">2. المستخلصات المعتمدة من المالك</span>
                <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">الوزن: 25%</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <span style="font-size: 1.4rem; font-weight: 800; color: #fff;">${s.invoices.percentage}%</span>
                <span style="font-size: 0.78rem; color: var(--text-secondary);">${s.invoices.approved_count || 0} مستخلص معتمد</span>
              </div>
              <div style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${Math.min(100, s.invoices.percentage)}%; height: 100%; background: linear-gradient(90deg, #059669, #10b981);"></div>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>صافي المستخلصات: ${App.formatNumber(s.invoices.approved_net_amount || 0)}</span>
                <span>قيمة العقد: ${App.formatNumber(s.invoices.contract_value || 0)}</span>
              </div>
            </div>

            <!-- 3. تقارير الموقع الميدانية -->
            <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-light); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: #f59e0b;">3. تقارير الموقع اليومية</span>
                <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">الوزن: 15%</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <span style="font-size: 1.4rem; font-weight: 800; color: #fff;">${s.daily_reports.percentage}%</span>
                <span style="font-size: 0.78rem; color: var(--text-secondary);">${s.daily_reports.count || 0} تقرير موقع موثق</span>
              </div>
              <div style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${Math.min(100, s.daily_reports.percentage)}%; height: 100%; background: linear-gradient(90deg, #d97706, #f59e0b);"></div>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted);">
                آخر نسبة مسجلة بالتقرير: ${s.daily_reports.latest_pct ? s.daily_reports.latest_pct + '%' : 'غير مسجل'}
              </div>
            </div>

            <!-- 4. تكلفة الأعمال المنفذة -->
            <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-light); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: #a855f7;">4. نسبة تكلفة الأعمال المنصرفة</span>
                <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #a855f7;">الوزن: 15%</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <span style="font-size: 1.4rem; font-weight: 800; color: #fff;">${s.cost_ratio.percentage}%</span>
                <span style="font-size: 0.78rem; color: var(--text-secondary);">استهلاك الميزانية المستهدفة</span>
              </div>
              <div style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${Math.min(100, s.cost_ratio.percentage)}%; height: 100%; background: linear-gradient(90deg, #7e22ce, #a855f7);"></div>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>المصروف الفعلي: ${App.formatNumber(s.cost_ratio.actual_cost || 0)}</span>
                <span>الميزانية المستهدفة: ${App.formatNumber(s.cost_ratio.budget || 0)}</span>
              </div>
            </div>

            <!-- 5. اعتماد المهندس أو الاستشاري -->
            <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-light); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: var(--gold-light);">5. شهادات الاستشاري / المهندس</span>
                <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light);">الوزن: 10%</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <span style="font-size: 1.4rem; font-weight: 800; color: #fff;">${s.engineer_cert.percentage}%</span>
                <span style="font-size: 0.78rem; color: var(--text-secondary);">${s.engineer_cert.count || 0} شهادة معتمدة</span>
              </div>
              <div style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${Math.min(100, s.engineer_cert.percentage)}%; height: 100%; background: linear-gradient(90deg, #b8911c, #f3cf65);"></div>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted);">
                ${s.engineer_cert.latest ? `آخر شهادة: ${s.engineer_cert.latest.certifier_name || 'مهندس'} (${s.engineer_cert.latest.pct}%)` : 'لم تسجل شهادة استشاري بعد'}
              </div>
            </div>

          </div>

          <!-- جدول شهادات الاستشاري المسجلة -->
          <div style="margin-top: 28px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h5 style="color: #fff; margin: 0; font-size: 0.95rem;">📜 سجل شهادات فحص واعتماد المهندس المشرف / الاستشاري</h5>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.openEngineerCertModal()">+ إضافة شهادة معاينة</button>
            </div>
            <div class="table-responsive">
              <table class="custom-table" style="font-size: 0.85rem;">
                <thead>
                  <tr>
                    <th>تاريخ المعاينة</th>
                    <th>المهندس / الاستشاري</th>
                    <th>الصفة والجهة</th>
                    <th>النسبة المعتمدة</th>
                    <th>الملاحظات والتوصيات</th>
                    <th>مسجل الشهادة</th>
                  </tr>
                </thead>
                <tbody id="engineerCertsTableBody">
                  <tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">جاري تحميل الشهادات...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      this.loadEngineerCertificationsTable(projectId);

    } catch (err) {
      if (err.message && err.message.includes('تسجيل الدخول')) {
        this.renderAuthRequired(container, 'مؤشرات تدقيق نسبة الإنجاز');
        return;
      }
      console.warn('Notice loading smart completion:', err);
      container.innerHTML = `
        <div class="panel-card" style="padding: 30px; text-align: center; border: 1px dashed var(--accent-red);">
          <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
          <h4 style="color: var(--accent-red); margin-bottom: 8px;">تعذر تحميل مؤشرات الرقابة على نسبة الإنجاز</h4>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">${err.message}</p>
          <button class="btn btn-secondary" onclick="ProjectControlUI.renderSmartCompletion()">إعادة المحاولة</button>
        </div>
      `;
    }
  },

  async loadEngineerCertificationsTable(projectId) {
    const tbody = document.getElementById('engineerCertsTableBody');
    if (!tbody) return;
    try {
      const res = await this.fetch(`/api/project-control/${projectId}/completion/engineer-certs`);
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد شهادات اعتماد مسجلة من المهندس حتى الآن. انقر على "+ إضافة شهادة معاينة" للتوثيق.</td></tr>`;
        return;
      }
      tbody.innerHTML = json.data.map(c => `
        <tr>
          <td><span style="font-family: monospace;">${c.inspection_date || c.created_at?.split(' ')[0] || '-'}</span></td>
          <td><strong style="color: var(--gold-light);">${c.certifier_name || 'مهندس استشاري'}</strong></td>
          <td><span class="badge" style="background: rgba(255,255,255,0.06);">${c.certifier_role || 'استشاري المشروع'}</span></td>
          <td><span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981; font-weight: bold; font-size: 0.9rem;">${c.pct}%</span></td>
          <td><span style="color: var(--text-secondary);">${c.notes || 'معاينة مطابقة للمواصفات'}</span></td>
          <td><span style="font-size: 0.78rem; color: var(--text-muted);">${c.created_at || '-'}</span></td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--accent-red);">تعذر جلب جدول الشهادات</td></tr>`;
    }
  },

  // اعتماد وتطبيق النسبة المحسوبة تلقائياً بنقرة واحدة
  async adoptCalculatedCompletion(pct) {
    if (!confirm(`هل أنت متأكد من رغبتك في اعتماد النسبة المحسوبة فيزيائياً (${pct}%) كنسبة إنجاز رسمية للمشروع؟ سيتم تحديث شريط مؤشرات المشروع تلقائياً.`)) {
      return;
    }
    const pid = this.getProjectId();
    try {
      App.showToast('جاري تحديث نسبة الإنجاز واعتمادها...', 'info');
      const res = await this.fetch(this.apiUrl('completion/manual'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          percent_complete: pct,
          justification: `اعتماد آلي مباشر بناءً على التدقيق الفيزيائي والمصادر الخمسة بنسبة ${pct}%`
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'تعذر اعتماد النسبة');

      App.showToast(`تم اعتماد وتحديث نسبة الإنجاز إلى ${pct}% بنجاح ✅`, 'success');
      // تحديث شريط الـ KPIs العلوي إن وجد
      const kpiEl = document.getElementById('hubKpiProgress');
      if (kpiEl) kpiEl.innerText = `${pct}%`;
      // إعادة تحميل اللوحة
      this.renderSmartCompletion(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  openManualOverrideModal(current, recommended) {
    const modal = document.getElementById('manualCompletionModal');
    if (!modal) return;
    document.getElementById('manualOverrideCurrentVal').innerText = `${current}%`;
    document.getElementById('manualOverrideRecommendedVal').innerText = `${recommended}%`;
    document.getElementById('manualOverrideInput').value = current;
    document.getElementById('manualOverrideJustification').value = '';
    App.openModal('manualCompletionModal');
  },

  async submitManualOverride(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const pct = Number(document.getElementById('manualOverrideInput').value);
    const justification = document.getElementById('manualOverrideJustification').value.trim();

    if (isNaN(pct) || pct < 0 || pct > 100) {
      App.showToast('نسبة الإنجاز يجب أن تكون رقماً بين 0 و100', 'error');
      return;
    }

    try {
      App.showToast('جاري التحقق من مسوغات الإنجاز...', 'info');
      const res = await this.fetch(this.apiUrl('completion/manual'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent_complete: pct, justification })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل تحديث نسبة الإنجاز');

      App.closeModal('manualCompletionModal');
      App.showToast('تم تحديث نسبة الإنجاز وتوثيق المسوّغ الهندسي بسجل الرقابة ✅', 'success');
      const kpiEl = document.getElementById('hubKpiProgress');
      if (kpiEl) kpiEl.innerText = `${pct}%`;
      this.renderSmartCompletion(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  openEngineerCertModal() {
    App.openModal('engineerCertModal');
  },

  async submitEngineerCert(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const payload = {
      pct: Number(document.getElementById('engCertPct').value),
      certifier_name: document.getElementById('engCertName').value.trim(),
      certifier_role: document.getElementById('engCertRole').value.trim(),
      inspection_date: document.getElementById('engCertDate').value,
      notes: document.getElementById('engCertNotes').value.trim()
    };

    if (isNaN(payload.pct) || payload.pct < 0 || payload.pct > 100) {
      App.showToast('النسبة يجب أن تكون بين 0 و100', 'error');
      return;
    }

    try {
      App.showToast('جاري تسجيل شهادة الاستشاري...', 'info');
      const res = await this.fetch(this.apiUrl('completion/engineer-cert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل تسجيل الشهادة');

      App.closeModal('engineerCertModal');
      App.showToast('تم تسجيل شهادة المهندس الاستشاري بنجاح ✅', 'success');
      this.renderSmartCompletion(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },


  // ==========================================================================
  // 2. إدارة الجدول الزمني وهيكل WBS والمسار الحرج (WBS & CPM Scheduler)
  // ==========================================================================

  async renderWBSSchedule(projectId) {
    this.currentProjectId = projectId || this.getProjectId();
    const container = document.getElementById('hubPane_wbs-schedule');
    if (!container) return;

    if (!this.isAuthenticated()) {
      this.renderAuthRequired(container, 'هيكل WBS والجدول الزمني والمسار الحرج');
      return;
    }

    if (!this.currentProjectId) {
      this.renderNoProjectSelected(container, 'الجدول الزمني WBS');
      return;
    }

    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <p style="color: var(--gold-light); font-weight: bold;">جاري تحميل هيكل WBS والجدول الزمني وحساب المسار الحرج...</p>
      </div>
    `;

    try {
      const [wbsRes, compRes] = await Promise.all([
        this.fetch(this.apiUrl('wbs')),
        this.fetch(this.apiUrl('wbs/compare-baseline'))
      ]);

      if (wbsRes.status === 401 || compRes.status === 401) {
        this.renderAuthRequired(container, 'هيكل WBS والجدول الزمني');
        return;
      }

      const wbsJson = await wbsRes.json();
      const compJson = await compRes.json();

      if (wbsJson.authenticated === false || compJson.authenticated === false ||
          (wbsJson.message && wbsJson.message.includes('تسجيل الدخول'))) {
        this.renderAuthRequired(container, 'هيكل WBS والجدول الزمني');
        return;
      }

      const activities = wbsJson.activities || [];
      const stats = wbsJson.stats || {};
      const comp = compJson.data || {};
      this.cache.wbs = { activities, stats, comp };

      container.innerHTML = `
        <div class="panel-card" style="margin-bottom: 20px;">
          <!-- شريط التحكم العلوي -->
          <div class="panel-header" style="flex-wrap: wrap; gap: 14px; border-bottom: 1px solid var(--border-light); padding-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: bold;">
                  ⏱️ إدارة الجدول الزمني الاحترافي
                </span>
                <span class="badge" style="background: ${comp.has_baseline ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${comp.has_baseline ? '#10b981' : '#f59e0b'};">
                  ${comp.has_baseline ? `📌 خط الأساس: ${comp.baseline?.name || 'معتمد'}` : '⚠️ لم يتم حفظ خط أساس بعد'}
                </span>
              </div>
              <h3 class="panel-title" style="margin: 4px 0 0 0; font-size: 1.25rem;">
                🏗️ هيكل تجزئة العمل (WBS)، خط الأساس، والمسار الحرج (CPM)
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.84rem; margin: 4px 0 0 0;">
                إدارة الأنشطة والاعتماديات، كشف التأخيرات مقارنة بخط الأساس التعاقدي، وحساب المسار الحرج (Critical Path) لتفادي غرامات التأخير.
              </p>
            </div>

            <!-- أزرار الإجراءات -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-primary" onclick="ProjectControlUI.openAddWbsActivityModal()" style="background: linear-gradient(135deg, #4f46e5, #6366f1); border: none; font-weight: bold;">
                <span>+ إضافة نشاط / حزمة عمل WBS</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.runCPMEngine()" style="border-color: #ef4444; color: #f87171;">
                <span>⚡ تشغيل محرك المسار الحرج (CPM)</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.openSaveBaselineModal()">
                <span>📌 حفظ خط الأساس (Baseline)</span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.renderWBSSchedule()" title="تحديث">
                🔄
              </button>
            </div>
          </div>

          <!-- شريط الإحصائيات الأربعة للجدول الزمني -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin: 18px 0;">
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">إجمالي أنشطة WBS</span>
              <span class="hub-kpi-value" style="color: #38bdf8; font-size: 1.6rem;">${stats.total_activities || activities.length} <small>نشاط</small></span>
            </div>
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">أنشطة المسار الحرج (Critical)</span>
              <span class="hub-kpi-value" style="color: #ef4444; font-size: 1.6rem;">${stats.critical_activities || 0} <small>حرج 🔴</small></span>
            </div>
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">أنشطة متأخرة عن الخطة</span>
              <span class="hub-kpi-value" style="color: ${(comp.delayed_tasks_count || 0) > 0 ? '#f59e0b' : '#10b981'}; font-size: 1.6rem;">
                ${comp.delayed_tasks_count || 0} <small>نشاط</small>
              </span>
            </div>
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">مدة المشروع الإجمالية المخططة</span>
              <span class="hub-kpi-value" style="color: var(--gold-light); font-size: 1.6rem;">${stats.project_duration_days || '-'} <small>يوم</small></span>
            </div>
          </div>

          <!-- شريط تنبيه المقارنة مع خط الأساس إن وُجد تأخير -->
          ${comp.delayed_tasks_count > 0 ? `
            <div style="background: rgba(245, 158, 11, 0.12); border-right: 4px solid #f59e0b; border-radius: 6px; padding: 12px 18px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
              <div>
                <strong style="color: #f59e0b; display: block;">⚠️ تنبيه انحراف الجدول الزمني (Schedule Delay Alert):</strong>
                <span style="font-size: 0.88rem; color: #f1f5f9;">
                  يوجد ${comp.delayed_tasks_count} أنشطة متأخرة عن خط الأساس التعاقدي، وأقصى تأخير مسجل يصل إلى ${comp.max_delay_days || 0} يوم في الأنشطة التنفيذية.
                </span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.highlightDelayedTasks()">عرض الأنشطة المتأخرة فقط</button>
            </div>
          ` : ''}

          <!-- جدول أنشطة WBS ومخطط جانت المصغر -->
          <div class="table-responsive" style="border: 1px solid var(--border-light); border-radius: 8px;">
            <table class="custom-table" id="wbsTable" style="font-size: 0.84rem;">
              <thead style="background: #0f172a; position: sticky; top: 0;">
                <tr>
                  <th style="width: 80px;">رمز WBS</th>
                  <th>مسمى النشاط / حزمة العمل</th>
                  <th>البداية المخططة</th>
                  <th>النهاية المخططة</th>
                  <th>المدة</th>
                  <th>نسبة الإنجاز</th>
                  <th>الاعتمادية (Predecessors)</th>
                  <th>المسار الحرج والركود</th>
                  <th>الموارد والتكلفة</th>
                  <th style="text-align: center; width: 100px;">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${activities.length === 0 ? `
                  <tr>
                    <td colspan="10" style="text-align: center; padding: 40px; color: var(--text-muted);">
                      <div style="font-size: 2.2rem; margin-bottom: 10px;">📐</div>
                      <h4 style="color: #fff; margin-bottom: 6px;">لا توجد أنشطة WBS مسجلة لهذا المشروع بعد</h4>
                      <p style="font-size: 0.85rem; margin-bottom: 16px;">قم بإضافة حزم العمل والأنشطة والاعتماديات لبناء البرنامج الزمني وحساب المسار الحرج.</p>
                      <button class="btn btn-primary btn-sm" onclick="ProjectControlUI.openAddWbsActivityModal()">+ إضافة أول نشاط WBS</button>
                    </td>
                  </tr>
                ` : activities.map(a => {
                  const isCrit = Boolean(a.is_critical);
                  const isDelayed = a.is_delayed;
                  return `
                    <tr class="wbs-row ${isCrit ? 'wbs-critical-row' : ''} ${isDelayed ? 'wbs-delayed-row' : ''}" style="${isCrit ? 'background: rgba(239, 68, 68, 0.05);' : ''}">
                      <td>
                        <strong style="color: var(--gold-light); font-family: monospace;">${a.wbs_code || '-'}</strong>
                      </td>
                      <td>
                        <div style="padding-right: ${(Math.max(0, (a.level || 1) - 1)) * 18}px; font-weight: ${a.level === 1 ? '800' : '500'}; color: #f1f5f9;">
                          ${a.level > 1 ? '↳ ' : ''}${a.name}
                        </div>
                      </td>
                      <td><span style="font-family: monospace;">${a.planned_start || '-'}</span></td>
                      <td><span style="font-family: monospace;">${a.planned_end || '-'}</span></td>
                      <td><span style="font-family: monospace;">${a.duration_days || 0} يوم</span></td>
                      <td style="min-width: 110px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <div style="flex: 1; background: rgba(255,255,255,0.08); height: 6px; border-radius: 3px; overflow: hidden;">
                            <div style="width: ${a.progress_pct || 0}%; height: 100%; background: ${isCrit ? '#ef4444' : '#10b981'};"></div>
                          </div>
                          <span style="font-family: monospace; font-size: 0.75rem; color: #cbd5e1;">${a.progress_pct || 0}%</span>
                        </div>
                      </td>
                      <td>
                        <span style="font-size: 0.76rem; color: #94a3b8; font-family: monospace;">
                          ${a.predecessors || '-'}
                        </span>
                      </td>
                      <td>
                        ${isCrit ? `
                          <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight: bold;">
                            مسار حرج 🔴 (TF: 0)
                          </span>
                        ` : `
                          <span class="badge" style="background: rgba(255, 255, 255, 0.05); color: #94a3b8;">
                            فائض: ${a.total_float || 0} يوم
                          </span>
                        `}
                      </td>
                      <td>
                        <span style="font-size: 0.76rem; color: var(--text-secondary); display: block;">
                          ${a.assigned_resources ? '👷 ' + a.assigned_resources : '-'}
                        </span>
                        ${a.estimated_cost ? `<span style="font-size: 0.72rem; color: var(--gold-light); font-family: monospace;">${App.formatNumber(a.estimated_cost)}</span>` : ''}
                      </td>
                      <td style="text-align: center;">
                        <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.deleteWBSActivity(${a.id})" title="حذف النشاط" style="padding: 3px 7px; color: #f87171;">
                          🗑️
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

    } catch (err) {
      if (err.message && err.message.includes('تسجيل الدخول')) {
        this.renderAuthRequired(container, 'هيكل WBS والجدول الزمني');
        return;
      }
      console.warn('Notice loading WBS Schedule:', err);
      container.innerHTML = `
        <div class="panel-card" style="padding: 30px; text-align: center; border: 1px dashed var(--accent-red);">
          <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
          <h4 style="color: var(--accent-red); margin-bottom: 8px;">تعذر تحميل هيكل WBS والجدول الزمني</h4>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">${err.message}</p>
          <button class="btn btn-secondary" onclick="ProjectControlUI.renderWBSSchedule()">إعادة المحاولة</button>
        </div>
      `;
    }
  },

  async runCPMEngine() {
    const pid = this.getProjectId();
    try {
      App.showToast('جاري تشغيل خوارزمية المسار الحرج (CPM Forward/Backward Pass)...', 'info');
      const res = await this.fetch(this.apiUrl('wbs/cpm'), { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل حساب المسار الحرج');

      const d = json.data;
      App.showToast(`تم حساب المسار الحرج بنجاح! إجمالي مدة المشروع: ${d.project_duration_days} يوم، والأنشطة الحرجة: ${d.critical_path?.length || 0} نشاط ✅`, 'success');
      this.renderWBSSchedule(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  openSaveBaselineModal() {
    App.openModal('saveBaselineModal');
  },

  async submitSaveBaseline(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const name = document.getElementById('baselineModalName').value.trim() || `خط الأساس - ${new Date().toLocaleDateString('ar')}`;
    const notes = document.getElementById('baselineModalNotes').value.trim();

    try {
      App.showToast('جاري حفظ لقطة خط الأساس...', 'info');
      const res = await this.fetch(this.apiUrl('wbs/baseline'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, notes })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل حفظ خط الأساس');

      App.closeModal('saveBaselineModal');
      App.showToast('تم حفظ خط الأساس التعاقدي بنجاح 📌', 'success');
      this.renderWBSSchedule(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  openAddWbsActivityModal() {
    App.openModal('wbsActivityModal');
  },

  async submitWbsActivity(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const payload = {
      wbs_code: document.getElementById('wbsModalCode').value.trim(),
      name: document.getElementById('wbsModalName').value.trim(),
      planned_start: document.getElementById('wbsModalStart').value,
      planned_end: document.getElementById('wbsModalEnd').value,
      duration_days: Number(document.getElementById('wbsModalDuration').value) || 1,
      progress_pct: Number(document.getElementById('wbsModalProgress').value) || 0,
      predecessors: document.getElementById('wbsModalPredecessors').value.trim(),
      assigned_resources: document.getElementById('wbsModalResources').value.trim(),
      estimated_cost: Number(document.getElementById('wbsModalCost').value) || 0
    };

    if (!payload.wbs_code || !payload.name) {
      App.showToast('رمز WBS ومسمى النشاط حقول إلزامية', 'error');
      return;
    }

    try {
      App.showToast('جاري حفظ نشاط WBS...', 'info');
      const res = await this.fetch(this.apiUrl('wbs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل إضافة النشاط');

      App.closeModal('wbsActivityModal');
      App.showToast('تمت إضافة نشاط WBS بنجاح ✅', 'success');
      this.renderWBSSchedule(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async deleteWBSActivity(activityId) {
    if (!confirm('هل أنت متأكد من رغبتك في حذف هذا النشاط؟')) return;
    const pid = this.getProjectId();
    try {
      const res = await this.fetch(`/api/project-control/${pid}/wbs/${activityId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل حذف النشاط');
      App.showToast('تم حذف النشاط بنجاح', 'success');
      this.renderWBSSchedule(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  highlightDelayedTasks() {
    document.querySelectorAll('.wbs-delayed-row').forEach(row => {
      row.style.outline = '2px solid #f59e0b';
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },


  // ==========================================================================
  // 3. إدارة القيمة المكتسبة EVM والكشف المبكر (Earned Value Management)
  // ==========================================================================

  async renderEVM(projectId) {
    this.currentProjectId = projectId || this.getProjectId();
    const container = document.getElementById('hubPane_evm-control');
    if (!container) return;

    if (!this.isAuthenticated()) {
      this.renderAuthRequired(container, 'مؤشرات القيمة المكتسبة (EVM Dashboard)');
      return;
    }

    if (!this.currentProjectId) {
      this.renderNoProjectSelected(container, 'مؤشرات القيمة المكتسبة EVM');
      return;
    }

    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <p style="color: var(--gold-light); font-weight: bold;">جاري حساب مؤشرات القيمة المكتسبة EVM والتنبؤات المالية...</p>
      </div>
    `;

    try {
      const res = await this.fetch(this.apiUrl('evm'));
      if (res.status === 401) {
        this.renderAuthRequired(container, 'مؤشرات القيمة المكتسبة EVM');
        return;
      }
      const json = await res.json();
      if (!json.success) {
        if (json.authenticated === false || (json.message && json.message.includes('تسجيل الدخول'))) {
          this.renderAuthRequired(container, 'مؤشرات القيمة المكتسبة EVM');
          return;
        }
        throw new Error(json.message || 'فشل جلب مؤشرات EVM');
      }

      const d = json.data || {};
      this.cache.evm = d;
      const m = d.metrics || {};
      const h = d.health_indicators || {};

      m.CPI = Number(m.CPI ?? d.cpi ?? 1.0);
      m.SPI = Number(m.SPI ?? d.spi ?? 1.0);
      m.PV = Number(m.PV ?? d.pv ?? 0);
      m.EV = Number(m.EV ?? d.ev ?? 0);
      m.AC = Number(m.AC ?? d.ac ?? 0);
      m.BAC = Number(m.BAC ?? d.bac ?? 0);
      m.EAC = Number(m.EAC ?? d.eac ?? 0);
      m.VAC = Number(m.VAC ?? d.vac ?? 0);
      m.ETC = Number(m.ETC ?? d.etc ?? 0);
      m.CV = Number(m.CV ?? d.cv ?? 0);
      m.SV = Number(m.SV ?? d.sv ?? 0);
      m.TCPI = Number(m.TCPI ?? d.tcpi_bac ?? 1.0);
      m.progress_percentage = Number(m.progress_percentage ?? d.completion_pct ?? 0);

      h.cost_status = h.cost_status || (m.CPI >= 1.0 ? 'green' : (m.CPI >= 0.85 ? 'yellow' : 'red'));
      h.schedule_status = h.schedule_status || (m.SPI >= 1.0 ? 'green' : 'yellow');
      d.currency = d.currency || 'ر.ي';
      d.executive_summary = d.executive_summary || (Array.isArray(d.interpretation) ? d.interpretation.join(' | ') : 'تظهر المؤشرات أن التكلفة الفعلية ومعدل الإنجاز المكتسب يسيران وفق التقديرات المعتمدة.');

      // ألوان وحالة المؤشرات
      const isCpiHealthy = m.CPI >= 1.0;
      const isSpiHealthy = m.SPI >= 1.0;

      container.innerHTML = `
        <div class="panel-card" style="margin-bottom: 20px;">
          <!-- شريط الرأس العلوي -->
          <div class="panel-header" style="flex-wrap: wrap; gap: 14px; border-bottom: 1px solid var(--border-light); padding-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="badge" style="background: ${h.cost_status === 'green' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${h.cost_status === 'green' ? '#10b981' : '#f87171'}; border: 1px solid ${h.cost_status === 'green' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}; font-weight: bold;">
                  التكلفة (Cost): ${h.cost_status === 'green' ? 'ضمن الميزانية 🟢' : (h.cost_status === 'yellow' ? 'تحذير تجاوز 🟡' : 'تجاوز حرج 🔴')}
                </span>
                <span class="badge" style="background: ${h.schedule_status === 'green' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${h.schedule_status === 'green' ? '#10b981' : '#f59e0b'}; border: 1px solid ${h.schedule_status === 'green' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}; font-weight: bold;">
                  الزمن (Schedule): ${h.schedule_status === 'green' ? 'وفق الخطة 🟢' : 'متأخر عن الخطة 🟡'}
                </span>
              </div>
              <h3 class="panel-title" style="margin: 4px 0 0 0; font-size: 1.25rem;">
                📈 إدارة القيمة المكتسبة (Earned Value Management - EVM)
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.84rem; margin: 4px 0 0 0;">
                نظام الرقابة المالية والهندسية القياسي لكشف تجاوز التكاليف وتأخر الإنجاز مبكراً عبر مؤشرات CPI, SPI, EAC, VAC.
              </p>
            </div>

            <!-- أزرار الإجراءات -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-primary" onclick="ProjectControlUI.captureEVMSnapshot()" style="background: linear-gradient(135deg, #059669, #10b981); border: none; font-weight: bold;">
                <span>📸 حفظ لقطة أداء دورية (Take Snapshot)</span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.renderEVM()" title="تحديث">
                🔄
              </button>
            </div>
          </div>

          <!-- بطاقة التنبيه الرقابي المبكر (Early Warning Executive Banner) -->
          <div style="background: ${isCpiHealthy && isSpiHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border-right: 4px solid ${isCpiHealthy && isSpiHealthy ? '#10b981' : '#ef4444'}; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
              <span style="font-size: 1.8rem;">${isCpiHealthy && isSpiHealthy ? '🟢' : '🚨'}</span>
              <div>
                <strong style="color: ${isCpiHealthy && isSpiHealthy ? '#34d399' : '#f87171'}; font-size: 1.05rem; display: block; margin-bottom: 4px;">
                  ${isCpiHealthy && isSpiHealthy ? 'الأداء المالي والهندسي سليم ومنضبط' : 'إنذار رقابي مبكر للإدارة التنفيذية:'}
                </strong>
                <p style="color: #f1f5f9; font-size: 0.9rem; margin: 0; line-height: 1.5;">
                  ${d.executive_summary || 'تظهر المؤشرات أن التكلفة الفعلية ومعدل الإنجاز المكتسب يسيران وفق التقديرات المعتمدة.'}
                </p>
              </div>
            </div>
          </div>

          <!-- شبكة بطاقات مؤشرات EVM الرئيسية (The EVM Matrix) -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px;">

            <!-- PV: القيمة المخططة -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: #38bdf8; font-weight: bold;">PV: القيمة المخططة</span>
                <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">Planned Value</span>
              </div>
              <div style="font-size: 1.8rem; font-weight: 800; color: #fff; font-family: monospace;">
                ${App.formatNumber(m.PV)} <small style="font-size: 0.85rem; color: var(--gold-light);">${d.currency}</small>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                قيمة الأعمال المفترض إنجازها تعاقدياً حتى اليوم
              </span>
            </div>

            <!-- EV: القيمة المكتسبة -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: #10b981; font-weight: bold;">EV: القيمة المكتسبة</span>
                <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">Earned Value</span>
              </div>
              <div style="font-size: 1.8rem; font-weight: 800; color: #10b981; font-family: monospace;">
                ${App.formatNumber(m.EV)} <small style="font-size: 0.85rem; color: var(--gold-light);">${d.currency}</small>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                القيمة التعاقدية الحقيقية للأعمال المنجزة فعلياً (${m.progress_percentage}%)
              </span>
            </div>

            <!-- AC: التكلفة الفعلية -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: #f87171; font-weight: bold;">AC: التكلفة الفعلية</span>
                <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Actual Cost</span>
              </div>
              <div style="font-size: 1.8rem; font-weight: 800; color: #f87171; font-family: monospace;">
                ${App.formatNumber(m.AC)} <small style="font-size: 0.85rem; color: var(--gold-light);">${d.currency}</small>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                المبالغ المصروفة حقيقة (المشتريات + العمالة والمصروفات)
              </span>
            </div>

            <!-- BAC: إجمالي الميزانية -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: var(--gold-light); font-weight: bold;">BAC: ميزانية الإكمال</span>
                <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light);">Budget at Completion</span>
              </div>
              <div style="font-size: 1.8rem; font-weight: 800; color: var(--gold-light); font-family: monospace;">
                ${App.formatNumber(m.BAC)} <small style="font-size: 0.85rem; color: var(--gold-light);">${d.currency}</small>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                الميزانية التعاقدية الإجمالية المعتمدة للمشروع
              </span>
            </div>

            <!-- CPI: مؤشر أداء التكلفة -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid ${isCpiHealthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}; border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: ${isCpiHealthy ? '#10b981' : '#f87171'}; font-weight: bold;">CPI: مؤشر أداء التكلفة</span>
                <span class="badge" style="background: ${isCpiHealthy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${isCpiHealthy ? '#10b981' : '#f87171'};">
                  ${m.CPI >= 1 ? 'وفر مالي ✅' : 'تجاوز تكلفة ❌'}
                </span>
              </div>
              <div style="font-size: 2.2rem; font-weight: 900; color: ${isCpiHealthy ? '#10b981' : '#f87171'}; font-family: monospace;">
                ${m.CPI}
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                ${m.CPI >= 1 ? 'كل 1 ر.ي مصروف يُحقق عائداً يفوق التكلفة' : `كل 1 ر.ي مصروف يُحقق فقط ${m.CPI} ر.ي إنجاز فعلي`}
              </span>
            </div>

            <!-- SPI: مؤشر أداء الجدول الزمني -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid ${isSpiHealthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}; border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: ${isSpiHealthy ? '#10b981' : '#f59e0b'}; font-weight: bold;">SPI: مؤشر أداء الجدول</span>
                <span class="badge" style="background: ${isSpiHealthy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${isSpiHealthy ? '#10b981' : '#f59e0b'};">
                  ${m.SPI >= 1 ? 'متقدم عن الخطة ⚡' : 'متأخر زمنياً ⏳'}
                </span>
              </div>
              <div style="font-size: 2.2rem; font-weight: 900; color: ${isSpiHealthy ? '#10b981' : '#f59e0b'}; font-family: monospace;">
                ${m.SPI}
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                ${m.SPI >= 1 ? 'وتيرة الإنجاز الفيزيائي أسرع من الجدول المخطط' : 'وتيرة الإنجاز متأخرة عن الجدول الزمني المستهدف'}
              </span>
            </div>

            <!-- EAC: التكلفة المتوقعة عند الإكمال -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: #e2e8f0; font-weight: bold;">EAC: التكلفة النهائية المتوقعة</span>
                <span class="badge" style="background: rgba(255, 255, 255, 0.08); color: #cbd5e1;">Forecast at Completion</span>
              </div>
              <div style="font-size: 1.8rem; font-weight: 800; color: ${m.EAC > m.BAC ? '#f87171' : '#10b981'}; font-family: monospace;">
                ${App.formatNumber(m.EAC)} <small style="font-size: 0.85rem; color: var(--gold-light);">${d.currency}</small>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                التكلفة الإجمالية التي سينتهي عندها المشروع بالمعدل الحالي
              </span>
            </div>

            <!-- VAC: الانحراف المتوقع عند الإكمال -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: ${m.VAC >= 0 ? '#10b981' : '#f87171'}; font-weight: bold;">VAC: الانحراف النهائي المتوقع</span>
                <span class="badge" style="background: ${m.VAC >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${m.VAC >= 0 ? '#10b981' : '#f87171'};">
                  ${m.VAC >= 0 ? 'وفر متوقع' : 'عجز متوقع'}
                </span>
              </div>
              <div style="font-size: 1.8rem; font-weight: 800; color: ${m.VAC >= 0 ? '#10b981' : '#f87171'}; font-family: monospace;">
                ${m.VAC > 0 ? '+' : ''}${App.formatNumber(m.VAC)} <small style="font-size: 0.85rem; color: var(--gold-light);">${d.currency}</small>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 4px;">
                ${m.VAC >= 0 ? 'وفر مالي محقق لصالح الشركة عند الإغلاق' : 'خسارة أو عجز مالي محتمل إذا استمر الأداء الحالي'}
              </span>
            </div>

          </div>

          <!-- تفاصيل المؤشرات الإضافية: ETC و TCPI و CV و SV -->
          <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid var(--border-light); border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <h5 style="color: var(--gold-light); margin: 0 0 12px 0; font-size: 0.95rem;">🔍 مؤشرات الكفاءة التشغيلية التكميلية</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px;">
              <div>
                <span style="font-size: 0.75rem; color: var(--text-secondary); display: block;">ETC (التكلفة المتبقية للإكمال):</span>
                <strong style="font-family: monospace; font-size: 1.1rem; color: #fff;">${App.formatNumber(m.ETC)} ${d.currency}</strong>
              </div>
              <div>
                <span style="font-size: 0.75rem; color: var(--text-secondary); display: block;">CV (انحراف التكلفة اللحظي):</span>
                <strong style="font-family: monospace; font-size: 1.1rem; color: ${m.CV >= 0 ? '#10b981' : '#f87171'};">${m.CV > 0 ? '+' : ''}${App.formatNumber(m.CV)} ${d.currency}</strong>
              </div>
              <div>
                <span style="font-size: 0.75rem; color: var(--text-secondary); display: block;">SV (انحراف الجدول الزمني):</span>
                <strong style="font-family: monospace; font-size: 1.1rem; color: ${m.SV >= 0 ? '#10b981' : '#f59e0b'};">${m.SV > 0 ? '+' : ''}${App.formatNumber(m.SV)} ${d.currency}</strong>
              </div>
              <div>
                <span style="font-size: 0.75rem; color: var(--text-secondary); display: block;">TCPI (الكفاءة المطلوبة للإكمال):</span>
                <strong style="font-family: monospace; font-size: 1.1rem; color: ${m.TCPI > 1.1 ? '#f87171' : '#10b981'};">${m.TCPI}</strong>
              </div>
            </div>
          </div>

          <!-- جدول اللقطات التاريخية لـ EVM -->
          <div style="margin-top: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h5 style="color: #fff; margin: 0; font-size: 0.95rem;">📜 سجل اللقطات التاريخية لأداء المشروع (EVM Snapshots)</h5>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.captureEVMSnapshot()">+ أخذ لقطة جديدة</button>
            </div>
            <div class="table-responsive">
              <table class="custom-table" style="font-size: 0.85rem;">
                <thead>
                  <tr>
                    <th>تاريخ اللقطة</th>
                    <th>نسبة الإنجاز</th>
                    <th>القيمة المخططة (PV)</th>
                    <th>القيمة المكتسبة (EV)</th>
                    <th>التكلفة الفعلية (AC)</th>
                    <th>مؤشر التكلفة (CPI)</th>
                    <th>مؤشر الجدول (SPI)</th>
                    <th>المتوقع عند الإكمال (EAC)</th>
                  </tr>
                </thead>
                <tbody>
                  ${(d.history || []).length === 0 ? `
                    <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 18px;">لا توجد لقطات تاريخية محفوظة بعد. انقر على "+ أخذ لقطة جديدة" لبدء بناء منحنى الأداء.</td></tr>
                  ` : (d.history || []).map(h => `
                    <tr>
                      <td><span style="font-family: monospace;">${h.status_date || h.snapshot_date || '-'}</span></td>
                      <td><strong>${h.percent_complete ?? h.completion_pct ?? 0}%</strong></td>
                      <td><span style="font-family: monospace;">${App.formatNumber(h.pv || 0)}</span></td>
                      <td><span style="font-family: monospace; color: #10b981;">${App.formatNumber(h.ev || 0)}</span></td>
                      <td><span style="font-family: monospace; color: #f87171;">${App.formatNumber(h.ac || 0)}</span></td>
                      <td><strong style="color: ${h.cpi >= 1 ? '#10b981' : '#f87171'};">${h.cpi || '-'}</strong></td>
                      <td><strong style="color: ${h.spi >= 1 ? '#10b981' : '#f59e0b'};">${h.spi || '-'}</strong></td>
                      <td><span style="font-family: monospace;">${App.formatNumber(h.eac || 0)}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

    } catch (err) {
      if (err.message && err.message.includes('تسجيل الدخول')) {
        this.renderAuthRequired(container, 'مؤشرات القيمة المكتسبة EVM');
        return;
      }
      console.warn('Notice loading EVM:', err);
      container.innerHTML = `
        <div class="panel-card" style="padding: 30px; text-align: center; border: 1px dashed var(--accent-red);">
          <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
          <h4 style="color: var(--accent-red); margin-bottom: 8px;">تعذر تحميل مؤشرات القيمة المكتسبة EVM</h4>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">${err.message}</p>
          <button class="btn btn-secondary" onclick="ProjectControlUI.renderEVM()">إعادة المحاولة</button>
        </div>
      `;
    }
  },

  async captureEVMSnapshot() {
    const pid = this.getProjectId();
    try {
      App.showToast('جاري حفظ لقطة أداء EVM دورية...', 'info');
      const res = await this.fetch(this.apiUrl('evm/snapshot'), { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل حفظ اللقطة');

      App.showToast('تم حفظ لقطة الأداء بنجاح في سجل EVM ✅', 'success');
      this.renderEVM(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },


  // ==========================================================================
  // 4. سجلات الحوكمة: المخاطر 5x5، المطالبات، عدم المطابقة NCR، الاستفسارات RFI
  // ==========================================================================

  async renderRisksAndClaims(projectId) {
    this.currentProjectId = projectId || this.getProjectId();
    const container = document.getElementById('hubPane_risks-claims');
    if (!container) return;

    if (!this.isAuthenticated()) {
      this.renderAuthRequired(container, 'سجلات الحوكمة والمخاطر والمطالبات التعاقدية');
      return;
    }

    if (!this.currentProjectId) {
      this.renderNoProjectSelected(container, 'سجلات المخاطر والمطالبات');
      return;
    }

    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <p style="color: var(--gold-light); font-weight: bold;">جاري تحميل سجلات المخاطر والمطالبات وتقارير NCR وRFI...</p>
      </div>
    `;

    try {
      const res = await this.fetch(this.apiUrl('risks/dashboard'));
      if (res.status === 401) {
        this.renderAuthRequired(container, 'سجلات الحوكمة والمخاطر والمطالبات');
        return;
      }
      const json = await res.json();
      if (!json.success) {
        if (json.authenticated === false || (json.message && json.message.includes('تسجيل الدخول'))) {
          this.renderAuthRequired(container, 'سجلات الحوكمة والمخاطر والمطالبات');
          return;
        }
        throw new Error(json.message || 'فشل جلب سجلات الحوكمة');
      }

      const d = json.data;
      this.cache.risks = d;
      const s = d.summary || {};

      // تحديث عداد التبويب الرئيسي إن وجد
      const badgeEl = document.getElementById('cnt_risks');
      if (badgeEl) badgeEl.innerText = (d.risks?.length || 0) + (d.claims?.length || 0);

      container.innerHTML = `
        <div class="panel-card" style="margin-bottom: 20px;">
          <!-- شريط الرأس -->
          <div class="panel-header" style="flex-wrap: wrap; gap: 14px; border-bottom: 1px solid var(--border-light); padding-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: bold;">
                  🛡️ حوكمة المخاطر والنزاعات التعاقدية
                </span>
                <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light);">
                  المعايير الدولية لإدارة العقود (FIDIC)
                </span>
              </div>
              <h3 class="panel-title" style="margin: 4px 0 0 0; font-size: 1.25rem;">
                🛡️ سجل المخاطر، المطالبات التعاقدية، تقارير عدم المطابقة (NCR)، وطلبات المعلومات (RFI)
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.84rem; margin: 4px 0 0 0;">
                حماية حقوق الشركة عبر التوثيق الاستباقي لكافة النزاعات والتأخيرات الميدانية والعيوب الفنية واستفسارات الاستشاري.
              </p>
            </div>

            <!-- أزرار الإجراءات السريعة -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-primary" onclick="ProjectControlUI.openAddRiskModal()" style="background: linear-gradient(135deg, #b91c1c, #ef4444); border: none; font-weight: bold;">
                <span>+ تسجيل خطر جديد</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.openAddClaimModal()">
                <span>📑 إضافة مطالبة تعاقدية / نزاع</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.openAddNCRModal()">
                <span>🛠️ تقرير عدم مطابقة NCR</span>
              </button>
              <button class="btn btn-secondary" onclick="ProjectControlUI.openAddRFIModal()">
                <span>❓ استفسار فني RFI</span>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.renderRisksAndClaims()" title="تحديث">
                🔄
              </button>
            </div>
          </div>

          <!-- شريط الـ 4 مؤشرات الرقمية للسجلات -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin: 18px 0;">
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">المخاطر المفتوحة والحرجة</span>
              <span class="hub-kpi-value" style="color: #f87171; font-size: 1.6rem;">
                ${s.risk_summary?.critical || 0} <small>حرج</small> / ${s.risk_summary?.total || d.risks?.length || 0}
              </span>
            </div>
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">المطالبات المالية وتمديد الوقت</span>
              <span class="hub-kpi-value" style="color: var(--gold-light); font-size: 1.6rem;">
                ${d.claims?.length || 0} <small>مطالبة</small>
              </span>
            </div>
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">تقارير عدم المطابقة المفتوحة (NCR)</span>
              <span class="hub-kpi-value" style="color: ${(s.ncr_open || 0) > 0 ? '#f59e0b' : '#10b981'}; font-size: 1.6rem;">
                ${s.ncr_open || d.non_conformances?.filter(n => n.status !== 'closed').length || 0} <small>تقرير</small>
              </span>
            </div>
            <div class="hub-kpi-item" style="border-radius: 8px; padding: 14px; background: rgba(15, 23, 42, 0.5); border: 1px solid var(--border-color);">
              <span class="hub-kpi-title">استفسارات RFI بانتظار الرد</span>
              <span class="hub-kpi-value" style="color: ${(s.rfi_pending || 0) > 0 ? '#38bdf8' : '#10b981'}; font-size: 1.6rem;">
                ${s.rfi_pending || d.rfis?.filter(r => r.status === 'open').length || 0} <small>طلب</small>
              </span>
            </div>
          </div>

          <!-- شريط التبويبات الفرعية الأربعة (Subtabs) -->
          <div class="report-tabs-bar" style="margin: 20px 0 16px 0;">
            <button class="report-tab-btn ${this.activeSubTab === 'risks' ? 'active' : ''}" onclick="ProjectControlUI.switchRiskSubTab('risks', this)">
              ⚠️ 1. سجل ومصفوفة المخاطر 5×5 (${d.risks?.length || 0})
            </button>
            <button class="report-tab-btn ${this.activeSubTab === 'claims' ? 'active' : ''}" onclick="ProjectControlUI.switchRiskSubTab('claims', this)">
              📑 2. المطالبات والنزاعات والتأخير (${d.claims?.length || 0})
            </button>
            <button class="report-tab-btn ${this.activeSubTab === 'ncr' ? 'active' : ''}" onclick="ProjectControlUI.switchRiskSubTab('ncr', this)">
              🛠️ 3. تقارير عدم المطابقة NCR (${d.non_conformances?.length || 0})
            </button>
            <button class="report-tab-btn ${this.activeSubTab === 'rfi' ? 'active' : ''}" onclick="ProjectControlUI.switchRiskSubTab('rfi', this)">
              ❓ 4. طلبات المعلومات والاستفسارات RFI (${d.rfis?.length || 0})
            </button>
          </div>

          <!-- حاويات الأقسام الفرعية -->
          <div id="riskSubPane_risks" style="display: ${this.activeSubTab === 'risks' ? 'block' : 'none'};">
            ${this.renderRiskRegisterHTML(d.risks || [])}
          </div>

          <div id="riskSubPane_claims" style="display: ${this.activeSubTab === 'claims' ? 'block' : 'none'};">
            ${this.renderClaimsHTML(d.claims || [])}
          </div>

          <div id="riskSubPane_ncr" style="display: ${this.activeSubTab === 'ncr' ? 'block' : 'none'};">
            ${this.renderNCRHTML(d.non_conformances || [])}
          </div>

          <div id="riskSubPane_rfi" style="display: ${this.activeSubTab === 'rfi' ? 'block' : 'none'};">
            ${this.renderRFIHTML(d.rfis || [])}
          </div>

        </div>
      `;

    } catch (err) {
      if (err.message && err.message.includes('تسجيل الدخول')) {
        this.renderAuthRequired(container, 'سجلات الحوكمة والمخاطر والمطالبات');
        return;
      }
      console.warn('Notice loading Risks and Claims:', err);
      container.innerHTML = `
        <div class="panel-card" style="padding: 30px; text-align: center; border: 1px dashed var(--accent-red);">
          <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
          <h4 style="color: var(--accent-red); margin-bottom: 8px;">تعذر تحميل سجلات المخاطر والمطالبات</h4>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">${err.message}</p>
          <button class="btn btn-secondary" onclick="ProjectControlUI.renderRisksAndClaims()">إعادة المحاولة</button>
        </div>
      `;
    }
  },

  switchRiskSubTab(tab, btn) {
    this.activeSubTab = tab;
    document.querySelectorAll('.report-tabs-bar .report-tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    ['risks', 'claims', 'ncr', 'rfi'].forEach(t => {
      const el = document.getElementById(`riskSubPane_${t}`);
      if (el) el.style.display = t === tab ? 'block' : 'none';
    });
  },

  // قالب HTML لسجل المخاطر مع مصفوفة 5x5
  renderRiskRegisterHTML(risks) {
    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <h4 style="color: #fff; margin: 0; font-size: 1rem;">سجل المخاطر الشامل (Risk Register)</h4>
          <button class="btn btn-primary btn-sm" onclick="ProjectControlUI.openAddRiskModal()">+ إضافة خطر جديد</button>
        </div>

        <div class="table-responsive" style="border: 1px solid var(--border-light); border-radius: 8px;">
          <table class="custom-table" style="font-size: 0.84rem;">
            <thead>
              <tr>
                <th>#</th>
                <th>عنوان الخطر والتصنيف</th>
                <th>الاحتمالية (P)</th>
                <th>التأثير (I)</th>
                <th>الدرجة (P×I)</th>
                <th>التقييم</th>
                <th>الأثر المالي والزمني</th>
                <th>خطة المعالجة والتفادي</th>
                <th>مالك الخطر</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${risks.length === 0 ? `
                <tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 30px;">لم يتم تسجيل أي مخاطر بعد لهذا المشروع. انقر على "+ إضافة خطر جديد" للتوثيق.</td></tr>
              ` : risks.map(r => {
                let badgeBg = 'rgba(16, 185, 129, 0.2)';
                let badgeColor = '#10b981';
                let ratingLabel = 'منخفض';
                if (r.risk_rating === 'critical') {
                  badgeBg = 'rgba(239, 68, 68, 0.25)';
                  badgeColor = '#f87171';
                  ratingLabel = 'حرج 🔴';
                } else if (r.risk_rating === 'high') {
                  badgeBg = 'rgba(249, 115, 22, 0.25)';
                  badgeColor = '#fb923c';
                  ratingLabel = 'مرتفع 🟠';
                } else if (r.risk_rating === 'medium') {
                  badgeBg = 'rgba(245, 158, 11, 0.2)';
                  badgeColor = '#fbbf24';
                  ratingLabel = 'متوسط 🟡';
                }

                return `
                  <tr>
                    <td><span style="font-family: monospace; color: var(--gold-light);">${r.id}</span></td>
                    <td>
                      <strong style="color: #f1f5f9; display: block;">${r.title}</strong>
                      <span style="font-size: 0.75rem; color: var(--text-muted);">${r.category || 'عام'} - ${r.description || ''}</span>
                    </td>
                    <td><span style="font-family: monospace;">${r.probability}/5</span></td>
                    <td><span style="font-family: monospace;">${r.impact}/5</span></td>
                    <td><strong style="font-family: monospace; font-size: 1rem; color: #fff;">${r.risk_score}</strong></td>
                    <td><span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; font-weight: bold;">${ratingLabel}</span></td>
                    <td>
                      <div style="font-size: 0.76rem; color: var(--gold-light); font-family: monospace;">${r.financial_impact ? App.formatNumber(r.financial_impact) + ' ر.ي' : '-'}</div>
                      <div style="font-size: 0.72rem; color: var(--text-muted);">${r.schedule_impact_days ? r.schedule_impact_days + ' يوم تأخير' : ''}</div>
                    </td>
                    <td><span style="font-size: 0.78rem; color: #cbd5e1;">${r.treatment_plan || 'خطة مراقبة دورية'}</span></td>
                    <td><span style="font-size: 0.78rem; color: var(--text-secondary);">${r.owner_name || r.owner_id || '-'}</span></td>
                    <td><span class="badge" style="background: rgba(255,255,255,0.06); font-size: 0.75rem;">${r.status === 'open' ? 'نشط ⚠️' : 'معالج ✅'}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // قالب HTML لسجل المطالبات والنزاعات
  renderClaimsHTML(claims) {
    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <h4 style="color: #fff; margin: 0; font-size: 1rem;">سجل المطالبات والنزاعات والتأخيرات (Claims & Disputes)</h4>
          <button class="btn btn-primary btn-sm" onclick="ProjectControlUI.openAddClaimModal()">+ إضافة مطالبة / نزاع</button>
        </div>

        <div class="table-responsive" style="border: 1px solid var(--border-light); border-radius: 8px;">
          <table class="custom-table" style="font-size: 0.84rem;">
            <thead>
              <tr>
                <th>رقم المطالبة</th>
                <th>نوع المطالبة</th>
                <th>الموضوع والسبب التعاقدي</th>
                <th>التمديد الزمني المطلوب</th>
                <th>المبلغ المالي المطالب به</th>
                <th>السند القانوني / التعاقدي</th>
                <th>الحالة</th>
                <th>تاريخ التقديم</th>
              </tr>
            </thead>
            <tbody>
              ${claims.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">لا توجد مطالبات أو نزاعات مسجلة. انقر على "+ إضافة مطالبة / نزاع" لتوثيق أي تمديد زمني أو تكاليف إضافية.</td></tr>
              ` : claims.map(c => `
                <tr>
                  <td><strong style="color: var(--gold-light); font-family: monospace;">${c.claim_no || `CLM-${c.id}`}</strong></td>
                  <td>
                    <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">
                      ${c.claim_type === 'extension_of_time' ? 'تمديد زمني (EOT)' : (c.claim_type === 'additional_cost' ? 'تكلفة إضافية' : 'نزاع تعاقدي')}
                    </span>
                  </td>
                  <td>
                    <strong style="color: #f1f5f9; display: block;">${c.title}</strong>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${c.justification || ''}</span>
                  </td>
                  <td><span style="font-family: monospace; font-weight: bold; color: ${c.days_requested > 0 ? '#f59e0b' : 'inherit'};">${c.days_requested ? c.days_requested + ' يوم' : '-'}</span></td>
                  <td><span style="font-family: monospace; font-weight: bold; color: ${c.amount_claimed > 0 ? '#10b981' : 'inherit'};">${c.amount_claimed ? App.formatNumber(c.amount_claimed) : '-'}</span></td>
                  <td><span style="font-size: 0.78rem; color: #cbd5e1;">${c.contractual_reference || 'شروط العقد العامة'}</span></td>
                  <td>
                    <span class="badge" style="background: ${c.status === 'approved' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}; color: ${c.status === 'approved' ? '#10b981' : '#f59e0b'};">
                      ${c.status === 'approved' ? 'معتمدة ✅' : (c.status === 'rejected' ? 'مرفوضة ❌' : 'قيد التفاوض ⏳')}
                    </span>
                  </td>
                  <td><span style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">${c.submission_date || c.created_at?.split(' ')[0] || '-'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // قالب HTML لسجل عدم المطابقة NCR
  renderNCRHTML(ncrs) {
    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <h4 style="color: #fff; margin: 0; font-size: 1rem;">سجل تقارير عدم المطابقة الفنية (Non-Conformance Reports - NCR)</h4>
          <button class="btn btn-primary btn-sm" onclick="ProjectControlUI.openAddNCRModal()">+ إصدار تقرير NCR جديد</button>
        </div>

        <div class="table-responsive" style="border: 1px solid var(--border-light); border-radius: 8px;">
          <table class="custom-table" style="font-size: 0.84rem;">
            <thead>
              <tr>
                <th>رقم NCR</th>
                <th>العيب الفني / الملاحظة</th>
                <th>الموقع والبند</th>
                <th>درجة الخطورة</th>
                <th>الإجراء التصحيحي المطلوب</th>
                <th>تاريخ الفحص</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${ncrs.length === 0 ? `
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">لا توجد تقارير عدم مطابقة مفتوحة. الجودة مطابقة للمواصفات ✅</td></tr>
              ` : ncrs.map(n => `
                <tr>
                  <td><strong style="color: #f87171; font-family: monospace;">${n.ncr_no || `NCR-${n.id}`}</strong></td>
                  <td>
                    <strong style="color: #f1f5f9; display: block;">${n.title || n.description}</strong>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${n.description || ''}</span>
                  </td>
                  <td><span style="font-size: 0.78rem; color: var(--text-secondary);">${n.location_details || 'الموقع العام'}</span></td>
                  <td>
                    <span class="badge" style="background: ${n.severity === 'critical' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.2)'}; color: ${n.severity === 'critical' ? '#f87171' : '#fbbf24'};">
                      ${n.severity === 'critical' ? 'جسيم 🔴' : (n.severity === 'moderate' ? 'متوسط 🟡' : 'بسيط 🟢')}
                    </span>
                  </td>
                  <td><span style="font-size: 0.78rem; color: #cbd5e1;">${n.corrective_action || 'إعادة الفحص والإصلاح'}</span></td>
                  <td><span style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">${n.inspection_date || '-'}</span></td>
                  <td>
                    <span class="badge" style="background: ${n.status === 'closed' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${n.status === 'closed' ? '#10b981' : '#f87171'};">
                      ${n.status === 'closed' ? 'مغلق ومصحح ✅' : 'مفتوح بانتظار المعالجة ⚠️'}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // قالب HTML لسجل طلبات المعلومات RFI
  renderRFIHTML(rfis) {
    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <h4 style="color: #fff; margin: 0; font-size: 1rem;">سجل طلبات المعلومات الفنية والاستفسارات (Requests for Information - RFI)</h4>
          <button class="btn btn-primary btn-sm" onclick="ProjectControlUI.openAddRFIModal()">+ إرسال طلب استفسار فني RFI</button>
        </div>

        <div class="table-responsive" style="border: 1px solid var(--border-light); border-radius: 8px;">
          <table class="custom-table" style="font-size: 0.84rem;">
            <thead>
              <tr>
                <th>رقم RFI</th>
                <th>الموضوع والاستفسار الفني</th>
                <th>الجهة الموجه إليها</th>
                <th>الأولوية</th>
                <th>الموعد المطلوب</th>
                <th>الرد والاعتماد الهندسي</th>
                <th>الحالة</th>
                <th style="text-align: center;">إجراء</th>
              </tr>
            </thead>
            <tbody>
              ${rfis.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">لا توجد طلبات استفسارات فنية RFI مسجلة. انقر على "+ إرسال طلب استفسار فني RFI" لتوثيق أي استيضاح.</td></tr>
              ` : rfis.map(r => {
                const isOverdue = r.is_overdue;
                return `
                  <tr>
                    <td><strong style="color: #38bdf8; font-family: monospace;">${r.rfi_no || `RFI-${r.id}`}</strong></td>
                    <td>
                      <strong style="color: #f1f5f9; display: block;">${r.subject}</strong>
                      <span style="font-size: 0.75rem; color: var(--text-muted);">${r.question || ''}</span>
                    </td>
                    <td><span style="font-size: 0.78rem; color: var(--gold-light);">${r.to_party || 'استشاري المشروع'}</span></td>
                    <td>
                      <span class="badge" style="background: ${r.urgency === 'critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)'}; color: ${r.urgency === 'critical' ? '#f87171' : '#38bdf8'};">
                        ${r.urgency === 'critical' ? 'حرج وعاجل ⚡' : 'عادي'}
                      </span>
                    </td>
                    <td>
                      <span style="font-size: 0.78rem; font-family: monospace; color: ${isOverdue ? '#f87171' : '#cbd5e1'};">
                        ${r.required_by_date || '-'}
                        ${isOverdue ? ' (متأخر ⏳)' : ''}
                      </span>
                    </td>
                    <td>
                      <span style="font-size: 0.78rem; color: ${r.response ? '#10b981' : 'var(--text-muted)'};">
                        ${r.response || 'بانتظار الرد الرسمي من الاستشاري...'}
                      </span>
                    </td>
                    <td>
                      <span class="badge" style="background: ${r.status === 'answered' ? 'rgba(16, 185, 129, 0.2)' : (isOverdue ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)')}; color: ${r.status === 'answered' ? '#10b981' : (isOverdue ? '#f87171' : '#f59e0b')};">
                        ${r.status === 'answered' ? 'تم الرد ✅' : (isOverdue ? 'تأخر في الرد ⚠️' : 'قيد المراجعة ⏳')}
                      </span>
                    </td>
                    <td style="text-align: center;">
                      ${r.status !== 'answered' ? `
                        <button class="btn btn-secondary btn-sm" onclick="ProjectControlUI.openReplyRFIModal(${r.id}, '${encodeURIComponent(r.subject)}')" style="padding: 2px 8px; font-size: 0.75rem;">
                          تسجيل الرد
                        </button>
                      ` : '✓'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  openAddRiskModal() { App.openModal('riskModal'); },
  openAddClaimModal() { App.openModal('claimModal'); },
  openAddNCRModal() { App.openModal('ncrModal'); },
  openAddRFIModal() { App.openModal('rfiModal'); },

  openReplyRFIModal(id, subjectEncoded) {
    document.getElementById('rfiReplyId').value = id;
    document.getElementById('rfiReplySubject').innerText = decodeURIComponent(subjectEncoded);
    document.getElementById('rfiReplyText').value = '';
    App.openModal('rfiReplyModal');
  },

  async submitRiskForm(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const payload = {
      title: document.getElementById('riskModalTitle').value.trim(),
      description: document.getElementById('riskModalDesc').value.trim(),
      category: document.getElementById('riskModalCategory').value,
      probability: Number(document.getElementById('riskModalProbability').value),
      impact: Number(document.getElementById('riskModalImpact').value),
      financial_impact: Number(document.getElementById('riskModalFinancial').value) || 0,
      schedule_impact_days: Number(document.getElementById('riskModalSchedule').value) || 0,
      treatment_type: document.getElementById('riskModalTreatment').value,
      treatment_plan: document.getElementById('riskModalPlan').value.trim(),
      review_date: document.getElementById('riskModalReviewDate').value
    };

    if (!payload.title) {
      App.showToast('عنوان الخطر حقل إلزامي', 'error');
      return;
    }

    try {
      App.showToast('جاري تسجيل الخطر وتقييمه...', 'info');
      const res = await this.fetch(this.apiUrl('risks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل تسجيل الخطر');

      App.closeModal('riskModal');
      App.showToast('تم تسجيل الخطر بنجاح في مصفوفة المخاطر 5x5 ✅', 'success');
      this.renderRisksAndClaims(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async submitClaimForm(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const payload = {
      claim_type: document.getElementById('claimModalType').value,
      title: document.getElementById('claimModalTitle').value.trim(),
      days_requested: Number(document.getElementById('claimModalDays').value) || 0,
      amount_claimed: Number(document.getElementById('claimModalAmount').value) || 0,
      contractual_reference: document.getElementById('claimModalRef').value.trim(),
      justification: document.getElementById('claimModalJustification').value.trim()
    };

    if (!payload.title) {
      App.showToast('موضوع المطالبة حقل إلزامي', 'error');
      return;
    }

    try {
      App.showToast('جاري توثيق المطالبة التعاقدية...', 'info');
      const res = await this.fetch(this.apiUrl('claims'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل توثيق المطالبة');

      App.closeModal('claimModal');
      App.showToast('تم تسجيل المطالبة التعاقدية بنجاح 📑', 'success');
      this.activeSubTab = 'claims';
      this.renderRisksAndClaims(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async submitNCRForm(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const payload = {
      title: document.getElementById('ncrModalTitle').value.trim(),
      description: document.getElementById('ncrModalDesc').value.trim(),
      location_details: document.getElementById('ncrModalLocation').value.trim(),
      severity: document.getElementById('ncrModalSeverity').value,
      corrective_action: document.getElementById('ncrModalAction').value.trim(),
      inspection_date: document.getElementById('ncrModalDate').value
    };

    if (!payload.description) {
      App.showToast('وصف المخالفة الفنية حقل إلزامي', 'error');
      return;
    }

    try {
      App.showToast('جاري إصدار تقرير عدم المطابقة NCR...', 'info');
      const res = await this.fetch(this.apiUrl('ncr'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل إصدار التقرير');

      App.closeModal('ncrModal');
      App.showToast('تم إصدار تقرير عدم المطابقة NCR بنجاح 🛠️', 'success');
      this.activeSubTab = 'ncr';
      this.renderRisksAndClaims(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async submitRFIForm(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const payload = {
      subject: document.getElementById('rfiModalSubject').value.trim(),
      question: document.getElementById('rfiModalQuestion').value.trim(),
      to_party: document.getElementById('rfiModalTo').value.trim(),
      urgency: document.getElementById('rfiModalUrgency').value,
      required_by_date: document.getElementById('rfiModalDueDate').value
    };

    if (!payload.subject || !payload.question) {
      App.showToast('الموضوع وتفاصيل الاستفسار حقول إلزامية', 'error');
      return;
    }

    try {
      App.showToast('جاري إرسال طلب المعلومات RFI...', 'info');
      const res = await this.fetch(this.apiUrl('rfi'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل إرسال طلب RFI');

      App.closeModal('rfiModal');
      App.showToast('تم إرسال وتوثيق طلب المعلومات RFI بنجاح ❓', 'success');
      this.activeSubTab = 'rfi';
      this.renderRisksAndClaims(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async submitRFIReply(e) {
    if (e) e.preventDefault();
    const pid = this.getProjectId();
    const rfiId = document.getElementById('rfiReplyId').value;
    const response = document.getElementById('rfiReplyText').value.trim();

    if (!response) {
      App.showToast('نص الرد الرسمي إلزامي', 'error');
      return;
    }

    try {
      App.showToast('جاري تسجيل اعتماد الرد...', 'info');
      const res = await this.fetch(`/api/project-control/${pid}/rfi/${rfiId}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, status: 'answered' })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'فشل تسجيل الرد');

      App.closeModal('rfiReplyModal');
      App.showToast('تم توثيق الرد الهندسي وإغلاق الاستفسار بنجاح ✅', 'success');
      this.activeSubTab = 'rfi';
      this.renderRisksAndClaims(pid);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};

// إتاحة الكائن عالمياً
window.ProjectControlUI = ProjectControlUI;

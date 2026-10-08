/**
 * نظام رواسي عدن للهندسة والمقاولات
 * وحدة تحسين تجربة المستخدم المتقدمة (UI/UX Suite)
 * 1. Shimmer Loading Skeletons
 * 2. Stackable Toast Notifications
 * 3. Semantic Breadcrumbs Navigation
 * 4. Form Draft Auto-Save (sessionStorage)
 * 5. Undo/Redo Manager for Critical Destructive Operations
 * 6. Global Search & Command Palette (Ctrl + K)
 * 7. Reusable Table & List Pagination
 */

(function () {
  'use strict';

  const UI = {
    // ============================================================
    // 1. نظام الإشعارات العائمة متعددة الطبقات (Stackable Toasts)
    // ============================================================
    Toast: {
      container: null,

      initContainer() {
        if (!this.container) {
          this.container = document.getElementById('toastContainer');
          if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toastContainer';
            this.container.setAttribute('aria-live', 'polite');
            document.body.appendChild(this.container);
          }
        }
        return this.container;
      },

      /**
       * إظهار إشعار عائم مع شريط عد تنازلي وزر إجراء اختياري
       * @param {string} message نص الإشعار
       * @param {string} type نوع الإشعار ('info' | 'success' | 'warning' | 'error')
       * @param {object|null} action كائن إجراء اختياري { label: 'تراجع', callback: () => {} }
       * @param {number} duration مدة العرض بالمللي ثانية (افتراضياً 4500)
       */
      show(message, type = 'info', action = null, duration = 4500) {
        const container = this.initContainer();

        const isLight = document.body.classList.contains('light-mode') || 
                        document.documentElement.classList.contains('light-mode') || 
                        localStorage.getItem('rawasi_theme') === 'light' ||
                        (typeof window !== 'undefined' && window.getComputedStyle && 
                         (window.getComputedStyle(document.body).backgroundColor === 'rgb(240, 244, 248)' || 
                          window.getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)'));

        const toast = document.createElement('div');
        toast.className = `toast-card toast-${type} toast-card-${type} ${isLight ? 'toast-light' : ''}`;

        let icon = '🔔';
        if (type === 'success') icon = '✅';
        else if (type === 'error') icon = '⛔';
        else if (type === 'warning') icon = '⚠️';
        else if (type === 'info') icon = 'ℹ️';

        let actionBtnHtml = '';
        if (action && action.label && typeof action.callback === 'function') {
          actionBtnHtml = `<button type="button" class="toast-action-btn" style="${isLight ? 'background:#fef3c7!important;color:#000000!important;border-color:#d97706!important;' : ''}">${action.label}</button>`;
        }

        if (isLight) {
          toast.style.cssText = 'background: #ffffff !important; color: #000000 !important; border: 1px solid rgba(0,0,0,0.15) !important; box-shadow: 0 12px 35px rgba(0,0,0,0.18) !important;';
        }

        const textStyle = isLight ? 'color: #000000 !important; font-weight: 700 !important;' : '';
        const closeStyle = isLight ? 'color: #000000 !important; opacity: 0.8;' : '';

        toast.innerHTML = `
          <div class="toast-main" style="display: flex; align-items: center; gap: 12px; width: 100%;">
            <span class="toast-icon" style="font-size: 1.35rem; line-height: 1; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;">${icon}</span>
            <div class="toast-body" style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
              <div class="toast-text" style="font-size: 0.88rem; line-height: 1.45; word-break: break-word; ${textStyle}">${message}</div>
            </div>
            ${actionBtnHtml}
            <button type="button" class="toast-close" title="إغلاق" aria-label="إغلاق" style="background: none; border: none; font-size: 1.4rem; cursor: pointer; padding: 2px 6px; ${closeStyle}">&times;</button>
          </div>
          <div class="toast-progress-wrap" style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; ${isLight ? 'background: rgba(0,0,0,0.08);' : ''}">
            <div class="toast-progress-bar"></div>
          </div>
        `;

        const progressBar = toast.querySelector('.toast-progress-bar');
        const closeBtn = toast.querySelector('.toast-close');
        const actionBtn = toast.querySelector('.toast-action-btn');

        let isDismissed = false;
        let remainingTime = duration;
        let startTime = Date.now();
        let timeoutId = null;

        const dismiss = () => {
          if (isDismissed) return;
          isDismissed = true;
          if (timeoutId) clearTimeout(timeoutId);
          toast.classList.remove('toast-visible');
          toast.classList.add('toast-exit');
          toast.classList.add('toast-removing');
          setTimeout(() => {
            if (toast.parentElement) toast.remove();
          }, 300);
        };

        const startTimer = (ms) => {
          startTime = Date.now();
          if (progressBar) {
            progressBar.style.transition = `width ${ms}ms linear`;
            progressBar.style.width = '0%';
          }
          timeoutId = setTimeout(dismiss, ms);
        };

        const pauseTimer = () => {
          if (timeoutId) clearTimeout(timeoutId);
          const elapsed = Date.now() - startTime;
          remainingTime = Math.max(0, remainingTime - elapsed);
          if (progressBar) {
            const computedWidth = window.getComputedStyle(progressBar).width;
            progressBar.style.transition = 'none';
            progressBar.style.width = computedWidth;
          }
        };

        const resumeTimer = () => {
          if (remainingTime > 0) {
            startTimer(remainingTime);
          } else {
            dismiss();
          }
        };

        // أحداث التفاعل مع الإشعار
        toast.addEventListener('mouseenter', pauseTimer);
        toast.addEventListener('mouseleave', resumeTimer);

        if (closeBtn) {
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            dismiss();
          };
        }

        if (actionBtn && action && action.callback) {
          actionBtn.onclick = (e) => {
            e.stopPropagation();
            try {
              action.callback();
            } catch (err) {
              console.error('Toast action error:', err);
            }
            dismiss();
          };
        }

        container.prepend(toast);

        // تفعيل الظهور والعد التنازلي
        requestAnimationFrame(() => {
          toast.classList.add('toast-visible');
          if (duration > 0) {
            startTimer(duration);
          }
        });

        return { dismiss };
      },

      success(message, duration = 4500) {
        return this.show(message, 'success', null, duration);
      },
      error(message, duration = 6000) {
        return this.show(message, 'error', null, duration);
      },
      warning(message, duration = 5000) {
        return this.show(message, 'warning', null, duration);
      },
      info(message, duration = 4000) {
        return this.show(message, 'info', null, duration);
      }
    },

    // ============================================================
    // 1.ب إدارة حالات التحميل ومنع النقر المكرر (Loading States)
    // ============================================================
    Loading: {
      set(btn, isLoading, loadingText = 'جاري المعالجة...') {
        const el = typeof btn === 'string' ? document.getElementById(btn) : btn;
        if (!el) return;

        if (isLoading) {
          if (el.dataset.loadingActive === 'true') return;
          el.dataset.loadingActive = 'true';
          el.dataset.originalHtml = el.innerHTML;
          el.disabled = true;
          el.classList.add('btn-loading');
          el.innerHTML = `
            <span class="loading-spinner-inline" style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-left:6px;" aria-hidden="true"></span>
            <span>${loadingText}</span>
          `;
        } else {
          if (el.dataset.originalHtml) {
            el.innerHTML = el.dataset.originalHtml;
            delete el.dataset.originalHtml;
          }
          el.disabled = false;
          el.classList.remove('btn-loading');
          delete el.dataset.loadingActive;
        }
      },

      async wrap(btn, asyncFn, loadingText) {
        this.set(btn, true, loadingText);
        try {
          return await asyncFn();
        } finally {
          this.set(btn, false);
        }
      }
    },

    // ============================================================
    // 2. نظام مسار التنقل الدلالي الذكي (Semantic Breadcrumbs)
    // ============================================================
    Breadcrumbs: {
      barEl: null,

      // خريطة المسارات والأقسام
      routes: {
        dashboard: [
          { icon: '🏠', label: 'الرئيسية' },
          { label: 'لوحة التحكم الرئيسية' }
        ],
        projects: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '🏗️', label: 'إدارة المشاريع الإنشائية' }
        ],
        projectHub: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '🏗️', label: 'المشاريع', nav: 'projects' },
          { icon: '📁', label: 'مركز وثائق ومستندات المشروع' }
        ],
        projectCloseout: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '🏗️', label: 'المشاريع', nav: 'projects' },
          { icon: '🔒', label: 'إغلاق المشروع والتحليلات الختامية (CQRS)' }
        ],
        revenues: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '📥', label: 'سندات القبض (الإيرادات)' }
        ],
        expenses: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '📤', label: 'سندات الصرف (المصروفات)' }
        ],
        custody: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '💼', label: 'إدارة العهد المالية' }
        ],
        journal: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '📖', label: 'القيود اليومية العامة' }
        ],
        chartOfAccounts: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '🌳', label: 'شجرة ودليل الحسابات' }
        ],
        costCenters: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '🎯', label: 'مراكز التكلفة' }
        ],
        currencies: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '💱', label: 'العملات وأسعار الصرف' }
        ],
        clients: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '👥', label: 'الشركاء والجهات' },
          { icon: '🤝', label: 'سجل العملاء' }
        ],
        suppliers: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '👥', label: 'الشركاء والجهات' },
          { icon: '🚚', label: 'سجل الموردين' }
        ],
        cash: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '💰', label: 'الحسابات والمالية' },
          { icon: '🏦', label: 'الصندوق وحركة النقدية' }
        ],
        reports: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '📊', label: 'التقارير المالية والختامية' }
        ],
        inventory: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '📦', label: 'المخازن والمستودعات' }
        ],
        hr: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '👔', label: 'الموارد البشرية والموظفين' }
        ],
        settings: [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { icon: '⚙️', label: 'تهيئة وإعدادات النظام' }
        ]
      },

      subTabLabels: {
        'profit-loss': 'تقرير الأرباح والخسائر',
        'balance-sheet': 'تقرير المركز المالي / الميزانية العمومية',
        'trial-balance': 'ميزان المراجعة',
        'ledger': 'الأستاذ العام',
        'client-statement': 'كشف حساب عميل',
        'supplier-statement': 'كشف حساب مورد',
        'company': 'بيانات الشركة والترويسة',
        'print': 'أنماط الطباعة',
        'users': 'إدارة المستخدمين والصلاحيات',
        'backup': 'النسخ الاحتياطي والاستعادة',
        'employees': 'قائمة الموظفين',
        'payroll': 'مسير الرواتب',
        'attendance': 'سجل الحضور والغياب',
        'leaves': 'سجل الإجازات'
      },

      init() {
        this.barEl = document.getElementById('appBreadcrumbs');
      },

      update(viewId, subTab = null) {
        if (!this.barEl) this.init();
        if (!this.barEl) return;

        let crumbs = this.routes[viewId] ? [...this.routes[viewId]] : [
          { icon: '🏠', label: 'الرئيسية', nav: 'dashboard' },
          { label: viewId }
        ];

        if (subTab && this.subTabLabels[subTab]) {
          crumbs.push({ label: this.subTabLabels[subTab] });
        }

        const html = `
          <ol class="breadcrumbs-list">
            ${crumbs.map((c, idx) => {
              const isLast = idx === crumbs.length - 1;
              const iconHtml = c.icon ? `<span class="breadcrumb-icon">${c.icon}</span>` : '';
              if (isLast) {
                return `
                  <li class="breadcrumb-item active" aria-current="page">
                    ${iconHtml}
                    <span>${c.label}</span>
                  </li>
                `;
              }
              const clickAction = c.nav ? `onclick="App.navigate('${c.nav}')"` : '';
              return `
                <li class="breadcrumb-item">
                  <a href="javascript:void(0)" class="breadcrumb-link" ${clickAction}>
                    ${iconHtml}
                    <span>${c.label}</span>
                  </a>
                  <span class="breadcrumb-sep" aria-hidden="true">‹</span>
                </li>
              `;
            }).join('')}
          </ol>
        `;

        this.barEl.innerHTML = html;
      }
    },

    // ============================================================
    // 3. نظام الحفظ التلقائي للمسودات (Draft Auto-Save)
    // ============================================================
    DraftManager: {
      storageKeyPrefix: 'rawasi_draft_',
      saveTimeout: null,

      // النماذج التي تدعم حفظ المسودات
      supportedForms: [
        'modalReceiptForm',
        'modalExpenseForm',
        'modalCustodyForm',
        'modalJournalForm',
        'newProjectForm',
        'newClientForm',
        'newSupplierForm',
        'quickReceiptForm',
        'quickExpenseForm',
        'quickCustodyForm',
        'newItemForm',
        'hrEmployeeForm'
      ],

      init() {
        document.addEventListener('input', (e) => {
          const form = e.target.closest('form');
          if (form && form.id && (this.supportedForms.includes(form.id) || form.getAttribute('data-autosave') === 'true')) {
            this.queueSave(form);
          }
        });

        document.addEventListener('change', (e) => {
          const form = e.target.closest('form');
          if (form && form.id && (this.supportedForms.includes(form.id) || form.getAttribute('data-autosave') === 'true')) {
            this.queueSave(form);
          }
        });

        // مسح المسودة عند إرسال النموذج بنجاح
        document.addEventListener('submit', (e) => {
          const form = e.target;
          if (form && form.id && (this.supportedForms.includes(form.id) || form.getAttribute('data-autosave') === 'true')) {
            this.clearDraft(form.id);
          }
        });
      },

      queueSave(form) {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
          this.saveDraft(form);
        }, 350);
      },

      saveDraft(form) {
        if (!form || !form.id) return;
        const data = {};
        let hasValue = false;

        const elements = form.querySelectorAll('input, select, textarea');
        elements.forEach(el => {
          // استبعاد كلمات المرور والتوكن والملفات
          if (el.type === 'password' || el.type === 'file' || el.name === '_csrf' || el.id === 'loginCsrfToken') return;
          const key = el.name || el.id;
          if (!key) return;

          if (el.type === 'checkbox') {
            data[key] = el.checked;
          } else if (el.type === 'radio') {
            if (el.checked) data[key] = el.value;
          } else {
            data[key] = el.value;
            if (el.value && el.value.trim().length > 0) hasValue = true;
          }
        });

        if (hasValue) {
          try {
            sessionStorage.setItem(this.storageKeyPrefix + form.id, JSON.stringify({
              timestamp: Date.now(),
              data: data
            }));
          } catch (err) {
            console.warn('Draft save error:', err);
          }
        }
      },

      checkAndPromptDraft(formId) {
        const form = document.getElementById(formId);
        if (!form) return;

        const raw = sessionStorage.getItem(this.storageKeyPrefix + formId);
        if (!raw) {
          this.removeDraftBanner(form);
          return;
        }

        try {
          const { timestamp, data } = JSON.parse(raw);
          if (!data || Object.keys(data).length === 0) return;

          const timeStr = new Date(timestamp).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
          this.showDraftBanner(form, timeStr, data);
        } catch (e) {
          sessionStorage.removeItem(this.storageKeyPrefix + formId);
        }
      },

      showDraftBanner(form, timeStr, data) {
        this.removeDraftBanner(form);

        const banner = document.createElement('div');
        banner.className = 'draft-restore-banner';
        banner.innerHTML = `
          <div class="draft-banner-content">
            <span class="draft-banner-icon">📝</span>
            <span class="draft-banner-text">توجد مسودة محفوظة تلقائياً لهذا النموذج (الساعة ${timeStr}).</span>
          </div>
          <div class="draft-banner-actions">
            <button type="button" class="btn btn-xs btn-primary draft-restore-btn">استعادة المسودة</button>
            <button type="button" class="btn btn-xs btn-secondary draft-discard-btn">تجاهل ومسح</button>
          </div>
        `;

        const restoreBtn = banner.querySelector('.draft-restore-btn');
        const discardBtn = banner.querySelector('.draft-discard-btn');

        restoreBtn.onclick = () => {
          this.applyDataToForm(form, data);
          banner.remove();
          UI.Toast.show('تمت استعادة المسودة السابقة بنجاح 📋', 'success', null, 2500);
        };

        discardBtn.onclick = () => {
          this.clearDraft(form.id);
          banner.remove();
          UI.Toast.show('تم مسح المسودة المؤقتة', 'info', null, 2000);
        };

        form.insertBefore(banner, form.firstChild);
      },

      removeDraftBanner(form) {
        const existing = form.querySelector('.draft-restore-banner');
        if (existing) existing.remove();
      },

      applyDataToForm(form, data) {
        Object.keys(data).forEach(key => {
          const el = form.querySelector(`[name="${key}"], #${key}`);
          if (!el) return;

          if (el.type === 'checkbox') {
            el.checked = !!data[key];
          } else if (el.type === 'radio') {
            if (el.value === data[key]) el.checked = true;
          } else {
            el.value = data[key];
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      },

      clearDraft(formId) {
        try {
          sessionStorage.removeItem(this.storageKeyPrefix + formId);
          const form = document.getElementById(formId);
          if (form) this.removeDraftBanner(form);
        } catch (e) {}
      }
    },

    // ============================================================
    // 4. مدير التراجع للعمليات الحرجة (Undo Manager)
    // ============================================================
    UndoManager: {
      activeOperations: new Map(),

      /**
       * تأجيل تنفيذ الحذف مع إتاحة نافذة زمنية للتراجع
       * @param {object} options
       * @param {string} options.id معرّف العملية الفريد
       * @param {string} options.description نص العملية (مثال: 'تم حذف سند الصرف #PV-102')
       * @param {function} options.onCommit ينفذ عند انتهاء مهلة التراجع لحذف العنصر نهائياً من السيرفر
       * @param {function} options.onUndo ينفذ فوراً إذا ضغط المستخدم على زر التراجع
       * @param {number} options.timeout مهلة التراجع بالمللي ثانية (افتراضياً 6500)
       */
      deferAction({ id, description, onCommit, onUndo, timeout = 6500 }) {
        if (this.activeOperations.has(id)) {
          const prev = this.activeOperations.get(id);
          clearTimeout(prev.timer);
          prev.onCommit();
        }

        let isUndone = false;

        const timer = setTimeout(async () => {
          this.activeOperations.delete(id);
          if (!isUndone && typeof onCommit === 'function') {
            try {
              await onCommit();
            } catch (err) {
              console.error('UndoManager commit error:', err);
              UI.Toast.show('حدث خطأ أثناء تنفيذ الحذف النهائي', 'error');
            }
          }
        }, timeout);

        const toastRef = UI.Toast.show(
          description,
          'warning',
          {
            label: '↩️ تراجع (Undo)',
            callback: () => {
              isUndone = true;
              clearTimeout(timer);
              this.activeOperations.delete(id);
              if (typeof onUndo === 'function') {
                onUndo();
              }
              UI.Toast.show('تم إلغاء العملية واستعادة السجل بنجاح ✅', 'success', null, 3000);
            }
          },
          timeout
        );

        this.activeOperations.set(id, { timer, onCommit, toastRef });
      }
    },

    // ============================================================
    // 5. محرك البحث الشامل وقائمة الأوامر (Global Search / Ctrl + K)
    // ============================================================
    GlobalSearch: {
      modalEl: null,
      inputEl: null,
      resultsEl: null,
      selectedIndex: -1,
      currentResults: [],

      // قائمة الصفحات والأقسام الثابتة
      staticEntries: [
        { title: 'لوحة التحكم الرئيسية', category: 'شاشة رئيسية', icon: '📊', nav: 'dashboard', keywords: 'لوحة القيادة مؤشرات احصائيات' },
        { title: 'إدارة المشاريع الإنشائية', category: 'شاشة رئيسية', icon: '🏗️', nav: 'projects', keywords: 'مشروع مشاريع مقاولات عقود' },
        { title: 'مركز وثائق ومستندات المشروع (16 قسماً)', category: 'شاشة رئيسية', icon: '📁', nav: 'projectHub', keywords: 'مستندات ارشيف مخططات تسليمات' },
        { title: 'سندات القبض (الإيرادات)', category: 'المالية والحسابات', icon: '📥', nav: 'revenues', keywords: 'قبض ايرادات دفعات تحصيل' },
        { title: 'سندات الصرف (المصروفات)', category: 'المالية والحسابات', icon: '📤', nav: 'expenses', keywords: 'صرف مصروفات نفقات فواتير' },
        { title: 'إدارة العهد المالية للموظفين', category: 'المالية والحسابات', icon: '💼', nav: 'custody', keywords: 'عهد تصفية عهدة موظف' },
        { title: 'القيود اليومية العامة', category: 'المالية والحسابات', icon: '📖', nav: 'journal', keywords: 'قيد محاسبي مدين دائن قيود' },
        { title: 'شجرة ودليل الحسابات', category: 'المالية والحسابات', icon: '🌳', nav: 'chartOfAccounts', keywords: 'دليل حساب اصول خصوم' },
        { title: 'مراكز التكلفة', category: 'المالية والحسابات', icon: '🎯', nav: 'costCenters', keywords: 'مراكز تكاليف فرع موقع' },
        { title: 'سجل العملاء', category: 'الجهات والشركاء', icon: '🤝', nav: 'clients', keywords: 'عميل عملاء زبائن كشف حساب' },
        { title: 'سجل الموردين', category: 'الجهات والشركاء', icon: '🚚', nav: 'suppliers', keywords: 'مورد مقاول باطن مشتريات' },
        { title: 'الصندوق وحركة النقدية', category: 'المالية والحسابات', icon: '🏦', nav: 'cash', keywords: 'صندوق خزينة كاش نقد' },
        { title: 'العملات وأسعار الصرف', category: 'المالية والحسابات', icon: '💱', nav: 'currencies', keywords: 'عملة دولار ريال سعودي يمني صرف' },
        { title: 'التقارير المالية والختامية', category: 'تقارير', icon: '📈', nav: 'reports', keywords: 'قائمة الدخل ميزانية عمومية ارباح خسائر' },
        { title: 'المخازن والمستودعات', category: 'المخزون', icon: '📦', nav: 'inventory', keywords: 'مخزن بضاعة اصناف جرد صرف مواد' },
        { title: 'شؤون الموظفين والموارد البشرية', category: 'الموظفين', icon: '👔', nav: 'hr', keywords: 'رواتب موظفين اجازات حضور غياب' },
        { title: 'تهيئة وإعدادات النظام', category: 'إدارة النظام', icon: '⚙️', nav: 'settings', keywords: 'اعدادات مستخدمين صلاحيات نسخ احتياطي' }
      ],

      // إجراءات سريعة لفتح النوافذ
      quickActions: [
        { title: 'مشروع جديد +', category: 'إجراء سريع', icon: '⚡', action: () => Projects.openNewModal(), keywords: 'اضافة مشروع جديد' },
        { title: 'سند قبض جديد +', category: 'إجراء سريع', icon: '⚡', action: () => Accounting.openReceiptModal(), keywords: 'اضافة سند قبض تحصيل' },
        { title: 'سند صرف جديد +', category: 'إجراء سريع', icon: '⚡', action: () => Accounting.openExpenseModal(), keywords: 'اضافة سند صرف نفقة' },
        { title: 'قيد يومي جديد +', category: 'إجراء سريع', icon: '⚡', action: () => Accounting.openJournalModal(), keywords: 'اضافة قيد محاسبي' },
        { title: 'صرف عهدة جديدة +', category: 'إجراء سريع', icon: '⚡', action: () => Accounting.openCustodyModal(), keywords: 'اضافة عهدة موظف' }
      ],

      init() {
        this.modalEl = document.getElementById('globalSearchModal');
        this.inputEl = document.getElementById('globalSearchInput');
        this.resultsEl = document.getElementById('globalSearchResults');

        if (this.inputEl) {
          this.inputEl.addEventListener('input', (e) => {
            this.search(e.target.value);
          });

          this.inputEl.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
          });
        }

        // اختصار لوحة المفاتيح العالمي Ctrl + K أو Cmd + K
        window.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            this.toggle();
          } else if (e.key === 'Escape' && this.isOpen()) {
            this.close();
          }
        });
      },

      isOpen() {
        return this.modalEl && this.modalEl.classList.contains('active');
      },

      toggle() {
        if (this.isOpen()) {
          this.close();
        } else {
          this.open();
        }
      },

      open() {
        if (!this.modalEl) this.init();
        if (this.modalEl) {
          this.modalEl.classList.add('active');
          if (this.inputEl) {
            this.inputEl.value = '';
            setTimeout(() => this.inputEl.focus(), 80);
          }
          this.search('');
        }
      },

      close() {
        if (this.modalEl) {
          this.modalEl.classList.remove('active');
        }
      },

      async search(query) {
        const q = (query || '').trim().toLowerCase();
        let results = [];

        if (!q) {
          // عرض الإجراءات والشاشات الأكثر استخداماً
          results = [
            ...this.quickActions,
            ...this.staticEntries.slice(0, 6)
          ];
        } else {
          // 1. مطابقة الشاشات الثابتة
          const matchedStatic = this.staticEntries.filter(item =>
            item.title.toLowerCase().includes(q) ||
            item.keywords.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q)
          );

          // 2. مطابقة الإجراءات السريعة
          const matchedActions = this.quickActions.filter(item =>
            item.title.toLowerCase().includes(q) ||
            item.keywords.toLowerCase().includes(q)
          );

          results = [...matchedActions, ...matchedStatic];

          // 3. البحث في المشاريع والعملاء المحملة في الذاكرة
          if (window.Projects && Array.isArray(Projects.allProjects)) {
            const matchedProjects = Projects.allProjects
              .filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.code && p.code.toLowerCase().includes(q)) || (p.client_name && p.client_name.toLowerCase().includes(q)))
              .slice(0, 4)
              .map(p => ({
                title: `مشروع: ${p.name}`,
                category: 'المشاريع الإنشائية',
                icon: '🏗️',
                action: () => {
                  App.navigate('projects');
                  if (typeof Projects.viewDetails === 'function') Projects.viewDetails(p.id);
                }
              }));
            results = results.concat(matchedProjects);
          }
        }

        this.currentResults = results;
        this.selectedIndex = results.length > 0 ? 0 : -1;
        this.renderResults();
      },

      renderResults() {
        if (!this.resultsEl) return;

        if (this.currentResults.length === 0) {
          this.resultsEl.innerHTML = `
            <div class="cmd-no-results">
              <span style="font-size: 2rem;">🔍</span>
              <p>لم يتم العثور على أي نتائج مطابقة لكلمة البحث</p>
            </div>
          `;
          return;
        }

        this.resultsEl.innerHTML = this.currentResults.map((item, index) => {
          const isSelected = index === this.selectedIndex;
          return `
            <div class="cmd-result-item ${isSelected ? 'selected' : ''}" data-index="${index}" onclick="UI.GlobalSearch.selectItem(${index})">
              <span class="cmd-item-icon">${item.icon || '📌'}</span>
              <div class="cmd-item-info">
                <span class="cmd-item-title">${item.title}</span>
                <span class="cmd-item-category">${item.category || 'نظام'}</span>
              </div>
              <span class="cmd-item-enter-hint">↵</span>
            </div>
          `;
        }).join('');

        this.scrollToSelected();
      },

      scrollToSelected() {
        if (!this.resultsEl) return;
        const selectedEl = this.resultsEl.querySelector('.cmd-result-item.selected');
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'nearest' });
        }
      },

      handleKeyDown(e) {
        if (this.currentResults.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex + 1) % this.currentResults.length;
          this.renderResults();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex - 1 + this.currentResults.length) % this.currentResults.length;
          this.renderResults();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (this.selectedIndex >= 0 && this.selectedIndex < this.currentResults.length) {
            this.selectItem(this.selectedIndex);
          }
        }
      },

      selectItem(index) {
        const item = this.currentResults[index];
        if (!item) return;

        this.close();

        if (typeof item.action === 'function') {
          item.action();
        } else if (item.nav) {
          App.navigate(item.nav);
        }
      }
    },

    // ============================================================
    // 6. وحدة ترقيم الصفحات العامة (Table Pagination Engine)
    // ============================================================
    Pagination: {
      /**
       * ربط جدول بالترقيم مع أزرار التنقل وحجم الصفحة
       * @param {object} config
       * @param {string} config.containerId معرّف حاوية شريط الترقيم
       * @param {Array} config.data مصفوفة البيانات الكاملة
       * @param {number} config.pageSize حجم الصفحة الافتراضي
       * @param {function} config.onPageChange دالة تستدعى عند تبديل الصفحة أو الحجم مع عناصر الصفحة الحالية
       */
      create({ containerId, data = [], pageSize = 15, onPageChange }) {
        let currentPage = 1;
        let perPage = pageSize;
        const container = document.getElementById(containerId);
        if (!container) return;

        const render = () => {
          const totalRecords = data.length;
          const totalPages = Math.max(1, Math.ceil(totalRecords / perPage));
          if (currentPage > totalPages) currentPage = totalPages;

          const startIndex = (currentPage - 1) * perPage;
          const endIndex = Math.min(startIndex + perPage, totalRecords);
          const pageData = data.slice(startIndex, endIndex);

          // استدعاء دالة رسم محتوى الصفحة
          if (typeof onPageChange === 'function') {
            onPageChange(pageData, {
              currentPage,
              totalPages,
              totalRecords,
              startIndex,
              endIndex
            });
          }

          if (totalRecords === 0) {
            container.innerHTML = '';
            return;
          }

          // توليد أزرار الصفحات
          let pageBtnsHtml = '';
          const maxVisiblePages = 5;
          let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
          let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

          if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
          }

          if (startPage > 1) {
            pageBtnsHtml += `<button type="button" class="pagination-btn" data-page="1">1</button>`;
            if (startPage > 2) {
              pageBtnsHtml += `<span class="pagination-ellipsis">...</span>`;
            }
          }

          for (let p = startPage; p <= endPage; p++) {
            pageBtnsHtml += `
              <button type="button" class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">
                ${p}
              </button>
            `;
          }

          if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
              pageBtnsHtml += `<span class="pagination-ellipsis">...</span>`;
            }
            pageBtnsHtml += `<button type="button" class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
          }

          container.innerHTML = `
            <div class="pagination-bar">
              <div class="pagination-info">
                عرض <strong style="color: var(--gold-light);">${totalRecords > 0 ? startIndex + 1 : 0}</strong> إلى 
                <strong style="color: var(--gold-light);">${endIndex}</strong> من إجمالي 
                <strong style="color: var(--gold-light);">${totalRecords}</strong> سجل
              </div>

              <div class="pagination-controls">
                <button type="button" class="pagination-btn prev-btn" ${currentPage <= 1 ? 'disabled' : ''} title="الصفحة السابقة">
                  ›
                </button>
                ${pageBtnsHtml}
                <button type="button" class="pagination-btn next-btn" ${currentPage >= totalPages ? 'disabled' : ''} title="الصفحة التالية">
                  ‹
                </button>
              </div>

              <div class="pagination-size-wrap">
                <label for="${containerId}_pageSize">لكل صفحة:</label>
                <select id="${containerId}_pageSize" class="pagination-size-select">
                  <option value="10" ${perPage === 10 ? 'selected' : ''}>10</option>
                  <option value="15" ${perPage === 15 ? 'selected' : ''}>15</option>
                  <option value="25" ${perPage === 25 ? 'selected' : ''}>25</option>
                  <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
                  <option value="100" ${perPage === 100 ? 'selected' : ''}>100</option>
                </select>
              </div>
            </div>
          `;

          // ربط الأحداث
          const prevBtn = container.querySelector('.prev-btn');
          if (prevBtn) {
            prevBtn.onclick = () => {
              if (currentPage > 1) {
                currentPage--;
                render();
              }
            };
          }

          const nextBtn = container.querySelector('.next-btn');
          if (nextBtn) {
            nextBtn.onclick = () => {
              if (currentPage < totalPages) {
                currentPage++;
                render();
              }
            };
          }

          container.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
            btn.onclick = () => {
              currentPage = Number(btn.getAttribute('data-page'));
              render();
            };
          });

          const sizeSelect = container.querySelector('.pagination-size-select');
          if (sizeSelect) {
            sizeSelect.onchange = (e) => {
              perPage = Number(e.target.value);
              currentPage = 1;
              render();
            };
          }
        };

        render();

        return {
          updateData(newData) {
            data = newData;
            currentPage = 1;
            render();
          }
        };
      }
    },

    // ============================================================
    // 7. تأثيرات ومحاكاة التحميل الهيكلي (Loading Skeletons)
    // ============================================================
    Skeleton: {
      /**
       * ملء جدول بأسطر Shimmer Skeleton أثناء تحميل البيانات
       * @param {HTMLElement|string} tbody عنصر أو معرّف جسم الجدول
       * @param {number} rowCount عدد الأسطر
       * @param {number} colCount عدد الأعمدة
       */
      showTableSkeleton(tbody, rowCount = 5, colCount = 8) {
        const target = typeof tbody === 'string' ? document.getElementById(tbody) : tbody;
        if (!target) return;

        let rowsHtml = '';
        for (let i = 0; i < rowCount; i++) {
          let colsHtml = '';
          for (let j = 0; j < colCount; j++) {
            const width = 45 + Math.floor(Math.random() * 45);
            colsHtml += `
              <td>
                <div class="skeleton skeleton-text" style="width: ${width}%; height: 16px; margin: 4px auto;"></div>
              </td>
            `;
          }
          rowsHtml += `<tr class="skeleton-row">${colsHtml}</tr>`;
        }

        target.innerHTML = rowsHtml;
      },

      /**
       * ملء حاوية بطاقات ببطاقات Shimmer Skeleton
       * @param {HTMLElement|string} container
       * @param {number} count
       */
      showCardSkeleton(container, count = 4) {
        const target = typeof container === 'string' ? document.getElementById(container) : container;
        if (!target) return;

        let cardsHtml = '';
        for (let i = 0; i < count; i++) {
          cardsHtml += `
            <div class="skeleton-card" style="padding: 20px; border-radius: var(--radius-md); background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.06);">
              <div class="skeleton skeleton-text" style="width: 40%; height: 18px; margin-bottom: 12px;"></div>
              <div class="skeleton skeleton-text" style="width: 75%; height: 26px; margin-bottom: 8px;"></div>
              <div class="skeleton skeleton-text" style="width: 55%; height: 14px;"></div>
            </div>
          `;
        }
        target.innerHTML = cardsHtml;
      }
    },

    // ============================================================
    // 8. محرك الرسوم البيانية المتخصص عالي الأداء (Specialized Chart Engine)
    // ============================================================
    Chart: {
      tooltipEl: null,

      initTooltip() {
        if (!this.tooltipEl) {
          this.tooltipEl = document.getElementById('chartTooltip');
          if (!this.tooltipEl) {
            this.tooltipEl = document.createElement('div');
            this.tooltipEl.id = 'chartTooltip';
            this.tooltipEl.className = 'chart-tooltip';
            this.tooltipEl.style.display = 'none';
            document.body.appendChild(this.tooltipEl);
          }
        }
        return this.tooltipEl;
      },

      showTooltip(x, y, html) {
        const tt = this.initTooltip();
        tt.innerHTML = html;
        tt.style.display = 'block';

        const ttWidth = tt.offsetWidth || 160;
        const ttHeight = tt.offsetHeight || 60;
        let left = x + 15;
        let top = y - ttHeight / 2;

        if (left + ttWidth > window.innerWidth - 15) {
          left = x - ttWidth - 15;
        }
        if (top < 10) top = 10;

        tt.style.left = `${left}px`;
        tt.style.top = `${top}px`;
      },

      hideTooltip() {
        if (this.tooltipEl) {
          this.tooltipEl.style.display = 'none';
        }
      },

      /**
       * رسم المخطط الدائري (Donut Chart) التفاعلي عالي الدقة مع التلميحات
       */
      Donut(canvasId, options = {}) {
        const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = options.data || [];
        const colors = options.colors || ['#38bdf8', '#f59e0b', '#10b981', '#ef4444', '#a855f7', '#ec4899', '#64748b'];
        const donutRatio = options.donutRatio || 0.58;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || canvas.width || 280;
        const height = rect.height || canvas.height || 220;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        const total = data.reduce((sum, item) => sum + (Number(item.total || item.amount || item.percentage) || 0), 0) || 1;
        const centerX = width * 0.42;
        const centerY = height / 2;
        const outerRadius = Math.min(centerX, centerY) - 14;
        const innerRadius = outerRadius * donutRatio;

        let hoveredIndex = -1;

        const draw = () => {
          ctx.clearRect(0, 0, width, height);

          let startAngle = -0.5 * Math.PI;

          data.forEach((item, index) => {
            const val = Number(item.total || item.amount || item.percentage) || 0;
            const sliceAngle = (val / total) * 2 * Math.PI;
            const endAngle = startAngle + sliceAngle;
            const isHovered = index === hoveredIndex;
            const color = colors[index % colors.length];

            const currentOuter = isHovered ? outerRadius + 6 : outerRadius;
            const currentInner = isHovered ? innerRadius - 2 : innerRadius;

            ctx.beginPath();
            ctx.arc(centerX, centerY, currentOuter, startAngle, endAngle);
            ctx.arc(centerX, centerY, currentInner, endAngle, startAngle, true);
            ctx.closePath();

            ctx.fillStyle = color;
            ctx.fill();

            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = isHovered ? 3 : 2;
            ctx.stroke();

            // حفظ زوايا الشريحة للتفاعل مع الفأرة
            item._startAngle = startAngle;
            item._endAngle = endAngle;

            startAngle = endAngle;
          });

          // نص وسطي يوضح الإجمالي
          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px Cairo, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('الإجمالي', centerX, centerY - 8);

          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 13px Cairo, sans-serif';
          ctx.fillText(App.formatNumber(total), centerX, centerY + 12);
        };

        draw();

        // تحديث وسيلة الإيضاح (Legend)
        const legendContainer = options.legendId ? document.getElementById(options.legendId) : document.getElementById('expensesDonutLegend');
        if (legendContainer) {
          legendContainer.innerHTML = data.map((item, idx) => {
            const val = Number(item.total || item.amount || item.percentage) || 0;
            const pct = item.percentage !== undefined ? item.percentage : Math.round((val / total) * 100);
            return `
              <div class="chart-legend-row" data-index="${idx}" style="display: flex; align-items: center; justify-content: space-between; font-size: 0.76rem; margin-bottom: 5px; cursor: pointer;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="width: 10px; height: 10px; background: ${colors[idx % colors.length]}; border-radius: 3px; display: inline-block;"></span>
                  <span style="color: var(--text-secondary);">${item.type || item.label}</span>
                </div>
                <strong style="color: #f8fafc; font-family: monospace;">${pct}%</strong>
              </div>
            `;
          }).join('');

          legendContainer.querySelectorAll('.chart-legend-row').forEach(row => {
            row.onmouseenter = () => {
              hoveredIndex = Number(row.getAttribute('data-index'));
              draw();
            };
            row.onmouseleave = () => {
              hoveredIndex = -1;
              draw();
            };
          });
        }

        // تفاعل حركة الماوس داخل الـ Canvas
        canvas.onmousemove = (e) => {
          const cRect = canvas.getBoundingClientRect();
          const mx = e.clientX - cRect.left;
          const my = e.clientY - cRect.top;

          const dx = mx - centerX;
          const dy = my - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          let newHover = -1;
          if (dist >= innerRadius - 4 && dist <= outerRadius + 8) {
            let angle = Math.atan2(dy, dx);
            if (angle < -0.5 * Math.PI) angle += 2 * Math.PI;

            for (let i = 0; i < data.length; i++) {
              if (angle >= data[i]._startAngle && angle <= data[i]._endAngle) {
                newHover = i;
                break;
              }
            }
          }

          if (newHover !== hoveredIndex) {
            hoveredIndex = newHover;
            draw();
          }

          if (hoveredIndex >= 0) {
            const item = data[hoveredIndex];
            const val = Number(item.total || item.amount || item.percentage) || 0;
            const pct = item.percentage !== undefined ? item.percentage : Math.round((val / total) * 100);
            UI.Chart.showTooltip(
              e.clientX,
              e.clientY,
              `
                <div style="font-weight: 700; color: var(--gold-light); margin-bottom: 2px;">${item.type || item.label}</div>
                <div style="font-size: 0.78rem; color: #e2e8f0;">المبلغ: <strong>${App.formatNumber(val)}</strong></div>
                <div style="font-size: 0.74rem; color: #94a3b8;">النسبة: <strong>${pct}%</strong></div>
              `
            );
          } else {
            UI.Chart.hideTooltip();
          }
        };

        canvas.onmouseleave = () => {
          hoveredIndex = -1;
          draw();
          UI.Chart.hideTooltip();
        };
      },

      /**
       * رسم المخطط البياني الخطي لمنحنى الاتجاهات التفاعلي (Trend Chart)
       */
      TrendLine(canvasId, options = {}) {
        const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const trendData = options.data || [];

        if (trendData.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || canvas.width || 480;
        const height = rect.height || canvas.height || 230;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        const padding = { top: 25, right: 25, bottom: 35, left: 55 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // احتساب القيمة القصوى تلقائياً بدون أرقام ثابتة
        let maxVal = 0;
        trendData.forEach(d => {
          if (d.income > maxVal) maxVal = d.income;
          if (d.expense > maxVal) maxVal = d.expense;
        });

        // تقريب سقف المحور إلى أقرب وحدة مريحة للعين
        if (maxVal === 0) maxVal = 100000;
        const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
        const factor = maxVal / magnitude;
        let niceFactor = 1;
        if (factor <= 1.5) niceFactor = 2;
        else if (factor <= 3) niceFactor = 4;
        else if (factor <= 6) niceFactor = 8;
        else niceFactor = 10;
        const yMax = niceFactor * magnitude;

        const getX = (idx) => padding.left + (chartW / Math.max(1, trendData.length - 1)) * idx;
        const getY = (val) => padding.top + chartH - (val / yMax) * chartH;

        let activeIndex = -1;

        const draw = () => {
          ctx.clearRect(0, 0, width, height);

          // 1. رسم خطوط الشبكة وقيم المحور الرأسي
          const gridSteps = 4;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
          ctx.lineWidth = 1;

          for (let i = 0; i <= gridSteps; i++) {
            const y = padding.top + (chartH / gridSteps) * i;
            const val = yMax - (yMax / gridSteps) * i;

            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();

            // تسمية المحور
            ctx.fillStyle = '#64748b';
            ctx.font = '10px Cairo, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            let labelText = val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : (val >= 1000 ? `${Math.round(val / 1000)}k` : `${val}`);
            ctx.fillText(labelText, padding.left - 8, y);
          }

          // 2. رسم خطوط الشبكة الرأسية ومحور الأشهر
          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px Cairo, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          trendData.forEach((d, i) => {
            const x = getX(i);
            ctx.fillText(d.month, x, height - padding.bottom + 10);
          });

          // 3. رسم منحنى الإيرادات (أخضر) مع التعبئة المتدرجة
          const drawCurve = (propName, strokeColor, gradStart, gradEnd) => {
            ctx.beginPath();
            trendData.forEach((d, i) => {
              const x = getX(i);
              const y = getY(d[propName] || 0);
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                const prevX = getX(i - 1);
                const prevY = getY(trendData[i - 1][propName] || 0);
                const cpX = (prevX + x) / 2;
                ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
              }
            });

            // تعبئة المنطقة أسفل المنحنى
            const fillPath = new Path2D();
            trendData.forEach((d, i) => {
              const x = getX(i);
              const y = getY(d[propName] || 0);
              if (i === 0) fillPath.moveTo(x, y);
              else {
                const prevX = getX(i - 1);
                const prevY = getY(trendData[i - 1][propName] || 0);
                const cpX = (prevX + x) / 2;
                fillPath.bezierCurveTo(cpX, prevY, cpX, y, x, y);
              }
            });
            fillPath.lineTo(getX(trendData.length - 1), padding.top + chartH);
            fillPath.lineTo(getX(0), padding.top + chartH);
            fillPath.closePath();

            const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
            grad.addColorStop(0, gradStart);
            grad.addColorStop(1, gradEnd);
            ctx.fillStyle = grad;
            ctx.fill(fillPath);

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // رسم النقاط
            trendData.forEach((d, i) => {
              const x = getX(i);
              const y = getY(d[propName] || 0);
              ctx.beginPath();
              ctx.arc(x, y, i === activeIndex ? 5.5 : 3.5, 0, 2 * Math.PI);
              ctx.fillStyle = strokeColor;
              ctx.fill();
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 2;
              ctx.stroke();
            });
          };

          drawCurve('income', '#10b981', 'rgba(16, 185, 129, 0.25)', 'rgba(16, 185, 129, 0.01)');
          drawCurve('expense', '#ef4444', 'rgba(239, 68, 68, 0.20)', 'rgba(239, 68, 68, 0.01)');

          // 4. رسم خط التتبع التفاعلي عند المؤشر
          if (activeIndex >= 0 && activeIndex < trendData.length) {
            const curX = getX(activeIndex);
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(212, 175, 55, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.moveTo(curX, padding.top);
            ctx.lineTo(curX, padding.top + chartH);
            ctx.stroke();
            ctx.restore();
          }
        };

        draw();

        // تفاعل التمرير بالفأرة
        canvas.onmousemove = (e) => {
          const cRect = canvas.getBoundingClientRect();
          const mx = e.clientX - cRect.left;

          // العثور على أقرب شهر لموضع المؤشر
          let closestIdx = -1;
          let minDist = Infinity;

          trendData.forEach((d, i) => {
            const dist = Math.abs(getX(i) - mx);
            if (dist < minDist) {
              minDist = dist;
              closestIdx = i;
            }
          });

          if (closestIdx !== activeIndex) {
            activeIndex = closestIdx;
            draw();
          }

          if (activeIndex >= 0) {
            const d = trendData[activeIndex];
            const net = (d.income || 0) - (d.expense || 0);
            const netColor = net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
            UI.Chart.showTooltip(
              e.clientX,
              e.clientY,
              `
                <div style="font-weight: 800; color: var(--gold-light); margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 3px;">
                  📅 شهر: ${d.month}
                </div>
                <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;">
                  <span style="color: var(--accent-green);">● الإيرادات:</span>
                  <strong style="color: #f8fafc;">${App.formatNumber(d.income || 0)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;">
                  <span style="color: var(--accent-red);">● المصروفات:</span>
                  <strong style="color: #f8fafc;">${App.formatNumber(d.expense || 0)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; gap: 12px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 3px; margin-top: 2px;">
                  <span>صافي الشهر:</span>
                  <strong style="color: ${netColor};">${App.formatNumber(net)}</strong>
                </div>
              `
            );
          }
        };

        canvas.onmouseleave = () => {
          activeIndex = -1;
          draw();
          UI.Chart.hideTooltip();
        };
      }
    },

    // ============================================================
    // 9. محرك التمرير الافتراضي للجداول الضخمة (Virtual Scrolling)
    // ============================================================
    VirtualTable: {
      /**
       * ربط جدول ضخم بمحرك التمرير الافتراضي لتخفيض عدد عناصر الـ DOM
       */
      attach({ tableBodyId, data = [], rowHeight = 46, renderRow, overscan = 5 }) {
        const tbody = document.getElementById(tableBodyId);
        if (!tbody) return null;

        const scrollContainer = tbody.closest('.table-responsive') || tbody.parentElement;
        let isTicking = false;

        const render = () => {
          const totalItems = data.length;
          const containerHeight = scrollContainer.clientHeight || 450;
          const scrollTop = scrollContainer.scrollTop || 0;

          const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
          const endIndex = Math.min(totalItems, Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan);

          const topSpacerHeight = startIndex * rowHeight;
          const bottomSpacerHeight = Math.max(0, (totalItems - endIndex) * rowHeight);

          const visibleItems = data.slice(startIndex, endIndex);

          let rowsHtml = '';
          if (topSpacerHeight > 0) {
            rowsHtml += `<tr class="virtual-spacer" style="height: ${topSpacerHeight}px;"><td colspan="100" style="padding:0; border:none;"></td></tr>`;
          }

          rowsHtml += visibleItems.map((item, idx) => renderRow(item, startIndex + idx)).join('');

          if (bottomSpacerHeight > 0) {
            rowsHtml += `<tr class="virtual-spacer" style="height: ${bottomSpacerHeight}px;"><td colspan="100" style="padding:0; border:none;"></td></tr>`;
          }

          tbody.innerHTML = rowsHtml;
          isTicking = false;
        };

        const onScroll = () => {
          if (!isTicking) {
            window.requestAnimationFrame(render);
            isTicking = true;
          }
        };

        scrollContainer.addEventListener('scroll', onScroll, { passive: true });
        render();

        return {
          updateData(newData) {
            data = newData;
            render();
          },
          destroy() {
            scrollContainer.removeEventListener('scroll', onScroll);
          }
        };
      }
    },

    // ============================================================
    // 10. محرك التحميل الكسول للصور (Lazy Image Loader)
    // ============================================================
    LazyLoader: {
      observer: null,

      init() {
        if ('IntersectionObserver' in window) {
          this.observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                  img.src = img.dataset.src;
                  img.removeAttribute('data-src');
                }
                img.classList.add('img-loaded');
                obs.unobserve(img);
              }
            });
          }, { rootMargin: '120px 0px' });

          this.scanAndObserve();
        } else {
          // Fallback للمتصفحات القديمة
          document.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          });
        }
      },

      scanAndObserve(container = document) {
        if (!this.observer) return;
        const lazyImgs = container.querySelectorAll('img[data-src], img.lazy-img');
        lazyImgs.forEach(img => this.observer.observe(img));
      },

      observe(imgElement) {
        if (this.observer && imgElement) {
          this.observer.observe(imgElement);
        }
      }
    },

    // تهيئة الوحدة الشاملة
    init() {
      this.Toast.initContainer();
      this.Breadcrumbs.init();
      this.DraftManager.init();
      this.GlobalSearch.init();
      this.LazyLoader.init();
    }
  };

  // إتاحة الكائن في النطاق العام
  window.UI = UI;

  // التشغيل التلقائي عند اكتمال تحميل الـ DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => UI.init());
  } else {
    UI.init();
  }
})();

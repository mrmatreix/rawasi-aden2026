/**
 * إدارة المشاريع والعقود ونسب الإنجاز - شركة رواسي عدن
 */

const Projects = {
  list: [],
  allProjects: [],
  filteredList: [],
  currentStatusFilter: 'all',
  currentClientFilter: 'all',

  async init() {
    await this.loadProjects();
  },

  async loadProjects() {
    const tableBodyDashboard = document.getElementById('projectsTableBody');
    const tableBodyFull = document.getElementById('fullProjectsTableBody');
    if (window.UI && UI.Skeleton) {
      if (tableBodyDashboard) UI.Skeleton.showTableSkeleton(tableBodyDashboard, 4, 8);
      if (tableBodyFull) UI.Skeleton.showTableSkeleton(tableBodyFull, 5, 9);
    }

    try {
      const res = await fetch('/api/projects');
      const json = await res.json();
      if (json.success) {
        this.list = json.data || [];
        this.allProjects = json.data || [];
        this.populateClientFilterOptions();
        this.applyFilters();
      }
    } catch (e) {
      console.error('Error loading projects:', e);
    }
  },

  populateClientFilterOptions() {
    const clientSelect = document.getElementById('projFilterClient');
    if (!clientSelect) return;

    const currentVal = clientSelect.value || 'all';
    const clientMap = new Map();

    (this.allProjects || []).forEach(p => {
      if (p.client_id && p.client_name) {
        clientMap.set(String(p.client_id), p.client_name);
      }
    });

    let options = `<option value="all">جميع العملاء (${clientMap.size})</option>`;
    Array.from(clientMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'ar'))
      .forEach(([id, name]) => {
        options += `<option value="${id}">${name}</option>`;
      });

    clientSelect.innerHTML = options;
    if (clientMap.has(currentVal) || currentVal === 'all') {
      clientSelect.value = currentVal;
    }
  },

  applyFilters() {
    const searchInput = document.getElementById('projSearchInput');
    const statusSelect = document.getElementById('projFilterStatus');
    const clientSelect = document.getElementById('projFilterClient');
    const dateFromInput = document.getElementById('projFilterDateFrom');
    const dateToInput = document.getElementById('projFilterDateTo');
    const clearBtn = document.getElementById('projSearchClearBtn');

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const status = statusSelect ? statusSelect.value : (this.currentStatusFilter || 'all');
    const client = clientSelect ? clientSelect.value : 'all';
    const dateFrom = dateFromInput ? dateFromInput.value : '';
    const dateTo = dateToInput ? dateToInput.value : '';

    if (clearBtn) {
      clearBtn.style.display = query ? 'inline-block' : 'none';
    }

    const filtered = (this.allProjects || []).filter(p => {
      // 1. فلتر الحالة
      if (status !== 'all') {
        const pStatus = p.status || 'active';
        if (pStatus !== status) return false;
      }

      // 2. فلتر العميل
      if (client !== 'all') {
        if (String(p.client_id) !== String(client)) return false;
      }

      // 3. فلتر النطاق الزمني
      const pStart = p.start_date || (p.created_at ? p.created_at.substring(0, 10) : '');
      const pEnd = p.end_date || pStart;

      if (dateFrom) {
        // يجب أن يمتد المشروع أو يبدأ في أو بعد تاريخ البداية
        const isValidDate = (pEnd && pEnd >= dateFrom) || (pStart && pStart >= dateFrom);
        if (!isValidDate) return false;
      }

      if (dateTo) {
        // يجب أن يبدأ المشروع في أو قبل تاريخ النهاية
        const isValidDate = (pStart && pStart <= dateTo) || (pEnd && pEnd <= dateTo);
        if (!isValidDate) return false;
      }

      // 4. حقل البحث النصي المتقدم
      if (query) {
        const matchName = p.name && p.name.toLowerCase().includes(query);
        const matchCode = p.code && p.code.toLowerCase().includes(query);
        const matchClient = p.client_name && p.client_name.toLowerCase().includes(query);
        const matchNotes = p.notes && p.notes.toLowerCase().includes(query);
        if (!matchName && !matchCode && !matchClient && !matchNotes) return false;
      }

      return true;
    });

    this.filteredList = filtered;

    // تحديث عدادات النتائج
    const filteredCountEl = document.getElementById('projFilteredCount');
    const totalCountEl = document.getElementById('projTotalCount');
    if (filteredCountEl) filteredCountEl.textContent = App.formatNumber ? App.formatNumber(filtered.length) : filtered.length;
    if (totalCountEl) totalCountEl.textContent = App.formatNumber ? App.formatNumber(this.allProjects.length) : this.allProjects.length;

    // تحديث الجدول المعروض
    this.renderProjectsTable(filtered);
  },

  clearSearchInput() {
    const input = document.getElementById('projSearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.applyFilters();
  },

  onFilterStatusChange(status) {
    this.currentStatusFilter = status;

    // مزامنة التبويبات العلوية
    document.querySelectorAll('#projectsView .report-tab-btn').forEach(btn => btn.classList.remove('active'));
    const matchingTab = document.getElementById('tabBtn_proj_' + status);
    if (matchingTab) {
      matchingTab.classList.add('active');
    }

    this.applyFilters();
  },

  filterStatus(status, clickedBtn) {
    this.currentStatusFilter = status;

    // تحديث التبويب النشط
    const btn = clickedBtn || document.getElementById('tabBtn_proj_' + status) || document.querySelector(`.report-tab-btn[onclick*="'${status}'"]`);
    if (btn) {
      const parent = btn.parentElement;
      if (parent) {
        parent.querySelectorAll('.report-tab-btn').forEach(b => b.classList.remove('active'));
      }
      btn.classList.add('active');
    }

    // مزامنة القائمة المنسدلة
    const statusSelect = document.getElementById('projFilterStatus');
    if (statusSelect) {
      statusSelect.value = status;
    }

    this.applyFilters();
  },

  resetFilters() {
    const searchInput = document.getElementById('projSearchInput');
    const statusSelect = document.getElementById('projFilterStatus');
    const clientSelect = document.getElementById('projFilterClient');
    const dateFromInput = document.getElementById('projFilterDateFrom');
    const dateToInput = document.getElementById('projFilterDateTo');
    const clearBtn = document.getElementById('projSearchClearBtn');

    if (searchInput) searchInput.value = '';
    if (statusSelect) statusSelect.value = 'all';
    if (clientSelect) clientSelect.value = 'all';
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';

    this.currentStatusFilter = 'all';

    // إعادة ضبط التبويبات
    document.querySelectorAll('#projectsView .report-tab-btn').forEach(b => b.classList.remove('active'));
    const allTab = document.getElementById('tabBtn_proj_all');
    if (allTab) allTab.classList.add('active');

    // إعادة ضبط أزرار الفترات السريعة
    document.querySelectorAll('.filter-preset-btn').forEach(b => b.classList.remove('active'));

    this.applyFilters();
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast('تم إلغاء جميع الفلاتر وعرض كافة المشاريع', 'info');
    }
  },

  setDatePreset(preset) {
    const fromInput = document.getElementById('projFilterDateFrom');
    const toInput = document.getElementById('projFilterDateTo');
    if (!fromInput || !toInput) return;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // إزالة التنشيط من جميع أزرار الفترات
    document.querySelectorAll('.filter-preset-btn').forEach(b => b.classList.remove('active'));

    if (preset === 'this_month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      fromInput.value = formatDate(startOfMonth);
      toInput.value = formatDate(endOfMonth);
    } else if (preset === 'last_3_months') {
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      fromInput.value = formatDate(threeMonthsAgo);
      toInput.value = formatDate(now);
    } else if (preset === 'this_year') {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const endOfYear = new Date(now.getFullYear(), 11, 31);
      fromInput.value = formatDate(startOfYear);
      toInput.value = formatDate(endOfYear);
    } else if (preset === 'all') {
      fromInput.value = '';
      toInput.value = '';
    }

    const clickedBtn = document.querySelector(`.filter-preset-btn[onclick*="'${preset}'"]`);
    if (clickedBtn && preset !== 'all') {
      clickedBtn.classList.add('active');
    }

    this.applyFilters();
  },

  renderProjectsTable(projectsToRender = null) {
    const tableBodyDashboard = document.getElementById('projectsTableBody');
    const tableBodyFull = document.getElementById('fullProjectsTableBody');

    if (!tableBodyDashboard && !tableBodyFull) return;

    const data = projectsToRender !== null ? projectsToRender : (this.filteredList || this.list);
    if (data.length === 0) {
      const emptyDashboard = `<tr><td colspan="9" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد مشاريع مسجلة حالياً</td></tr>`;
      const emptyFull = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
            <div style="font-size: 2.2rem; margin-bottom: 8px; opacity: 0.7;">🔍</div>
            <div style="font-weight: 700; font-size: 1rem; margin-bottom: 6px; color: var(--text-primary);">لا توجد مشاريع تطابق معايير الفلترة والبحث المحددة</div>
            <div style="font-size: 0.82rem; margin-bottom: 14px; max-width: 480px; margin-inline: auto;">
              يرجى التحقق من مصطلحات البحث، أو تغيير حالة المشروع أو العميل، أو إعادة ضبط النطاق الزمني.
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="Projects.resetFilters()" style="display: inline-flex; align-items: center; gap: 6px;">
              <span>↺</span><span>إلغاء الفلاتر وعرض كافة المشاريع</span>
            </button>
          </td>
        </tr>
      `;
      if (tableBodyDashboard) tableBodyDashboard.innerHTML = emptyDashboard;
      if (tableBodyFull) tableBodyFull.innerHTML = emptyFull;
      return;
    }

    const getStatusBadge = (s) => {
      if (s === 'under_study') return '<span class="badge badge-info">تحت الدراسة والتسعير</span>';
      if (s === 'completed') return '<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);">مكتمل ومستلم</span>';
      if (s === 'paused') return '<span class="badge" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);">متوقف مؤقتاً</span>';
      return '<span class="badge badge-active">جاري التنفيذ</span>';
    };

    if (tableBodyDashboard) {
      tableBodyDashboard.innerHTML = data.map(p => {
        const progress = p.progress_percentage || 0;
        const curr = p.currency || 'ر.ي';
        return `
          <tr>
            <td>
              <strong>${p.name}</strong>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">${p.code || ''}</div>
            </td>
            <td>${p.client_name || 'عميل مباشر'}</td>
            <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(p.contract_value)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>${App.formatNumber(p.estimated_cost)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: ${p.actual_cost > p.estimated_cost ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight: 600;">
              ${App.formatNumber(p.actual_cost)} <small style="font-size:0.75rem">${curr}</small>
            </td>
            <td style="min-width: 120px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div class="progress-wrap">
                  <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                </div>
                <span class="progress-text">${progress}%</span>
              </div>
            </td>
            <td style="color: var(--accent-blue); font-weight: 600;">${App.formatNumber(p.expected_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(p.actual_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn btn-secondary btn-sm" onclick="Projects.openProgressModal(${p.id})" title="تحديث نسبة الإنجاز والتحكم المالي" style="color: #38bdf8; border-color: #38bdf8; font-size: 0.72rem; padding: 2px 6px;">
                  📈 إنجاز
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.openVariationModal(${p.id})" title="تسجيل أمر تغييري للعقد (V.O)" style="color: var(--gold-light); border-color: var(--gold-light); font-size: 0.72rem; padding: 2px 6px;">
                  📋 VO
                </button>
                <button class="btn btn-secondary btn-sm" onclick="ProjectHub.openProject(${p.id})" title="مركز مستندات المشروع (16 قسم)" style="background: rgba(212,175,55,0.15); color: var(--gold-light); border-color: var(--gold-primary); font-weight: 700;">
                  📁 16 قسم
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.printProjectReport(${p.id})" title="طباعة تقرير المشروع" style="color: var(--gold-light); border-color: var(--gold-primary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.viewDetails(${p.id})" title="عرض التفاصيل">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
                <button class="btn btn-danger btn-sm" onclick="Projects.deleteProject(${p.id})" title="حذف المشروع">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    if (tableBodyFull) {
      tableBodyFull.innerHTML = data.map(p => {
        const progress = p.progress_percentage || 0;
        const curr = p.currency || 'ر.ي';
        const dateDisplay = (p.start_date || p.end_date)
          ? `<span style="font-size: 0.70rem; color: var(--text-secondary); opacity: 0.85;">📅 ${p.start_date || 'غير محدد'} → ${p.end_date || 'مستمر'}</span>`
          : '';

        return `
          <tr>
            <td>
              <strong>${p.name}</strong>
              <div style="font-size: 0.72rem; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
                <span>${p.code || ''}</span>
                ${dateDisplay}
              </div>
            </td>
            <td>${p.client_name || 'عميل مباشر'}</td>
            <td>${getStatusBadge(p.status)}</td>
            <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(p.contract_value)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>${App.formatNumber(p.estimated_cost)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: ${p.actual_cost > p.estimated_cost ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight: 600;">
              ${App.formatNumber(p.actual_cost)} <small style="font-size:0.75rem">${curr}</small>
            </td>
            <td style="min-width: 120px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div class="progress-wrap">
                  <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                </div>
                <span class="progress-text">${progress}%</span>
              </div>
            </td>
            <td style="color: var(--accent-blue); font-weight: 600;">${App.formatNumber(p.expected_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(p.actual_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn btn-secondary btn-sm" onclick="Projects.openProgressModal(${p.id})" title="تحديث نسبة الإنجاز والتحكم المالي" style="color: #38bdf8; border-color: #38bdf8; font-size: 0.72rem; padding: 2px 6px;">
                  📈 إنجاز
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.openVariationModal(${p.id})" title="تسجيل أمر تغييري للعقد (V.O)" style="color: var(--gold-light); border-color: var(--gold-light); font-size: 0.72rem; padding: 2px 6px;">
                  📋 VO
                </button>
                <button class="btn btn-secondary btn-sm" onclick="ProjectHub.openProject(${p.id})" title="مركز مستندات المشروع (16 قسم)" style="background: rgba(212,175,55,0.15); color: var(--gold-light); border-color: var(--gold-primary); font-weight: 700;">
                  📁 16 قسم
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.printProjectReport(${p.id})" title="طباعة تقرير المشروع" style="color: var(--gold-light); border-color: var(--gold-primary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.viewDetails(${p.id})" title="عرض التفاصيل">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
                <button class="btn btn-success btn-sm" onclick="Projects.exportFullProjectPackage(${p.id})" title="تصدير وتفريغ كافة ملفات وبيانات المشروع (إيرادات، مصروفات، نثريات وعهد، موردين، مخازن ومواد، صندوق وبنك) في مجلده الخاص" style="background: linear-gradient(135deg, #059669, #10b981); color: #fff; border: 1px solid #10b981; font-weight: bold; display: inline-flex; align-items: center; gap: 3px;">
                  <span>📦</span><span>تصدير</span>
                </button>
                <button class="btn btn-danger btn-sm" onclick="Projects.deleteProject(${p.id})" title="حذف المشروع">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  },

  openNewModal(preSelectedClientId = null) {
    // ملء قائمة العملاء في نموذج المشروع مع إمكانية التحديد المسبق
    const select = document.getElementById('projClientSelect');
    if (select) {
      fetch('/api/clients').then(r => r.json()).then(res => {
        if (res.success) {
          select.innerHTML = `<option value="">اختر العميل لربطه بالمشروع والعقد...</option>` + 
            res.data.map(c => `<option value="${c.id}" ${preSelectedClientId && String(c.id) === String(preSelectedClientId) ? 'selected' : ''}>${c.name} (${c.company || 'فردي'})</option>`).join('');
          if (preSelectedClientId) {
            select.value = String(preSelectedClientId);
          }
        }
      });
    }
    App.openModal('newProjectModal');
  },

  async submitNewProject(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById('projName');
    const name = nameInput ? nameInput.value.trim() : '';
    const client_id = document.getElementById('projClientSelect')?.value;
    const contract_value = document.getElementById('projContractVal')?.value;
    const currency = document.getElementById('projCurrency')?.value || 'ر.ي';
    const estimated_cost = document.getElementById('projEstimatedCost')?.value || 0;
    const actual_cost = document.getElementById('projActualCost')?.value || 0;
    const progress_percentage = document.getElementById('projProgress')?.value || 0;
    const expected_profit = document.getElementById('projExpectedProfit')?.value || (Number(contract_value || 0) - Number(estimated_cost || 0));
    const actual_profit = document.getElementById('projActualProfit')?.value || (Number(contract_value || 0) - Number(actual_cost || 0));
    const notes = document.getElementById('projNotes')?.value || '';

    if (!name || !contract_value) {
      App.showToast('يرجى كتابة اسم المشروع وقيمة العقد أولاً', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    const form = document.getElementById('newProjectForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'حفظ المشروع';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          client_id,
          contract_value,
          currency,
          estimated_cost,
          actual_cost,
          progress_percentage,
          expected_profit,
          actual_profit,
          notes
        })
      });
      const data = await res.json();

      if (res.ok && data.success && data.id) {
        // إظهار رسالة النجاح المؤكدة من قاعدة البيانات
        const successMsg = data.message || `تم حفظ المشروع (${name}) بنجاح وتأكيده في قاعدة البيانات`;
        App.showToast(successMsg, 'success');
        App.closeModal('newProjectModal');
        if (form) form.reset();

        // تحديث جدول المشاريع ومؤشرات لوحة التحكم والقوائم المنسدلة
        await this.loadProjects();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
          Reports.loadDashboardKPIs();
        }
        if (typeof Accounting !== 'undefined' && Accounting.loadDropdowns) {
          Accounting.loadDropdowns();
        }
      } else {
        App.showToast(data.message || 'فشل في حفظ المشروع في قاعدة البيانات', 'error');
      }
    } catch (err) {
      console.error('Error saving project:', err);
      App.showToast('فشل الاتصال بالخادم أو حفظ المشروع في قاعدة البيانات', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  async viewDetails(id) {
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (data.success) {
        const p = data.data;
        this._currentProjectDetails = p;
        const body = document.getElementById('projectDetailsBody');
        if (body) {
          body.innerHTML = `
            <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="color: var(--gold-light); margin: 0;">${p.name} (${p.code})</h4>
                <button class="btn btn-secondary btn-sm" onclick="Projects.printCurrentProjectDetails()" style="color: var(--gold-light); border-color: var(--gold-primary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                  <span>طباعة التقرير</span>
                </button>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px;">
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0;">
                  العميل: <strong style="color: #fff;">${p.client_name || 'غير محدد'}</strong> ${p.client_phone ? `| هاتف: ${p.client_phone}` : ''}
                </p>
                  <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <button class="btn btn-secondary btn-sm" onclick="Projects.openProgressModal(${p.id})" style="font-size: 0.72rem; padding: 2px 8px; color: #38bdf8; border-color: #38bdf8;">
                      <span>📈 تحديث الإنجاز</span>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="Projects.openVariationModal(${p.id})" style="font-size: 0.72rem; padding: 2px 8px; color: var(--gold-light); border-color: var(--gold-light);">
                      <span>📋 أمر تغييري (VO)</span>
                    </button>
                    ${p.client_id ? `
                      <button class="btn btn-primary btn-sm" onclick="App.openClientChainModal(${p.client_id})" style="font-size: 0.72rem; padding: 2px 8px;">
                        <span>🔗 سلسلة العميل المالية</span>
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="App.navigate('reports'); Reports.switchReportTab('client-statement'); document.getElementById('repClientSelect').value = ${p.client_id}; Reports.fetchFullClientStatement();" style="font-size: 0.72rem; padding: 2px 8px;">
                        <span>كشف الحساب</span>
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="App.openNewClientBillModal(${p.client_id}, null, ${p.id})" style="font-size: 0.72rem; padding: 2px 8px; border-color: var(--gold-light); color: var(--gold-light);">
                        <span>+ مستخلص</span>
                      </button>
                    ` : ''}
                  </div>
              </div>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px;">
                <div><span style="font-size:0.75rem; color:var(--text-secondary)">قيمة العقد:</span> <strong style="color:var(--gold-light)">${App.formatNumber(p.contract_value)} ${p.currency || 'ر.ي'}</strong></div>
                <div><span style="font-size:0.75rem; color:var(--text-secondary)">التكلفة الفعلية:</span> <strong>${App.formatNumber(p.actual_cost)} ${p.currency || 'ر.ي'}</strong></div>
                <div><span style="font-size:0.75rem; color:var(--text-secondary)">نسبة الإنجاز:</span> <strong style="color:var(--accent-green)">${p.progress_percentage}%</strong></div>
              </div>
            </div>

            <h5 style="margin-bottom: 8px; color: #fff;">المصروفات المسجلة على المشروع (${p.expenses?.length || 0}):</h5>
            <div class="table-responsive" style="max-height: 160px; margin-bottom: 16px;">
              <table class="custom-table">
                <thead><tr><th>رقم السند</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  ${(p.expenses && p.expenses.length > 0) ? p.expenses.map(e => `
                    <tr>
                      <td>${e.receipt_no}</td>
                      <td>${e.expense_type}</td>
                      <td style="color:var(--accent-red)">${App.formatNumber(e.amount)}</td>
                      <td>${e.date}</td>
                      <td>${e.notes || '-'}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" style="text-align:center">لا توجد مصروفات مباشرة</td></tr>'}
                </tbody>
              </table>
            </div>

            <h5 style="margin-bottom: 8px; color: #fff;">المستخلصات المعتمدة (${p.bills?.length || 0}):</h5>
            <div class="table-responsive" style="max-height: 160px;">
              <table class="custom-table">
                <thead><tr><th>رقم المستخلص</th><th>المبلغ</th><th>الاستقطاع</th><th>الصافي</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${(p.bills && p.bills.length > 0) ? p.bills.map(b => `
                    <tr>
                      <td>${b.bill_no}</td>
                      <td>${App.formatNumber(b.amount)}</td>
                      <td>${App.formatNumber(b.deduction)}</td>
                      <td style="color:var(--accent-green); font-weight:bold;">${App.formatNumber(b.net_amount)}</td>
                      <td><span class="badge badge-income">${b.status}</span></td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" style="text-align:center">لا توجد مستخلصات</td></tr>'}
                </tbody>
              </table>
            </div>
          `;
          App.openModal('projectDetailsModal');
        }
      }
    } catch (e) {
      App.showToast('تعذر جلب تفاصيل المشروع', 'error');
    }
  },

  printCurrentProjectDetails() {
    if (this._currentProjectDetails) {
      this.generateAndPrintProjectReport(this._currentProjectDetails);
    } else {
      App.showToast('لا توجد بيانات مشروع محددة للطباعة', 'error');
    }
  },

  async printProjectReport(id) {
    try {
      App.showToast('جاري تحضير وتجهيز تقرير المشروع للطباعة...', 'info');
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        this.generateAndPrintProjectReport(data.data);
      } else {
        App.showToast('تعذر جلب بيانات المشروع للطباعة', 'error');
      }
    } catch (e) {
      console.error('Error fetching project report:', e);
      App.showToast('خطأ في الاتصال بالخادم لتحضير التقرير', 'error');
    }
  },

  generateAndPrintProjectReport(p) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      header_style: 'dynamic',
      table_density: 'medium',
      page_margins: 'normal',
      orientation: 'portrait',
      sig_position: 'end',
      show_logo: '1',
      show_stamp: '0',
      show_page_numbers: '1',
      show_print_time: '1',
      sig1: 'مهندس المشروع',
      sig2: 'الإدارة المالية',
      sig3: 'المدير العام',
      border_style: 'classic',
      accent_color: '#d4af37',
      footer_notes: 'تعتبر هذه التقارير والبيانات معتمدة رسمياً من إدارة شركة رواسي عدن للهندسة والمقاولات'
    };

    const curr = p.currency || 'ر.ي';
    const todayDate = new Date().toISOString().split('T')[0];
    const totalExpenses = (p.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalBills = (p.bills || []).reduce((sum, b) => sum + (Number(b.net_amount) || Number(b.amount) || 0), 0);
    const totalPayments = (p.payments || []).reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0);
    const totalActualCost = Number(p.actual_cost) || (totalExpenses + totalBills) || 0;

    const docClass = (typeof Settings !== 'undefined' && Settings.getReportDocClass)
      ? Settings.getReportDocClass(cfg)
      : 'multi-page-report-document border-classic density-medium margins-normal';

    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = (typeof Settings !== 'undefined' && Settings.getCurrentUserName)
      ? Settings.getCurrentUserName()
      : ((typeof Auth !== 'undefined' && Auth.currentUser) ? (Auth.currentUser.full_name || Auth.currentUser.username) : 'علوي محمد باعبيد');

    const headerHtml = (typeof Settings !== 'undefined' && Settings.renderReportHeader)
      ? Settings.renderReportHeader('تقرير حساب وبيانات المشروع', [
          { label: 'كود المشروع', val: p.code || 'PRJ' },
          { label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` },
          { label: 'المستخدم المسجل بالمشروع', val: userName }
        ], cfg)
      : `
        <div class="letterhead-doc-header">
          <div class="letterhead-doc-title-badge">تقرير حساب وبيانات المشروع</div>
          <div class="letterhead-doc-meta">
            <div class="letterhead-doc-meta-item">كود المشروع: <strong>${p.code || 'PRJ'}</strong></div>
            <div class="letterhead-doc-meta-item">تاريخ ووقت الطباعة: <strong>${todayDate} - ${timeStr}</strong></div>
            <div class="letterhead-doc-meta-item">المستخدم المسجل بالمشروع: <strong>${userName}</strong></div>
          </div>
        </div>
      `;

    const sigHtml = (typeof Settings !== 'undefined' && Settings.renderReportSignatures)
      ? Settings.renderReportSignatures(cfg)
      : `
        <div class="letterhead-signatures-row" style="margin-top: 20px;">
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig1 || 'مهندس المشروع'}</div>
            <div class="letterhead-sig-dots">التوقيع: ........................</div>
          </div>
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig2 || 'الإدارة المالية'}</div>
            <div class="letterhead-sig-dots">المحاسب: ........................</div>
          </div>
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig3 || 'المدير العام'}</div>
            <div class="letterhead-sig-dots">الاعتماد: ........................</div>
          </div>
        </div>
      `;

    const footerHtml = (typeof Settings !== 'undefined' && Settings.renderReportFooter)
      ? Settings.renderReportFooter(cfg)
      : (cfg.footer_notes ? `<div style="margin-top: 10px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : '');

    const showKpi = (cfg.proj_show_kpi_cards !== '0' && cfg.proj_show_kpi_cards !== 0 && cfg.proj_show_kpi_cards !== false);
    const showExpenses = (cfg.proj_show_expenses_table !== '0' && cfg.proj_show_expenses_table !== 0 && cfg.proj_show_expenses_table !== false);
    const showBills = (cfg.proj_show_supplier_bills !== '0' && cfg.proj_show_supplier_bills !== 0 && cfg.proj_show_supplier_bills !== false);
    const showPayments = (cfg.proj_show_client_payments !== '0' && cfg.proj_show_client_payments !== 0 && cfg.proj_show_client_payments !== false);

    printArea.innerHTML = `
      <div class="${docClass}">
        ${headerHtml}
        
        <div class="report-content-body">
          <!-- بطاقة معلومات المشروع الأساسية -->
          <table class="official-report-table" style="margin-bottom: 14px;">
            <tr style="background: #f8fafc;">
              <td style="font-weight: 800; width: 18%; background: #f1f5f9; color: #0f2744;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744; width: 32%;">${p.name}</td>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9; color: #0f2744;">العميل / المالك:</td>
              <td style="width: 32%;">${p.client_name || 'عميل مباشر'} ${p.client_phone ? '(' + p.client_phone + ')' : ''}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">حالة المشروع:</td>
              <td>
                <strong style="${p.status === 'completed' ? 'color:#065f46;' : 'color:#1e40af;'}">
                  ${p.status === 'completed' ? 'مكتمل ومسلّم ✅' : 'قيد التنفيذ والعمل ⚙️'}
                </strong>
              </td>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">نسبة الإنجاز:</td>
              <td><strong style="color: #059669;">${p.progress_percentage || 0}%</strong></td>
            </tr>
            <tr style="background: #f8fafc;">
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">تاريخ البدء:</td>
              <td>${p.start_date || 'غير محدد'}</td>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">تاريخ التسليم:</td>
              <td>${p.end_date || 'غير محدد'}</td>
            </tr>
            ${p.notes ? `
            <tr>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">الموقع / الملاحظات:</td>
              <td colspan="3">${p.notes}</td>
            </tr>
            ` : ''}
          </table>

          <!-- المؤشرات المالية والتعاقدية -->
          ${showKpi ? `
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px;">
            <div style="border: 1px solid #d4af37; border-radius: 6px; padding: 8px; text-align: center; background: #fdfaf2;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">قيمة العقد</div>
              <div style="font-weight: 900; font-size: 0.98rem; color: #b8911c;">${App.formatNumber(p.contract_value)} <small>${curr}</small></div>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; text-align: center; background: #f8fafc;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">التكلفة التقديرية</div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #334155;">${App.formatNumber(p.estimated_cost)} <small>${curr}</small></div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 6px; padding: 8px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">التكلفة الفعلية</div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #dc2626;">${App.formatNumber(totalActualCost)} <small>${curr}</small></div>
            </div>
            <div style="border: 1px solid #86efac; border-radius: 6px; padding: 8px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">الربح المحقق</div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #16a34a;">${App.formatNumber(p.actual_profit)} <small>${curr}</small></div>
            </div>
          </div>
          ` : ''}

          <!-- جدول المصروفات المباشرة -->
          ${showExpenses ? `
          <div style="font-weight: 800; color: #0f2744; font-size: 0.88rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            تفاصيل المصروفات المباشرة (${(p.expenses || []).length})
          </div>
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>نوع المصروف</th>
                <th>التاريخ</th>
                <th>البيان</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${(p.expenses && p.expenses.length > 0) ? p.expenses.map(e => `
                <tr>
                  <td><strong>${e.receipt_no || '-'}</strong></td>
                  <td>${e.expense_type || '-'}</td>
                  <td>${e.date || '-'}</td>
                  <td>${e.notes || '-'}</td>
                  <td style="text-align: left; font-weight: bold; color: #dc2626;">${App.formatNumber(e.amount)}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="5" style="text-align: center; color: #888;">لا توجد مصروفات مباشرة مسجلة</td></tr>
              `}
              <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" style="text-align: right;">إجمالي المصروفات المنصرفة:</td>
                <td style="text-align: left; color: #dc2626;">${App.formatNumber(totalExpenses)} ${curr}</td>
              </tr>
            </tbody>
          </table>
          ` : ''}

          <!-- جدول فواتير ومستخلصات الموردين إن وجدت -->
          ${(showBills && p.bills && p.bills.length > 0) ? `
          <div style="font-weight: 800; color: #0f2744; font-size: 0.88rem; margin: 10px 0 4px 0; border-right: 3px solid #2563eb; padding-right: 6px;">
            فواتير ومشتريات الموردين للمشروع (${p.bills.length})
          </div>
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>رقم الفاتورة</th>
                <th>المورد</th>
                <th>التاريخ</th>
                <th>البيان</th>
                <th style="text-align: left;">المبلغ الصافي (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${p.bills.map(b => `
                <tr>
                  <td><strong>${b.bill_number || '-'}</strong></td>
                  <td>${b.supplier_name || '-'}</td>
                  <td>${b.date || '-'}</td>
                  <td>${b.notes || 'فاتورة توريد'}</td>
                  <td style="text-align: left; font-weight: bold; color: #dc2626;">${App.formatNumber(b.net_amount || b.amount)}</td>
                </tr>
              `).join('')}
              <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" style="text-align: right;">إجمالي فواتير الموردين:</td>
                <td style="text-align: left; color: #dc2626;">${App.formatNumber(totalBills)} ${curr}</td>
              </tr>
            </tbody>
          </table>
          ` : ''}

          <!-- جدول المقبوضات والدفعات -->
          ${(showPayments && p.payments && p.payments.length > 0) ? `
          <div style="font-weight: 800; color: #0f2744; font-size: 0.88rem; margin: 10px 0 4px 0; border-right: 3px solid #059669; padding-right: 6px;">
            الدفعات والمقبوضات المستلمة من العميل (${p.payments.length})
          </div>
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>التاريخ</th>
                <th>طريقة الدفع</th>
                <th>البيان</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${p.payments.map(pay => `
                <tr>
                  <td><strong>${pay.receipt_no}</strong></td>
                  <td>${pay.date}</td>
                  <td>${pay.payment_method}</td>
                  <td>${pay.notes || 'دفعة أعمال'}</td>
                  <td style="text-align: left; font-weight: bold; color: #059669;">${App.formatNumber(pay.amount)}</td>
                </tr>
              `).join('')}
              <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" style="text-align: right;">إجمالي المقبوضات:</td>
                <td style="text-align: left; color: #059669;">${App.formatNumber(totalPayments)} ${curr}</td>
              </tr>
            </tbody>
          </table>
          ` : ''}
        </div>

        ${sigHtml}
        ${footerHtml}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`تقرير مشروع ${p.name || p.code || ''}`);
    } else {
      const orig = document.title;
      document.title = `المستخدم المسجل: ${userName} | نظام رواسي عدن - تقرير مشروع ${p.name || p.code || ''}`;
      setTimeout(() => { document.title = orig; }, 2500);
    }
    window.print();
  },

  async exportFullProjectPackage(projectId) {
    if (!projectId) return;
    try {
      App.showToast('جاري تصدير وتجهيز كافة ملفات وبيانات المشروع في مجلده الخاص...', 'info');
      const res = await fetch(`/api/project-files/${projectId}/export-package`, {
        method: 'POST'
      });
      const json = await res.json();
      if (json.success && json.data) {
        App.showToast(`تم تصدير حزمة ملفات المشروع بنجاح (${json.data.filesGenerated} ملف) 📦✨`, 'success');
        
        // رسالة تأكيد للمستخدم مع إمكانية فتح المجلد في ويندوز مباشرة
        const confirmOpen = confirm(
          `تم تصدير وتفريغ ملفات المشروع بنجاح!\n` +
          `• المشروع: ${json.data.projectName}\n` +
          `• عدد الملفات: ${json.data.filesGenerated} ملفاً رسمياً (Excel + HTML + JSON)\n` +
          `• تشمل: الإيرادات، المصروفات، النثريات والعهد، الموردين، المخازن والمواد، الصندوق والبنك، والملف الشامل.\n` +
          `• المسار في ويندوز:\n${json.data.folderPath}\n\n` +
          `هل تريد فتح مجلد المشروع الآن في نظام ويندوز؟`
        );
        
        if (confirmOpen) {
          fetch(`/api/project-files/${projectId}/open-folder`, { method: 'POST' });
        }
      } else {
        App.showToast(json.message || 'تعذر تصدير حزمة ملفات المشروع', 'error');
      }
    } catch (e) {
      console.error('Export project package error:', e);
      App.showToast('خطأ في الاتصال بالخادم أثناء تصدير المشروع', 'error');
    }
  },

  async deleteProject(id) {
    const project = (this.list || []).find(p => p.id === id);
    const projName = project ? project.name : `المشروع رقم ${id}`;

    // إخفاء فوري للعنصر من الذاكرة والجدول لتجربة استخدام فائقة السرعة
    const previousList = [...(this.list || [])];
    this.list = this.list.filter(p => p.id !== id);
    this.renderProjectsTable();

    if (window.UI && UI.UndoManager) {
      UI.UndoManager.deferAction({
        id: `delete_project_${id}`,
        description: `🗑️ تم حذف مشروع "${projName}" مؤقتاً`,
        timeout: 6500,
        onUndo: () => {
          this.list = previousList;
          this.renderProjectsTable();
        },
        onCommit: async () => {
          try {
            const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              Reports.loadDashboardKPIs();
            } else {
              App.showToast('تعذر إتمام حذف المشروع من الخادم', 'error');
              await this.loadProjects();
            }
          } catch (e) {
            App.showToast('خطأ أثناء تنفيذ الحذف', 'error');
            await this.loadProjects();
          }
        }
      });
    } else {
      if (!confirm(`هل أنت متأكد من رغبتك في حذف "${projName}"؟`)) {
        this.list = previousList;
        this.renderProjectsTable();
        return;
      }
      try {
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          App.showToast('تم حذف المشروع بنجاح', 'info');
          if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
            Reports.loadDashboardKPIs();
          }
        }
      } catch (e) {
        App.showToast('خطأ أثناء الحذف', 'error');
        await this.loadProjects();
      }
    }
  },

  // ============================================================================
  // نافذة تحديث نسبة الإنجاز والتحكم المالي الذكي (EV & Progress Modal)
  // ============================================================================
  currentProgressProjectMetrics: null,

  async openProgressModal(projectId) {
    if (!projectId) return;
    const projIdInput = document.getElementById('projProgProjectId');
    if (projIdInput) projIdInput.value = projectId;

    // تصفير الواجهة مبدئياً
    const titleEl = document.getElementById('projProgModalTitle');
    const contractEl = document.getElementById('projProgContractVal');
    const earnedEl = document.getElementById('projProgEarnedVal');
    const actualEl = document.getElementById('projProgActualCost');
    const slider = document.getElementById('projProgSlider');
    const input = document.getElementById('projProgInput');
    const label = document.getElementById('projProgSliderValLabel');
    const notes = document.getElementById('projProgNotes');

    if (notes) notes.value = '';

    App.openModal('projectProgressModal');

    try {
      const res = await fetch(`/api/projects/${projectId}/control-metrics`);
      const json = await res.json();
      if (json.success && json.data) {
        this.currentProgressProjectMetrics = json.data;
        const p = json.data.project || {};
        const f = json.data.financials || {};
        const curr = p.currency || 'ر.ي';

        if (titleEl) titleEl.innerText = `تحديث نسبة إنجاز: ${p.name}`;
        if (contractEl) contractEl.innerText = `${App.formatNumber(f.contract_value)} ${curr}`;
        if (earnedEl) earnedEl.innerText = `${App.formatNumber(f.earned_value)} ${curr}`;
        if (actualEl) actualEl.innerText = `${App.formatNumber(f.actual_cost)} ${curr}`;

        const prog = Number(f.progress_percentage) || 0;
        if (slider) slider.value = prog;
        if (input) input.value = prog;
        if (label) label.innerText = `${prog}%`;

        this.updateProgressHealthAlert(f.earned_value, f.actual_cost);
      }
    } catch (e) {
      console.error('Error fetching project progress control metrics:', e);
    }
  },

  onProgressModalSliderChange(val) {
    const input = document.getElementById('projProgInput');
    if (input) input.value = val;
    this.recalcProgressModalMetrics(parseFloat(val) || 0);
  },

  onProgressModalInputChange(val) {
    const slider = document.getElementById('projProgSlider');
    if (slider) slider.value = val;
    this.recalcProgressModalMetrics(parseFloat(val) || 0);
  },

  recalcProgressModalMetrics(newProg) {
    const label = document.getElementById('projProgSliderValLabel');
    if (label) label.innerText = `${newProg}%`;

    const metrics = this.currentProgressProjectMetrics;
    if (!metrics) return;

    const contractVal = Number(metrics.financials?.contract_value) || 0;
    const actualCost = Number(metrics.financials?.actual_cost) || 0;
    const curr = metrics.project?.currency || 'ر.ي';

    const newEarnedVal = Math.round((contractVal * (newProg / 100)) * 100) / 100;
    const earnedEl = document.getElementById('projProgEarnedVal');
    if (earnedEl) earnedEl.innerText = `${App.formatNumber(newEarnedVal)} ${curr}`;

    this.updateProgressHealthAlert(newEarnedVal, actualCost);
  },

  updateProgressHealthAlert(earnedVal, actualCost) {
    const alertBox = document.getElementById('projProgHealthAlert');
    const alertIcon = document.getElementById('projProgHealthIcon');
    const alertText = document.getElementById('projProgHealthText');
    if (!alertBox || !alertText) return;

    if (actualCost > earnedVal && actualCost > 0) {
      const diff = actualCost - earnedVal;
      const cpi = earnedVal > 0 ? (earnedVal / actualCost).toFixed(2) : '0.00';
      alertBox.style.background = 'rgba(239, 68, 68, 0.12)';
      alertBox.style.border = '1px solid rgba(239, 68, 68, 0.35)';
      if (alertIcon) alertIcon.innerText = '⚠️';
      alertText.innerHTML = `<strong style="color: var(--accent-red)">مؤشر خطر تجاوز التكلفة:</strong> التكلفة الفعلية المنصرفة تتجاوز القيمة المكتسبة بفارق <strong>${App.formatNumber(diff)}</strong> (مؤشر الأداء CPI = ${cpi}).`;
    } else {
      const diff = earnedVal - actualCost;
      const cpi = actualCost > 0 ? (earnedVal / actualCost).toFixed(2) : '1.00';
      alertBox.style.background = 'rgba(16, 185, 129, 0.12)';
      alertBox.style.border = '1px solid rgba(16, 185, 129, 0.35)';
      if (alertIcon) alertIcon.innerText = '✅';
      alertText.innerHTML = `<strong style="color: var(--accent-green)">أداء مالي متزن:</strong> القيمة المكتسبة تغطي التكاليف بوفر قدره <strong>${App.formatNumber(diff)}</strong> (مؤشر الأداء CPI = ${cpi}).`;
    }
  },

  async submitProgressUpdate(e) {
    e.preventDefault();
    const projectId = document.getElementById('projProgProjectId')?.value;
    const newProg = parseFloat(document.getElementById('projProgInput')?.value) || 0;
    const notes = document.getElementById('projProgNotes')?.value || '';

    if (!projectId) {
      App.showToast('تعذر تحديد المشروع المطلوب تحديثه', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress_percentage: newProg,
          notes
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم تحديث نسبة الإنجاز والاعتماد المالي بنجاح 📈', 'success');
        App.closeModal('projectProgressModal');
        await this.loadProjects();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
          Reports.loadDashboardKPIs();
        }
      } else {
        App.showToast(json.message || 'فشل في تحديث نسبة الإنجاز', 'error');
      }
    } catch (err) {
      console.error('Error submitting progress update:', err);
      App.showToast('خطأ أثناء حفظ نسبة الإنجاز', 'error');
    }
  },

  // ============================================================================
  // نافذة تسجيل أمر تغييري للعقد (Variation Order - VO)
  // ============================================================================
  currentVoProject: null,

  async openVariationModal(projectId) {
    if (!projectId) return;
    const project = (this.allProjects || []).find(p => p.id == projectId);
    this.currentVoProject = project;

    const idInput = document.getElementById('projVoProjectId');
    if (idInput) idInput.value = projectId;

    const titleEl = document.getElementById('projVoModalTitle');
    if (titleEl) titleEl.innerText = `تسجيل أمر تغييري (V.O) - ${project ? project.name : ''}`;

    const prevContractEl = document.getElementById('projVoPrevContractVal');
    const newContractEl = document.getElementById('projVoNewContractVal');
    const contractVal = project ? (Number(project.contract_value) || 0) : 0;
    const curr = project?.currency || 'ر.ي';

    if (prevContractEl) prevContractEl.innerText = `${App.formatNumber(contractVal)} ${curr}`;
    if (newContractEl) newContractEl.innerText = `${App.formatNumber(contractVal)} ${curr}`;

    const titleInput = document.getElementById('projVoTitle');
    if (titleInput) titleInput.value = '';

    const typeSelect = document.getElementById('projVoType');
    if (typeSelect) typeSelect.value = 'addition';

    const amtInput = document.getElementById('projVoAmount');
    if (amtInput) amtInput.value = '';

    const daysInput = document.getElementById('projVoDays');
    if (daysInput) daysInput.value = '0';

    const dateInput = document.getElementById('projVoDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    const reasonInput = document.getElementById('projVoReason');
    if (reasonInput) reasonInput.value = '';

    App.openModal('projectVariationModal');
  },

  calcVariationImpact() {
    const project = this.currentVoProject;
    const contractVal = project ? (Number(project.contract_value) || 0) : 0;
    const type = document.getElementById('projVoType')?.value || 'addition';
    const amount = parseFloat(document.getElementById('projVoAmount')?.value) || 0;
    const curr = project?.currency || 'ر.ي';

    let newVal = contractVal;
    if (type === 'addition') {
      newVal = contractVal + amount;
    } else if (type === 'reduction') {
      newVal = Math.max(0, contractVal - amount);
    }

    const newContractEl = document.getElementById('projVoNewContractVal');
    if (newContractEl) {
      newContractEl.innerText = `${App.formatNumber(newVal)} ${curr}`;
    }
  },

  async submitVariationOrder(e) {
    e.preventDefault();
    const projectId = document.getElementById('projVoProjectId')?.value;
    const title = document.getElementById('projVoTitle')?.value?.trim();
    const type = document.getElementById('projVoType')?.value || 'addition';
    const amount = parseFloat(document.getElementById('projVoAmount')?.value) || 0;
    const time_extension_days = parseInt(document.getElementById('projVoDays')?.value) || 0;
    const date = document.getElementById('projVoDate')?.value;
    const reason = document.getElementById('projVoReason')?.value?.trim();

    if (!projectId || !title) {
      App.showToast('يرجى تحديد المشروع وعنوان الأمر التغييري', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/variation-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          type,
          amount,
          time_extension_days,
          date,
          reason
        })
      });

      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم اعتماد وتوثيق الأمر التغييري بنجاح 📋', 'success');
        App.closeModal('projectVariationModal');
        await this.loadProjects();

        // تحديث سلسلة العميل إذا كانت مفتوحة
        if (typeof App !== 'undefined' && App.currentChainClientId) {
          App.openClientChainModal(App.currentChainClientId);
        }
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
          Reports.loadDashboardKPIs();
        }
      } else {
        App.showToast(json.message || 'فشل في حفظ الأمر التغييري', 'error');
      }
    } catch (err) {
      console.error('Error submitting variation order:', err);
      App.showToast('خطأ أثناء حفظ الأمر التغييري', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.Projects = Projects;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Projects;
}

/**
 * js/inventory.js
 * 
 * إدارة المخزون والمواد والمستودعات المتقدمة - شركة رواسي عدن للهندسة والمقاولات
 * يغطي:
 * 1. أرصدة المخزون والمواد والصرف للمشاريع.
 * 2. الجرد الدوري والمفاجئ واعتماد المحاضر والتسويات الرقابية.
 * 3. حجر المواد التالفة وإثبات خسائر التلف.
 * 4. مرتجعات الموقع مع فحص الجودة QC وتخفيض تكلفة المشروع.
 * 5. التحويلات بين المشاريع وتطبيق الرقابة الثنائية Maker-Checker.
 * 6. سجل أحداث المجال المشفر والتحقق من سلامة السلسلة الهاشية.
 */

const Inventory = {
  items: [],
  audits: [],
  quarantines: [],
  siteReturns: [],
  transfers: [],
  events: [],
  activeTab: 'items',
  _warehouses: null,
  _projects: null,

  async init() {
    await this.loadItems();
  },

  async getWarehouses() {
    if (this._warehouses && this._warehouses.length > 0) return this._warehouses;
    try {
      const res = await fetch('/api/material-management/warehouses');
      const json = await res.json();
      if (json.success) this._warehouses = json.data;
    } catch (e) {
      console.warn('Could not fetch warehouses:', e);
    }
    if (!this._warehouses || this._warehouses.length === 0) {
      this._warehouses = [
        { id: 1, name: 'المستودع المركزي الرئيسي - خورمكسر', code: 'WH-MAIN' },
        { id: 2, name: 'مستودع موقع مشروع برج الصالح', code: 'WH-SITE-1' }
      ];
    }
    return this._warehouses;
  },

  async getProjects() {
    if (this._projects && this._projects.length > 0) return this._projects;
    try {
      const res = await fetch('/api/projects');
      const json = await res.json();
      if (json.success) this._projects = json.data;
    } catch (e) {
      console.warn('Could not fetch projects:', e);
    }
    return this._projects || [];
  },

  switchTab(tabKey) {
    this.activeTab = tabKey;
    const tabs = ['items', 'audits', 'quarantine', 'returns', 'transfers', 'events'];
    tabs.forEach(t => {
      const content = document.getElementById(`tabContent-${t}`);
      const btn = document.getElementById(`tabBtn-${t}`);
      if (content) content.style.display = (t === tabKey) ? 'block' : 'none';
      if (btn) {
        if (t === tabKey) {
          btn.className = 'btn btn-sm btn-primary';
        } else {
          btn.className = 'btn btn-sm btn-secondary';
        }
      }
    });

    if (tabKey === 'items') this.loadItems();
    else if (tabKey === 'audits') this.loadAudits();
    else if (tabKey === 'quarantine') this.loadQuarantine();
    else if (tabKey === 'returns') this.loadSiteReturns();
    else if (tabKey === 'transfers') this.loadProjectTransfers();
    else if (tabKey === 'events') this.loadDomainEvents();
  },

  // =========================================================================
  // 1. أرصدة المخزون والمواد
  // =========================================================================

  async loadItems() {
    try {
      const res = await fetch('/api/inventory/items');
      const json = await res.json();
      if (json.success) {
        this.items = json.data;
        this.renderItemsTable();
      }
    } catch (e) {
      console.error('Error loading items:', e);
    }
  },

  renderItemsTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 14px;">لا توجد مواد مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(item => `
      <tr>
        <td><strong>${item.code}</strong></td>
        <td>${item.name}</td>
        <td>${item.category || '-'}</td>
        <td>${item.unit}</td>
        <td style="font-weight: 700; color: ${item.current_quantity <= item.min_quantity ? 'var(--accent-red)' : 'var(--text-primary)'}">
          ${item.current_quantity} ${item.unit}
          ${item.current_quantity <= item.min_quantity ? '<span class="badge badge-expense" style="margin-right: 6px;">نقص مخزون!</span>' : ''}
        </td>
        <td>${App.formatNumber(item.unit_price)} ${item.currency || 'ر.ي'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="Inventory.openIssueModal(${item.id})">
            صرف لمشروع
          </button>
        </td>
      </tr>
    `).join('');
  },

  openNewItemModal() {
    App.openModal('newItemModal');
  },

  async submitNewItem(e) {
    e.preventDefault();
    const name = document.getElementById('itemName').value.trim();
    const category = document.getElementById('itemCategory').value;
    const unit = document.getElementById('itemUnit').value;
    const current_quantity = document.getElementById('itemQty').value;
    const min_quantity = document.getElementById('itemMinQty').value || 10;
    const unit_price = document.getElementById('itemPrice').value || 0;
    const currency = document.getElementById('itemCurrency')?.value || 'ر.ي';

    if (!name || !unit) {
      App.showToast('اسم الصنف ووحدة القياس مطلوبان', 'error');
      return;
    }

    try {
      const res = await fetch('/api/inventory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, unit, current_quantity, min_quantity, unit_price, currency })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تمت إضافة الصنف للمخزن بنجاح', 'success');
        App.closeModal('newItemModal');
        document.getElementById('newItemForm').reset();
        await this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  openIssueModal(itemId) {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    if (Number(item.current_quantity || 0) <= 0) {
      App.showToast(`⚠️ لا يتوفر رصيد حالي للصنف [${item.name}] في المستودع (الرصيد: 0 ${item.unit}). يرجى توريد أو شراء كميات للمخزن أولاً قبل إجراء الصرف.`, 'warning');
      return;
    }

    const select = document.getElementById('issueProjectSelect');
    if (select && typeof Projects !== 'undefined' && Projects.list) {
      select.innerHTML = `<option value="">اختر المشروع...</option>` +
        Projects.list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }

    const boqGroup = document.getElementById('issueBoqGroup');
    if (boqGroup) boqGroup.style.display = 'none';
    const boqSelect = document.getElementById('issueBoqSelect');
    if (boqSelect) boqSelect.innerHTML = '<option value="">صرف عام للمشروع (أو اختر بند BOQ)...</option>';

    document.getElementById('issueItemId').value = item.id;
    document.getElementById('issueItemName').textContent = `${item.name} (المتوفر: ${item.current_quantity} ${item.unit})`;
    document.getElementById('issueUnitLabel').textContent = item.unit;

    const qtyInput = document.getElementById('issueQuantity');
    if (qtyInput) {
      qtyInput.max = item.current_quantity;
      qtyInput.value = '';
    }

    App.openModal('issueMaterialModal');
  },

  async onIssueProjectChange(projectId) {
    const boqGroup = document.getElementById('issueBoqGroup');
    const boqSelect = document.getElementById('issueBoqSelect');
    if (!boqGroup || !boqSelect) return;

    if (!projectId) {
      boqGroup.style.display = 'none';
      boqSelect.innerHTML = '<option value="">صرف عام للمشروع (أو اختر بند BOQ)...</option>';
      return;
    }

    try {
      const res = await fetch(`/api/project-management/${projectId}/boq`);
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        boqSelect.innerHTML = `<option value="">صرف عام للمشروع (أو اختر بند BOQ)...</option>` +
          json.data.map(b => {
            const rem = b.remainingQty !== undefined ? b.remainingQty : (Number(b.contract_qty || 0) - Number(b.executed_qty || 0));
            return `<option value="${b.id}">[${b.item_no || b.id}] ${b.description} (التعاقدي: ${b.contract_qty} ${b.unit} | المتبقي: ${rem})</option>`;
          }).join('');
        boqGroup.style.display = 'block';
      } else {
        boqGroup.style.display = 'none';
        boqSelect.innerHTML = '<option value="">صرف عام للمشروع (لا توجد بنود BOQ مسجلة)</option>';
      }
    } catch (e) {
      console.warn('Could not load BOQ items for project:', e);
      boqGroup.style.display = 'none';
    }
  },

  async submitIssueMaterial(e) {
    e.preventDefault();
    const item_id = document.getElementById('issueItemId').value;
    const project_id = document.getElementById('issueProjectSelect').value;
    const boq_item_id = document.getElementById('issueBoqSelect')?.value || null;
    const quantity = document.getElementById('issueQuantity').value;
    const recipient = document.getElementById('issueRecipient').value;
    const notes = document.getElementById('issueNotes').value;

    const item = this.items.find(i => i.id == item_id);
    if (item && Number(quantity) > Number(item.current_quantity)) {
      App.showToast(`الكمية المطلوبة (${quantity} ${item.unit}) تتجاوز الرصيد المتوفر في المخزن (${item.current_quantity} ${item.unit})`, 'error');
      return;
    }

    if (!item_id || !project_id || !quantity || Number(quantity) <= 0) {
      App.showToast('يرجى تحديد المشروع والكمية المطلوب صرفها', 'error');
      return;
    }

    try {
      const res = await fetch('/api/inventory/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id,
          project_id,
          boq_item_id: boq_item_id ? Number(boq_item_id) : null,
          type: 'out',
          quantity,
          recipient,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        const boqBadge = boq_item_id ? ' [مقيد ببند BOQ 🔗]' : '';
        App.showToast(`تم صرف المادة بنجاح (${data.reference_no})${boqBadge} وإضافتها لتكلفة المشروع`, 'success');
        if (data.boqWarning) {
          App.showToast(data.boqWarning, 'warning');
        }
        App.closeModal('issueMaterialModal');
        document.getElementById('issueMaterialForm').reset();
        await this.loadItems();
        if (typeof Projects !== 'undefined' && Projects.loadProjects) {
          await Projects.loadProjects();
        }
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // =========================================================================
  // 2. الجرد والتسويات الرقابية (Auditing & Reconciliation)
  // =========================================================================

  async loadAudits() {
    const tbody = document.getElementById('auditsTableBody');
    if (!tbody) return;
    try {
      const res = await fetch('/api/material-management/audits');
      const json = await res.json();
      if (json.success) {
        this.audits = json.data;
        this.renderAuditsTable();
      }
    } catch (e) {
      console.error('Error loading audits:', e);
    }
  },

  renderAuditsTable() {
    const tbody = document.getElementById('auditsTableBody');
    if (!tbody) return;

    if (this.audits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 14px;">لا توجد جلسات جرد مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = this.audits.map(a => {
      let statusBadge = `<span class="badge badge-info">قيد العد</span>`;
      if (a.status === 'minutes_sealed') statusBadge = `<span class="badge badge-warning">مختوم رقمياً</span>`;
      else if (a.status === 'reconciled') statusBadge = `<span class="badge badge-success">تمت التسوية وترحيل القيد</span>`;

      const typeLabel = a.audit_type === 'spot_surprise' 
        ? '<span style="color: #e67e22; font-weight: bold;">⚡ مفاجئ</span>' 
        : '<span style="color: #2980b9;">📅 دوري مجدول</span>';

      const netVarianceColor = a.net_variance_amount > 0 ? '#27ae60' : (a.net_variance_amount < 0 ? '#c0392b' : '#7f8c8d');

      return `
        <tr>
          <td><strong>${a.audit_no}</strong></td>
          <td>${a.warehouse_name}</td>
          <td>${typeLabel}</td>
          <td>${statusBadge}</td>
          <td>${a.total_items_audited}</td>
          <td style="color: #27ae60;">+${App.formatNumber(a.total_overage_qty)}</td>
          <td style="color: #c0392b;">-${App.formatNumber(a.total_shortage_qty)}</td>
          <td style="font-weight: bold; color: ${netVarianceColor};">
            ${a.net_variance_amount > 0 ? '+' : ''}${App.formatNumber(a.net_variance_amount)} ر.ي
          </td>
          <td>
            ${a.hash_signature 
              ? `<span title="${a.hash_signature}" style="cursor: pointer; color: #27ae60; font-family: monospace;" onclick="Inventory.verifyAuditMinutes(${a.id})">🔒 ${a.hash_signature.slice(0, 8)}... ✓</span>` 
              : '<span style="color: #95a5a6;">غير مختوم</span>'}
          </td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" onclick="Inventory.viewAuditDetails(${a.id})">عرض / عد</button>
              ${a.status === 'in_progress' ? `
                <button class="btn btn-warning btn-sm" onclick="Inventory.sealAuditMinutesModal(${a.id})">ختم المحضر</button>
              ` : ''}
              ${a.status === 'minutes_sealed' ? `
                <button class="btn btn-primary btn-sm" onclick="Inventory.reconcileAudit(${a.id})">ترحيل التسوية (ACID)</button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async openPeriodicAuditModal() {
    const warehouses = await this.getWarehouses();
    const whOptions = warehouses.map(w => `<option value="${w.id}">${w.name} (${w.code})</option>`).join('');
    
    const content = `
      <form id="periodicAuditForm" onsubmit="Inventory.submitPeriodicAudit(event)">
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المستودع المراد جرده:</label>
          <select id="pAuditWarehouse" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${whOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">رئيس لجنة الجرد / المدقق:</label>
          <input type="text" id="pAuditAuditor" class="form-control" required placeholder="اسم رئيس لجنة الجرد أو المدقق" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">ملاحظات الجرد الدوري:</label>
          <textarea id="pAuditNotes" class="form-control" rows="2" placeholder="ملاحظات توثيق بدء الجرد المجدول" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);"></textarea>
        </div>
        <div style="background: rgba(41, 128, 185, 0.1); border-right: 4px solid #2980b9; padding: 10px; border-radius: 4px; margin-bottom: 16px; font-size: 0.85rem;">
          ℹ️ <strong>ملاحظة رقابية:</strong> سيتم أخذ لقطة فورية (System Snapshot) للأرصدة الدفترية وتثبيت حالة الأصناف كمرجع رقابي غير قابل للتعديل.
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-primary">بدء جلسة الجرد الدوري</button>
        </div>
      </form>
    `;
    App.showDynamicModal('بدء جلسة جرد دوري قياسي للمخزون', content);
  },

  async submitPeriodicAudit(e) {
    e.preventDefault();
    const warehouse_id = Number(document.getElementById('pAuditWarehouse').value);
    const auditor_name = document.getElementById('pAuditAuditor').value.trim();
    const notes = document.getElementById('pAuditNotes').value.trim();

    try {
      const res = await fetch('/api/material-management/audits/periodic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id, auditor_name, notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم إنشاء جلسة الجرد الدوري (${data.data.audit_no}) وأخذ اللقطة بنجاح`, 'success');
        App.closeModal('dynamicAppModal');
        this.switchTab('audits');
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في إنشاء الجرد', 'error');
    }
  },

  async openSpotAuditModal() {
    const warehouses = await this.getWarehouses();
    const whOptions = warehouses.map(w => `<option value="${w.id}">${w.name} (${w.code})</option>`).join('');
    
    const content = `
      <form id="spotAuditForm" onsubmit="Inventory.submitSpotAudit(event)">
        <div style="background: rgba(230, 126, 34, 0.1); border-right: 4px solid #e67e22; padding: 10px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem;">
          ⚡ <strong>جرد مفاجئ وفحص فوري دون إشعار مسبق:</strong> يهدف للتحقق والرقابة الصارمة واكتشاف الفروقات اللحظية.
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المستودع المستهدف:</label>
          <select id="sAuditWarehouse" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${whOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">اسم المدقق الداخلي / المفتش:</label>
          <input type="text" id="sAuditAuditor" class="form-control" required placeholder="اسم المدقق الداخلي" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">سبب أو نطاق الجرد المفاجئ:</label>
          <textarea id="sAuditNotes" class="form-control" rows="2" placeholder="فحص مفاجئ لأرصدة المواد الحرجة" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-primary" style="background: #e67e22; border-color: #d35400;">إطلاق الجرد وتجميد اللقطة</button>
        </div>
      </form>
    `;
    App.showDynamicModal('إطلاق جرد مفاجئ غير معلن (Spot Audit)', content);
  },

  async submitSpotAudit(e) {
    e.preventDefault();
    const warehouse_id = Number(document.getElementById('sAuditWarehouse').value);
    const auditor_name = document.getElementById('sAuditAuditor').value.trim();
    const notes = document.getElementById('sAuditNotes').value.trim();

    try {
      const res = await fetch('/api/material-management/audits/spot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id, auditor_name, notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم إطلاق الجرد المفاجئ (${data.data.audit_no}) فورياً`, 'success');
        App.closeModal('dynamicAppModal');
        this.switchTab('audits');
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في تشغيل الجرد المفاجئ', 'error');
    }
  },

  async viewAuditDetails(auditId) {
    try {
      const res = await fetch(`/api/material-management/audits/${auditId}`);
      const json = await res.json();
      if (!json.success) return App.showToast(json.message, 'error');

      const audit = json.data;
      const itemsHtml = audit.items.map(it => `
        <tr id="audit-row-${it.item_id}">
          <td><strong>${it.item_code}</strong></td>
          <td>${it.item_name}</td>
          <td>${it.unit}</td>
          <td>${it.system_qty}</td>
          <td>
            ${audit.status === 'in_progress' ? `
              <input type="number" step="any" min="0" value="${it.physical_qty || 0}" 
                     class="form-control" style="width: 100px; padding: 4px;"
                     id="phys-qty-${it.item_id}">
            ` : `${it.physical_qty}`}
          </td>
          <td style="font-weight: bold; color: ${it.diff_qty > 0 ? '#27ae60' : (it.diff_qty < 0 ? '#c0392b' : '#7f8c8d')}">
            ${it.diff_qty > 0 ? '+' : ''}${it.diff_qty}
          </td>
          <td>${App.formatNumber(it.unit_cost)} ر.ي</td>
          <td style="font-weight: bold;">${App.formatNumber(it.diff_amount)} ر.ي</td>
        </tr>
      `).join('');

      const modalContent = `
        <div style="max-height: 70vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-bottom: 12px;">
            <div>
              <h3 style="margin: 0;">محضر الجرد: ${audit.audit_no}</h3>
              <p style="margin: 4px 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">
                المستودع: ${audit.warehouse_name} | النوع: ${audit.audit_type} | الحالة: ${audit.status}
              </p>
            </div>
            <div>
              ${audit.status === 'in_progress' ? `
                <button class="btn btn-primary" onclick="Inventory.saveAuditCounts(${audit.id})">💾 حفظ نتائج العد</button>
              ` : ''}
            </div>
          </div>
          <table class="custom-table" style="font-size: 0.9rem;">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الصنف</th>
                <th>الوحدة</th>
                <th>الرصيد الدفتري</th>
                <th>العد الفعلي</th>
                <th>الفارق</th>
                <th>سعر التكلفة</th>
                <th>قيمة الفارق</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>
      `;

      App.showDynamicModal ? App.showDynamicModal('تفاصيل محضر الجرد', modalContent) : alert(`محضر: ${audit.audit_no}`);
    } catch (e) {
      App.showToast('فشل في جلب تفاصيل الجرد', 'error');
    }
  },

  async saveAuditCounts(auditId) {
    try {
      const res = await fetch(`/api/material-management/audits/${auditId}`);
      const json = await res.json();
      if (!json.success) return;

      const counts = json.data.items.map(it => {
        const inp = document.getElementById(`phys-qty-${it.item_id}`);
        return {
          item_id: it.item_id,
          physical_qty: inp ? Number(inp.value) : it.physical_qty,
          condition_status: 'good'
        };
      });

      const postRes = await fetch(`/api/material-management/audits/${auditId}/counts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts })
      });
      const postData = await postRes.json();
      if (postData.success) {
        App.showToast('تم حفظ نتائج العد وحساب الفروقات بنجاح', 'success');
        this.loadAudits();
        this.viewAuditDetails(auditId);
      } else {
        App.showToast(postData.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في حفظ نتائج العد', 'error');
    }
  },

  async sealAuditMinutesModal(auditId) {
    const defaultSig = `SIG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const content = `
      <form id="sealMinutesForm" onsubmit="Inventory.submitSealAudit(event, ${auditId})">
        <div style="background: rgba(39, 174, 96, 0.1); border-right: 4px solid #27ae60; padding: 10px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem;">
          🔒 <strong>الختم الرقمي لمحرر الجرد:</strong> سيتم توليد بصمة تجزئة مشفرة HMAC-SHA256 لمحتويات المحضر، مما يجعله وثيقة قانونية غير قابلة للتلاعب أو التعديل تمهيداً للتسوية المحاسبية.
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">اسم المدقق المعتمد:</label>
          <input type="text" id="sealAuditorName" class="form-control" required placeholder="اسم المدقق القانوني أو رئيس اللجنة" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">التوقيع الرقمي / المعرف المشفر:</label>
          <input type="text" id="sealDigitalSig" class="form-control" required value="${defaultSig}" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); font-family: monospace;">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">ملاحظات الاعتماد والتوصيات:</label>
          <textarea id="sealNotes" class="form-control" rows="2" placeholder="تمت مطابقة نتائج العد الفعلي واعتماد الفروقات" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-success">ختم المحضر تشفيرياً (HMAC-SHA256)</button>
        </div>
      </form>
    `;
    App.showDynamicModal(`ختم واعتماد محضر الجرد #${auditId}`, content);
  },

  async submitSealAudit(e, auditId) {
    e.preventDefault();
    const auditor_name = document.getElementById('sealAuditorName').value.trim();
    const digital_signature = document.getElementById('sealDigitalSig').value.trim();
    const notes = document.getElementById('sealNotes').value.trim();

    try {
      const res = await fetch(`/api/material-management/audits/${auditId}/seal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditor_name, digital_signature, notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم ختم المحضر بالهاش الرقمي: ${data.data.hash_signature.slice(0, 12)}...`, 'success');
        App.closeModal('dynamicAppModal');
        this.loadAudits();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في ختم المحضر', 'error');
    }
  },

  async reconcileAudit(auditId) {
    if (!confirm('هل أنت متأكد من ترحيل تسوية هذا الجرد إلى دفتر الأستاذ العام وتعديل أرصدة المخزون؟ هذه العملية ذرية غير قابلة للإلغاء (ACID).')) return;

    try {
      const res = await fetch(`/api/material-management/audits/${auditId}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت التسوية وترحيل القيد المحاسبي (${data.data.journal_entry_no}) بنجاح`, 'success');
        this.loadAudits();
        this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في تسوية الجرد', 'error');
    }
  },

  async verifyAuditMinutes(auditId) {
    try {
      const res = await fetch(`/api/material-management/audits/${auditId}/verify-minutes`);
      const json = await res.json();
      if (json.success) {
        alert(`${json.data.message}\n\nالهاش المخزن: ${json.data.stored_hash}\nالمدقق: ${json.data.auditor_name}`);
      } else {
        alert(json.message);
      }
    } catch (e) {
      alert('فشل في التحقق الرقمي');
    }
  },

  // =========================================================================
  // 3. حجر المواد التالفة (Quarantine)
  // =========================================================================

  async loadQuarantine() {
    const tbody = document.getElementById('quarantineTableBody');
    if (!tbody) return;
    try {
      const res = await fetch('/api/material-management/quarantine');
      const json = await res.json();
      if (json.success) {
        this.quarantines = json.data;
        this.renderQuarantineTable();
      }
    } catch (e) {
      console.error('Error loading quarantine:', e);
    }
  },

  renderQuarantineTable() {
    const tbody = document.getElementById('quarantineTableBody');
    if (!tbody) return;

    if (this.quarantines.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 14px;">لا توجد مواد في حجر التوالف</td></tr>`;
      return;
    }

    tbody.innerHTML = this.quarantines.map(q => `
      <tr>
        <td><strong>${q.quarantine_no}</strong></td>
        <td>${q.item_name}</td>
        <td>${q.warehouse_name} (${q.bin_location})</td>
        <td>${q.quantity} ${q.unit}</td>
        <td style="color: #c0392b; font-weight: bold;">${App.formatNumber(q.total_loss_amount)} ر.ي</td>
        <td>${q.reason}</td>
        <td>
          <span class="badge ${q.status === 'quarantined' ? 'badge-danger' : 'badge-secondary'}">
            ${q.status === 'quarantined' ? 'محجوز / تالف' : q.status}
          </span>
        </td>
        <td>${q.quarantined_at ? q.quarantined_at.split('T')[0] : '-'}</td>
        <td>
          ${q.status === 'quarantined' ? `
            <button class="btn btn-warning btn-sm" onclick="Inventory.resolveQuarantineModal(${q.id})">معالجة التالف</button>
          ` : '<span style="color: var(--text-secondary);">معالج</span>'}
        </td>
      </tr>
    `).join('');
  },

  async openQuarantineModal() {
    if (!this.items || this.items.length === 0) await this.loadItems();
    const warehouses = await this.getWarehouses();
    const whOptions = warehouses.map(w => `<option value="${w.id}">${w.name} (${w.code})</option>`).join('');
    const itemOptions = this.items.map(it => `<option value="${it.id}">${it.name} (${it.code}) - الرصيد: ${it.current_quantity} ${it.unit}</option>`).join('');

    const content = `
      <form id="quarantineForm" onsubmit="Inventory.submitQuarantine(event)">
        <div style="background: rgba(192, 57, 43, 0.1); border-right: 4px solid #c0392b; padding: 10px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem;">
          ☣️ <strong>حجر وعزل المواد التالفة:</strong> يتم خصم الكمية المعزولة من المخزون الصالح فورياً ونقلها إلى صندوق حجر افتراضي مع توليد قيد إثبات خسائر تلف المواد.
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المستودع / الموقع:</label>
          <select id="qWarehouse" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${whOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المادة المراد عزلها:</label>
          <select id="qItem" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${itemOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">الكمية التالفة المعزولة:</label>
          <input type="number" step="any" min="0.01" id="qQty" class="form-control" required placeholder="الكمية" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">سبب التلف أو الاستبعاد:</label>
          <input type="text" id="qReason" class="form-control" required placeholder="سوء تخزين، كسر أثناء النقل، رطوبة، انتهاء صلاحية..." style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">ملاحظات المعاينة / موقع الصندوق:</label>
          <input type="text" id="qNotes" class="form-control" placeholder="صندوق الحجر - القسم الشمالي" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-primary" style="background: #c0392b; border-color: #a93226;">عزل المادة وإثبات الخسارة</button>
        </div>
      </form>
    `;
    App.showDynamicModal('عزل مواد تالفة إلى صندوق الحجر', content);
  },

  async submitQuarantine(e) {
    e.preventDefault();
    const warehouse_id = Number(document.getElementById('qWarehouse').value);
    const item_id = Number(document.getElementById('qItem').value);
    const quantity = Number(document.getElementById('qQty').value);
    const reason = document.getElementById('qReason').value.trim();
    const inspection_notes = document.getElementById('qNotes').value.trim();

    try {
      const res = await fetch('/api/material-management/quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id, item_id, quantity, reason, inspection_notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم عزل المواد وإثبات خسائر التلف في القيد المحاسبي بنجاح`, 'success');
        App.closeModal('dynamicAppModal');
        this.loadQuarantine();
        this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في عزل المواد التالفة', 'error');
    }
  },

  async resolveQuarantineModal(quarantineId) {
    const content = `
      <form id="resolveQuarantineForm" onsubmit="Inventory.submitResolveQuarantine(event, ${quarantineId})">
        <div style="background: rgba(243, 156, 18, 0.1); border-right: 4px solid #f39c12; padding: 10px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem;">
          ⚙️ <strong>معالجة المواد المعزولة:</strong> حدد الإجراء النهائي للكمية المحجوزة لتحديث الدفاتر المخزنية.
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">إجراء المعالجة والبت:</label>
          <select id="resAction" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            <option value="scrapped">إتلاف نهائي وبيع كخردة (Scrapped)</option>
            <option value="refurbished">إعادة تأهيل وإرجاعها للمخزون الصالح (Refurbished)</option>
            <option value="disposed">تخلص بيئي معتمد (Disposed)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">تقرير وملاحظات المعالجة:</label>
          <textarea id="resNotes" class="form-control" rows="2" placeholder="ملاحظات المعاينة الفنية وقرار لجنة التصرف" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-warning">تأكيد معالجة سجل الحجر</button>
        </div>
      </form>
    `;
    App.showDynamicModal(`معالجة سجل الحجر #${quarantineId}`, content);
  },

  async submitResolveQuarantine(e, quarantineId) {
    e.preventDefault();
    const action = document.getElementById('resAction').value;
    const resolution_notes = document.getElementById('resNotes').value.trim();

    try {
      const res = await fetch(`/api/material-management/quarantine/${quarantineId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, resolution_notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        App.closeModal('dynamicAppModal');
        this.loadQuarantine();
        this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل معالجة سجل الحجر', 'error');
    }
  },

  // =========================================================================
  // 4. مرتجعات الموقع وفحص الجودة (Site Returns with QC)
  // =========================================================================

  async loadSiteReturns() {
    const tbody = document.getElementById('siteReturnsTableBody');
    if (!tbody) return;
    try {
      const res = await fetch('/api/material-management/site-returns');
      const json = await res.json();
      if (json.success) {
        this.siteReturns = json.data;
        this.renderSiteReturnsTable();
      }
    } catch (e) {
      console.error('Error loading returns:', e);
    }
  },

  renderSiteReturnsTable() {
    const tbody = document.getElementById('siteReturnsTableBody');
    if (!tbody) return;

    if (this.siteReturns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 14px;">لا توجد مرتجعات مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = this.siteReturns.map(r => `
      <tr>
        <td><strong>${r.return_no}</strong></td>
        <td>${r.project_name}</td>
        <td>${r.item_name}</td>
        <td>${r.quantity} ${r.unit}</td>
        <td>
          <span class="badge ${r.condition_status === 'good' ? 'badge-success' : (r.condition_status === 'refurbishable' ? 'badge-warning' : 'badge-danger')}">
            ${r.condition_status === 'good' ? '✓ ممتاز وصالح' : (r.condition_status === 'refurbishable' ? 'قابل للإصلاح' : 'تالف / خردة')}
          </span>
        </td>
        <td>${r.qc_inspector_name}</td>
        <td style="color: #27ae60; font-weight: bold;">${App.formatNumber(r.credited_amount)} ر.ي</td>
        <td>${r.return_date}</td>
        <td><span class="badge badge-success">${r.status}</span></td>
      </tr>
    `).join('');
  },

  async openSiteReturnModal() {
    if (!this.items || this.items.length === 0) await this.loadItems();
    const projects = await this.getProjects();
    const warehouses = await this.getWarehouses();
    const projOptions = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const whOptions = warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    const itemOptions = this.items.map(it => `<option value="${it.id}">${it.name} (${it.code}) - سعر الوحدة: ${App.formatNumber(it.unit_price)} ر.ي</option>`).join('');

    const content = `
      <form id="siteReturnForm" onsubmit="Inventory.submitSiteReturn(event)">
        <div style="background: rgba(39, 174, 96, 0.1); border-right: 4px solid #27ae60; padding: 10px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem;">
          🔄 <strong>إرجاع المواد من المواقع (MRR) مع فحص الجودة (QC):</strong> تُضاف المواد للمستودع وتُخصم التكلفة المستردة من حساب تكلفة المشروع تلقائياً.
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المشروع المصدر (المُرجِع):</label>
          <select id="srProject" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${projOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المستودع المستلم:</label>
          <select id="srWarehouse" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${whOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المادة المرتجعة:</label>
          <select id="srItem" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${itemOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">الكمية المرتجعة:</label>
          <input type="number" step="any" min="0.01" id="srQty" class="form-control" required placeholder="الكمية المرتجعة" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">نتيجة تقييم الجودة (QC Inspection Grade):</label>
          <select id="srCondition" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            <option value="good">✓ صالحة وممتازة (استرداد 100% من التكلفة للمشروع)</option>
            <option value="refurbishable">⚠️ قابلة للإصلاح والتأهيل (استرداد 70% من التكلفة)</option>
            <option value="damaged_scrap">❌ تالفة / خردة (لا استرداد، عزل مباشر لحجر التوالف)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">اسم مهندس الفحص وضبط الجودة (QC):</label>
          <input type="text" id="srQcName" class="form-control" required placeholder="م. فاحص الجودة" value="م. فاحص الجودة" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-success">توثيق الإرجاع وفحص QC</button>
        </div>
      </form>
    `;
    App.showDynamicModal('توثيق إرجاع مواد من الموقع وفحص الجودة (QC)', content);
  },

  async submitSiteReturn(e) {
    e.preventDefault();
    const project_id = Number(document.getElementById('srProject').value);
    const warehouse_id = Number(document.getElementById('srWarehouse').value);
    const item_id = Number(document.getElementById('srItem').value);
    const quantity = Number(document.getElementById('srQty').value);
    const condition_status = document.getElementById('srCondition').value;
    const qc_inspector_name = document.getElementById('srQcName').value.trim();

    try {
      const res = await fetch('/api/material-management/site-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id,
          warehouse_id,
          item_id,
          quantity,
          condition_status,
          qc_inspector_name
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم توثيق إرجاع المواد (${data.data.return_no}) وتخفيض تكلفة المشروع بنجاح`, 'success');
        App.closeModal('dynamicAppModal');
        this.loadSiteReturns();
        this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في توثيق الإرجاع', 'error');
    }
  },

  // =========================================================================
  // 5. التحويلات بين المشاريع (Inter-Project Transfers)
  // =========================================================================

  async loadProjectTransfers() {
    const tbody = document.getElementById('projectTransfersTableBody');
    if (!tbody) return;
    try {
      const res = await fetch('/api/material-management/inter-project-transfers');
      const json = await res.json();
      if (json.success) {
        this.transfers = json.data;
        this.renderProjectTransfersTable();
      }
    } catch (e) {
      console.error('Error loading transfers:', e);
    }
  },

  renderProjectTransfersTable() {
    const tbody = document.getElementById('projectTransfersTableBody');
    if (!tbody) return;

    if (this.transfers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 14px;">لا توجد تحويلات بين المشاريع</td></tr>`;
      return;
    }

    tbody.innerHTML = this.transfers.map(t => `
      <tr>
        <td><strong>${t.transfer_no}</strong></td>
        <td>${t.from_project_name}</td>
        <td>${t.to_project_name}</td>
        <td>${t.item_name}</td>
        <td>${t.quantity} ${t.unit}</td>
        <td>${App.formatNumber(t.total_amount)} ر.ي</td>
        <td>
          <span class="badge ${t.status === 'approved' ? 'badge-primary' : (t.status === 'received' ? 'badge-success' : (t.status === 'rejected' ? 'badge-danger' : 'badge-warning'))}">
            ${t.status === 'requested' ? 'بانتظار الاعتماد المزدوج' : (t.status === 'approved' ? 'معتمد' : (t.status === 'received' ? 'مستلم بالموقع' : 'مرفوض'))}
          </span>
        </td>
        <td>${t.requested_by_name || '-'}</td>
        <td>
          <div style="display: flex; gap: 4px;">
            ${t.status === 'requested' ? `
              <button class="btn btn-primary btn-sm" onclick="Inventory.approveTransfer(${t.id})">اعتماد (Maker-Checker)</button>
            ` : ''}
            ${t.status === 'approved' ? `
              <button class="btn btn-success btn-sm" onclick="Inventory.receiveTransfer(${t.id})">تأكيد الاستلام</button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  },

  async openProjectTransferModal() {
    if (!this.items || this.items.length === 0) await this.loadItems();
    const projects = await this.getProjects();
    const fromOptions = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const toOptions = projects.map((p, idx) => `<option value="${p.id}" ${idx === 1 ? 'selected' : ''}>${p.name}</option>`).join('');
    const itemOptions = this.items.map(it => `<option value="${it.id}">${it.name} (${it.code}) - الرصيد: ${it.current_quantity} ${it.unit}</option>`).join('');

    const content = `
      <form id="projectTransferForm" onsubmit="Inventory.submitProjectTransfer(event)">
        <div style="background: rgba(52, 152, 219, 0.1); border-right: 4px solid #3498db; padding: 10px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem;">
          🔁 <strong>التحويل بين المشاريع (Maker-Checker):</strong> يتم تقديم الطلب بواسطة مهندس الموقع ولا يدخل حيز التنفيذ أو إعادة توجيه التكلفة إلا بعد اعتماد المشرف وتأكيد الاستلام.
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">من مشروع (المصـدر):</label>
          <select id="ptFromProject" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${fromOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">إلى مشروع (المستـلم):</label>
          <select id="ptToProject" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${toOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">المادة المطلوب نقلها:</label>
          <select id="ptItem" class="form-control" required style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
            ${itemOptions}
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">الكمية المطلوب تحويلها:</label>
          <input type="number" step="any" min="0.01" id="ptQty" class="form-control" required placeholder="الكمية" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 4px;">مبررات وأسباب التحويل:</label>
          <textarea id="ptNotes" class="form-control" rows="2" placeholder="تغطية نقص عاجل في موقع العمل بموافقة الطرفين" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('dynamicAppModal')">إلغاء</button>
          <button type="submit" class="btn btn-primary">رفع طلب التحويل (Maker)</button>
        </div>
      </form>
    `;
    App.showDynamicModal('طلب مناقلة مواد بين المشاريع', content);
  },

  async submitProjectTransfer(e) {
    e.preventDefault();
    const from_project_id = Number(document.getElementById('ptFromProject').value);
    const to_project_id = Number(document.getElementById('ptToProject').value);
    const item_id = Number(document.getElementById('ptItem').value);
    const quantity = Number(document.getElementById('ptQty').value);
    const notes = document.getElementById('ptNotes').value.trim();

    if (from_project_id === to_project_id) {
      App.showToast('لا يمكن التحويل لنفس المشروع', 'error');
      return;
    }

    try {
      const res = await fetch('/api/material-management/inter-project-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_project_id,
          to_project_id,
          from_warehouse_id: 1,
          to_warehouse_id: 2,
          item_id,
          quantity,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم رفع طلب التحويل (${data.data.transfer_no}) بنجاح`, 'success');
        App.closeModal('dynamicAppModal');
        this.loadProjectTransfers();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في رفع طلب التحويل', 'error');
    }
  },

  async approveTransfer(transferId) {
    if (!confirm('هل توافق على اعتماد تحويل هذه المواد وإعادة توجيه التكلفة محاسبياً بين المشروعين؟')) return;
    try {
      const res = await fetch(`/api/material-management/inter-project-transfers/${transferId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        this.loadProjectTransfers();
        this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في اعتماد التحويل', 'error');
    }
  },

  async receiveTransfer(transferId) {
    try {
      const res = await fetch(`/api/material-management/inter-project-transfers/${transferId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        this.loadProjectTransfers();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل في تأكيد الاستلام', 'error');
    }
  },

  // =========================================================================
  // 6. سجل أحداث المجال المشفر (Event-Driven Audit Ledger)
  // =========================================================================

  async loadDomainEvents() {
    const tbody = document.getElementById('domainEventsTableBody');
    if (!tbody) return;
    try {
      const res = await fetch('/api/material-management/events?limit=40');
      const json = await res.json();
      if (json.success) {
        this.events = json.data;
        this.renderDomainEventsTable();
      }
    } catch (e) {
      console.error('Error loading events:', e);
    }
  },

  renderDomainEventsTable() {
    const tbody = document.getElementById('domainEventsTableBody');
    if (!tbody) return;

    if (this.events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 14px;">لا توجد أحداث مسجلة في السلسلة</td></tr>`;
      return;
    }

    tbody.innerHTML = this.events.map(ev => `
      <tr>
        <td><strong>${ev.event_id}</strong></td>
        <td><span class="badge badge-info">${ev.event_name}</span></td>
        <td>${ev.aggregate_type} (#${ev.aggregate_id})</td>
        <td>${ev.user_name || 'System'}</td>
        <td style="font-size: 0.85rem;">${ev.timestamp}</td>
        <td style="font-family: monospace; font-size: 0.8rem; color: #7f8c8d;">${ev.prev_hash.slice(0, 10)}...</td>
        <td style="font-family: monospace; font-size: 0.8rem; color: #27ae60;">🔒 ${ev.event_hash.slice(0, 12)}...</td>
      </tr>
    `).join('');
  },

  async verifyEventsChain() {
    const alertBox = document.getElementById('chainVerificationAlert');
    try {
      const res = await fetch('/api/material-management/events/verify-chain');
      const json = await res.json();
      if (json.success && alertBox) {
        alertBox.style.display = 'block';
        if (json.data.isValid) {
          alertBox.className = 'badge badge-success';
          alertBox.style.padding = '10px 14px';
          alertBox.style.fontSize = '0.95rem';
          alertBox.innerHTML = `✓ ${json.data.message} (تم التحقق من ${json.data.verifiedCount} حدث مشفر بدقة دون انقطاع)`;
        } else {
          alertBox.className = 'badge badge-danger';
          alertBox.style.padding = '10px 14px';
          alertBox.style.fontSize = '0.95rem';
          alertBox.innerHTML = `⛔ ${json.data.error}`;
        }
      }
    } catch (e) {
      App.showToast('فشل في فحص السلسلة الهاشية', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.Inventory = Inventory;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Inventory;
}

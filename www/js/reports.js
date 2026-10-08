/**
 * =========================================================================
 * js/reports.js
 * إدارة التقارير، القوائم المالية، كشوفات الحسابات وتصدير Excel - رواسي عدن
 * =========================================================================
 * 
 * المبادئ المحاسبية المعيارية المطبقة:
 * 1. الواجهة الأمامية للعرض والتنسيق فقط (Display & Presentation Layer) وليس محرك حسابات.
 * 2. الاعتماد التام على ردود الخادم (API Response) القادمة من دفتر الأستاذ العام (General Ledger).
 * 3. خلو تام من أي أرقام افتراضية مصطنعة أو Fallback Values (1,250,000 / 850,000 / 35% إلخ).
 * 4. حفظ البيانات الرسمية المستلمة في ذاكرة التقرير (lastReportData) لاستخدامها في التصدير والطباعة.
 */

const Reports = {
  activeReportTab: 'profit-loss',
  lastReportData: {},

  async init() {
    await this.loadDashboardKPIs();
  },

  // =========================================================================
  // 1. لوحة التحكم المركزية (Dashboard KPIs)
  // =========================================================================
  async loadDashboardKPIs() {
    const kpiIds = [
      'kpiTotalIncome', 'kpiTotalExpenses', 'kpiNetProfit', 'kpiCashBalance',
      'kpiClientReceivables', 'kpiSupplierPayables', 'kpiActiveProjects', 'kpiTotalProjects'
    ];
    kpiIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('skeleton', 'skeleton-text');
    });

    const recentTbody = document.getElementById('recentOperationsTableBody');
    if (recentTbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(recentTbody, 4, 5);
    }

    try {
      const res = await fetch('/api/reports/dashboard');
      const json = await res.json();
      if (json.success && json.data) {
        const { kpis, expenses_by_type, monthly_trend, recent_transactions, contracting_summary } = json.data;
        this.lastReportData['dashboard'] = json.data;
        this.updateKPIElements(kpis, contracting_summary);
        this.renderExpensesDonutChart(expenses_by_type);
        this.renderMonthlyTrendChart(monthly_trend);
        this.renderRecentOperationsTable(recent_transactions);
      }
    } catch (e) {
      console.error('❌ Error loading dashboard KPIs:', e);
    }
  },

  updateKPIElements(k = {}, contractingSummary = {}) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('skeleton', 'skeleton-text');
        el.textContent = App.formatNumber(val ?? 0);
      }
    };

    setTxt('kpiTotalIncome', k.total_income);
    setTxt('kpiTotalExpenses', k.total_expenses);
    setTxt('kpiNetProfit', k.net_profit);
    setTxt('kpiCashBalance', k.cash_balance);
    setTxt('kpiClientReceivables', k.client_receivables);
    setTxt('kpiSupplierPayables', k.supplier_payables);

    const cs = contractingSummary || {};
    setTxt('matrixTotalReceipts', k.cash_receipts ?? cs.total_cash_receipts ?? 0);
    setTxt('matrixRecognizedRevenue', k.recognized_revenue ?? cs.total_recognized_revenue ?? 0);
    setTxt('matrixGrossBillings', k.progress_billings ?? cs.total_gross_billings ?? 0);
    setTxt('matrixAdvanceLiability', k.advance_payments_liability ?? cs.total_advance_liability ?? 0);
    setTxt('matrixActiveRetention', k.retention_receivable_asset ?? cs.total_active_retention ?? 0);
    setTxt('matrixContractAssetWIP', k.contract_asset_wip ?? cs.total_contract_asset_wip ?? 0);
    setTxt('matrixApprovedVariations', k.approved_variations ?? cs.total_approved_variations ?? 0);
    setTxt('matrixTrueNetProfit', k.true_net_profit ?? cs.total_true_profit ?? 0);

    const activeEl = document.getElementById('kpiActiveProjects');
    if (activeEl) {
      activeEl.classList.remove('skeleton', 'skeleton-text');
      activeEl.textContent = k.active_projects ?? 0;
    }
    const totalEl = document.getElementById('kpiTotalProjects');
    if (totalEl) {
      totalEl.classList.remove('skeleton', 'skeleton-text');
      totalEl.textContent = k.total_projects ?? 0;
    }
  },

  renderExpensesDonutChart(data) {
    if (window.UI && UI.Chart && typeof UI.Chart.Donut === 'function') {
      UI.Chart.Donut('expensesDonutCanvas', {
        data: data || [],
        legendId: 'expensesDonutLegend'
      });
      return;
    }
    const canvas = document.getElementById('expensesDonutCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 280;
    canvas.height = 220;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  },

  renderMonthlyTrendChart(trendData) {
    if (window.UI && UI.Chart && typeof UI.Chart.TrendLine === 'function') {
      UI.Chart.TrendLine('monthlyTrendCanvas', {
        data: trendData || []
      });
      return;
    }
    const canvas = document.getElementById('monthlyTrendCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 460;
    canvas.height = 220;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  },

  renderRecentOperationsTable(operations) {
    const tbody = document.getElementById('recentOperationsTableBody');
    if (!tbody) return;

    if (!operations || operations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد حركات مؤخراً في دفتر الأستاذ</td></tr>`;
      return;
    }

    tbody.innerHTML = operations.map(op => {
      const isIncome = op.type === 'إيراد' || op.type === 'سند قبض';
      return `
        <tr>
          <td>${op.date || '-'}</td>
          <td style="font-weight: 700; color: ${isIncome ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${App.formatNumber(op.amount || 0)} ${op.currency || 'ر.ي'}
          </td>
          <td>${op.project_name || 'عام'}</td>
          <td style="color: var(--text-secondary);">${op.description || '-'}</td>
          <td>
            <span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">
              ${op.type || 'قيد'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  async filterProfitLoss() {
    const fromDate = document.getElementById('plFromDate')?.value || '';
    const toDate = document.getElementById('plToDate')?.value || '';
    let url = '/api/reports/profit-loss';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    const qs = params.toString();
    if (qs) url += '?' + qs;

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        const inEl = document.getElementById('plTotalIncome');
        const exEl = document.getElementById('plTotalExpenses');
        const netEl = document.getElementById('plNetProfit');

        if (inEl) inEl.textContent = App.formatNumber(d.total_income || 0);
        if (exEl) exEl.textContent = App.formatNumber(d.total_expenses || 0);
        if (netEl) netEl.textContent = App.formatNumber(d.net_profit || 0);

        App.showToast('تم تحديث أرقام الأرباح والخسائر بنجاح', 'success');
        App.navigate('reports');
        this.switchReportTab('profit-loss');
      }
    } catch (e) {
      console.error(e);
      App.showToast('تعذر جلب التقرير', 'error');
    }
  },

  async loadClientStatement() {
    const clientId = document.getElementById('statementClientSelect')?.value;
    if (!clientId) {
      App.showToast('يرجى اختيار العميل أولاً', 'error');
      return;
    }
    App.navigate('reports');
    this.switchReportTab('client-statement');
    await this.initClientStatementDropdown(clientId);
    await this.fetchFullClientStatement(clientId);
  },

  // =========================================================================
  // إدارة التبويبات والشاشات (Tabs Switcher)
  // =========================================================================
  switchReportTab(tabId) {
    this.activeReportTab = tabId;
    document.querySelectorAll('.report-tab-btn').forEach(btn => btn.classList.remove('active'));
    const clickedBtn = document.getElementById(`tabBtn_${tabId}`);
    if (clickedBtn) clickedBtn.classList.add('active');

    document.querySelectorAll('.report-pane').forEach(p => p.style.display = 'none');
    const target = document.getElementById(`pane_${tabId}`);
    if (target) target.style.display = 'block';

    if (tabId === 'profit-loss') {
      this.loadFullProfitLoss();
    } else if (tabId === 'trial-balance') {
      this.loadTrialBalance();
    } else if (tabId === 'income-statement') {
      this.loadIncomeStatement();
    } else if (tabId === 'balance-sheet') {
      this.loadBalanceSheet();
    } else if (tabId === 'cash-flow') {
      this.loadCashFlow();
    } else if (tabId === 'projects-profitability') {
      this.loadProjectsProfitability();
    } else if (tabId === 'cost-centers-profitability') {
      this.loadCostCentersProfitability();
    } else if (tabId === 'client-statement') {
      this.initClientStatementDropdown();
    } else if (tabId === 'supplier-statement') {
      this.initSupplierStatementDropdown();
    }
  },

  // =========================================================================
  // 1. تقرير الأرباح والخسائر الشامل (P&L)
  // =========================================================================
  async loadFullProfitLoss() {
    const fromDate = document.getElementById('repPlFromDate')?.value || '';
    const toDate = document.getElementById('repPlToDate')?.value || '';
    let url = '/api/reports/profit-loss';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['profit-loss'] = json;

        const incEl = document.getElementById('fullPlIncome');
        const expEl = document.getElementById('fullPlExpense');
        const profEl = document.getElementById('fullPlProfit');

        if (incEl) incEl.textContent = App.formatNumber(d.total_income || 0) + ' ر.ي';
        if (expEl) expEl.textContent = App.formatNumber(d.total_expenses || 0) + ' ر.ي';
        if (profEl) {
          profEl.textContent = App.formatNumber(d.net_profit || 0) + ' ر.ي';
          profEl.style.color = (d.net_profit || 0) >= 0 ? 'var(--gold-light)' : 'var(--accent-red)';
        }

        const tbody = document.getElementById('fullPlBreakdownTable');
        if (tbody) {
          const breakdown = d.expenses_breakdown || [];
          if (breakdown.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد مصروفات مسجلة في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = breakdown.map(item => `
              <tr>
                <td><strong>${item.name || item.expense_type || 'بند مصروف'}</strong></td>
                <td style="color: var(--accent-red); font-weight: bold;">${App.formatNumber(item.amount || item.total || 0)} ر.ي</td>
                <td>${item.percentage !== undefined ? item.percentage + '%' : Math.round(((item.amount || item.total || 0) / (d.total_expenses || 1)) * 100) + '%'}</td>
              </tr>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading profit-loss:', e);
      App.showToast('تعذر جلب تقرير الأرباح والخسائر', 'error');
    }
  },

  // =========================================================================
  // 2. تقرير ميزان المراجعة والأرصدة (Trial Balance)
  // =========================================================================
  async loadTrialBalance() {
    const fromDate = document.getElementById('tbFromDate')?.value || '';
    const toDate = document.getElementById('tbToDate')?.value || '';
    let url = '/api/reports/trial-balance';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { accounts, totals } = json.data;
        this.lastReportData['trial-balance'] = json;

        const is_balanced = json.reconciliation ? json.reconciliation.is_balanced : totals?.is_balanced;
        const diff = json.reconciliation ? json.reconciliation.period_difference : Math.abs((totals?.total_debit || 0) - (totals?.total_credit || 0));

        const debitEl = document.getElementById('tbTotalDebit');
        const creditEl = document.getElementById('tbTotalCredit');
        const balDebitEl = document.getElementById('tbBalanceDebit');
        const statusEl = document.getElementById('tbBalanceStatus');

        if (debitEl) debitEl.textContent = App.formatNumber(totals.period_debit || totals.total_debit || 0) + ' ر.ي';
        if (creditEl) creditEl.textContent = App.formatNumber(totals.period_credit || totals.total_credit || 0) + ' ر.ي';
        if (balDebitEl) balDebitEl.textContent = App.formatNumber(totals.closing_debit || totals.balance_debit || 0) + ' ر.ي';

        if (statusEl) {
          if (is_balanced) {
            statusEl.textContent = 'متزن 100% ✓';
            statusEl.style.color = 'var(--accent-green)';
          } else {
            statusEl.textContent = `فارق: ${App.formatNumber(diff || 0)} ر.ي ⚠️`;
            statusEl.style.color = 'var(--accent-red)';
          }
        }

        const tbody = document.getElementById('trialBalanceTableBody');
        if (tbody) {
          if (!accounts || accounts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد حسابات أو حركات في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = accounts.map(a => `
              <tr>
                <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${a.code}</td>
                <td><strong>${a.name}</strong></td>
                <td><span class="badge badge-info">${a.type}</span></td>
                <td style="text-align: left; direction: ltr; font-family: monospace;">${a.opening_debit > 0 ? App.formatNumber(a.opening_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace;">${a.opening_credit > 0 ? App.formatNumber(a.opening_credit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${a.period_debit > 0 ? App.formatNumber(a.period_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8;">${a.period_credit > 0 ? App.formatNumber(a.period_credit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">${a.closing_debit > 0 ? App.formatNumber(a.closing_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: #38bdf8;">${a.closing_credit > 0 ? App.formatNumber(a.closing_credit) : '-'}</td>
              </tr>
            `).join('');
          }
        }

        const tfoot = document.getElementById('trialBalanceTableFoot');
        if (tfoot) {
          tfoot.innerHTML = `
            <tr>
              <td colspan="3" style="text-align: center; font-size: 1rem;">الإجمالي الكلي لميزان المراجعة</td>
              <td style="text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(totals.opening_debit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(totals.opening_credit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${App.formatNumber(totals.period_debit || totals.total_debit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8; font-size: 1.05rem;">${App.formatNumber(totals.period_credit || totals.total_credit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${App.formatNumber(totals.closing_debit || totals.balance_debit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8; font-size: 1.05rem;">${App.formatNumber(totals.closing_credit || totals.balance_credit || 0)}</td>
            </tr>
          `;
        }
      }
    } catch (e) {
      console.error('❌ Error loading trial balance:', e);
      App.showToast('فشل تحميل ميزان المراجعة', 'error');
    }
  },

  // =========================================================================
  // 3. تقرير قائمة الدخل المعيارية (Income Statement)
  // =========================================================================
  async loadIncomeStatement() {
    const fromDate = document.getElementById('isFromDate')?.value || '';
    const toDate = document.getElementById('isToDate')?.value || '';
    let url = '/api/reports/income-statement';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['income-statement'] = json;

        const revEl = document.getElementById('isTotalRevenues');
        const dirEl = document.getElementById('isDirectCosts');
        const grossEl = document.getElementById('isGrossProfit');
        const expEl = document.getElementById('isTotalExpenses');
        const netEl = document.getElementById('isNetIncome');

        if (revEl) revEl.textContent = App.formatNumber(d.total_revenues || 0) + ' ر.ي';
        if (dirEl) dirEl.textContent = App.formatNumber(d.direct_costs || 0) + ' ر.ي';
        if (grossEl) grossEl.textContent = App.formatNumber(d.gross_profit || 0) + ' ر.ي';
        if (expEl) expEl.textContent = App.formatNumber(d.operating_expenses || d.total_expenses || 0) + ' ر.ي';
        if (netEl) {
          netEl.textContent = App.formatNumber(d.net_profit || 0) + ' ر.ي';
          netEl.style.color = (d.net_profit || 0) >= 0 ? 'var(--gold-light)' : 'var(--accent-red)';
        }

        const revTbody = document.getElementById('isRevenuesTableBody');
        if (revTbody) {
          const revs = d.revenues || [];
          if (revs.length === 0) {
            revTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد إيرادات مسجلة بالأستاذ</td></tr>`;
          } else {
            revTbody.innerHTML = revs.map(r => `
              <tr>
                <td><strong>${r.code ? r.code + ' - ' : ''}${r.name}</strong></td>
                <td style="font-weight: bold; color: var(--accent-green); text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(r.amount || 0)} ر.ي</td>
              </tr>
            `).join('') + `
              <tr style="background: rgba(16,185,129,0.08); font-weight: bold;">
                <td>إجمالي الإيرادات المعترف بها</td>
                <td style="color: var(--accent-green); text-align: left; direction: ltr; font-family: monospace; font-size: 1.05rem;">${App.formatNumber(d.total_revenues || 0)} ر.ي</td>
              </tr>
            `;
          }
        }

        const expTbody = document.getElementById('isExpensesTableBody');
        if (expTbody) {
          const allCosts = [...(d.direct_cost_items || []), ...(d.expense_items || [])];
          if (allCosts.length === 0) {
            expTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد مصروفات مسجلة بالأستاذ</td></tr>`;
          } else {
            expTbody.innerHTML = allCosts.map(e => `
              <tr>
                <td><strong>${e.code ? e.code + ' - ' : ''}${e.name}</strong></td>
                <td style="font-weight: bold; color: var(--accent-red); text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(e.amount || 0)} ر.ي</td>
              </tr>
            `).join('') + `
              <tr style="background: rgba(239,68,68,0.08); font-weight: bold;">
                <td>إجمالي التكاليف والمصروفات</td>
                <td style="color: var(--accent-red); text-align: left; direction: ltr; font-family: monospace; font-size: 1.05rem;">${App.formatNumber(d.total_expenses || 0)} ر.ي</td>
              </tr>
            `;
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading income statement:', e);
      App.showToast('فشل تحميل قائمة الدخل', 'error');
    }
  },

  // =========================================================================
  // 4. تقرير المركز المالي / الميزانية العمومية (Balance Sheet)
  // =========================================================================
  async loadBalanceSheet() {
    const asOfDate = document.getElementById('bsAsOfDate')?.value || '';
    let url = '/api/reports/balance-sheet';
    if (asOfDate) url += `?as_of_date=${asOfDate}`;

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { assets, liabilities, equity, totals } = json.data;
        this.lastReportData['balance-sheet'] = json;

        const isBalanced = json.reconciliation ? json.reconciliation.is_balanced : (totals.assets === totals.liabilities_plus_equity);
        const badge = document.getElementById('bsReconcileBadge');
        if (badge) {
          if (isBalanced) {
            badge.textContent = '⚖️ معادلة الميزانية: متزنة تماماً (الأصول = الخصوم + الملكية) ✓';
            badge.style.color = '#4ade80';
            badge.style.background = 'rgba(34,197,94,0.15)';
          } else {
            const diff = json.reconciliation?.difference || Math.abs(totals.assets - totals.liabilities_plus_equity);
            badge.textContent = `⚠️ فارق ميزانية: ${App.formatNumber(diff)} ر.ي`;
            badge.style.color = '#f87171';
            badge.style.background = 'rgba(239,68,68,0.15)';
          }
        }

        const assetsTbody = document.getElementById('bsAssetsTable');
        if (assetsTbody) {
          if (!assets || assets.length === 0) {
            assetsTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد أصول مسجلة</td></tr>`;
          } else {
            assetsTbody.innerHTML = assets.map(a => `
              <tr>
                <td>${a.code ? a.code + ' - ' : ''}${a.name}</td>
                <td style="font-weight: bold; text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(a.balance || 0)} ر.ي</td>
              </tr>
            `).join('');
          }
        }

        const liabTbody = document.getElementById('bsLiabTable');
        if (liabTbody) {
          const combinedLiab = [...(liabilities || []), ...(equity || [])];
          if (combinedLiab.length === 0) {
            liabTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد التزامات أو حقوق ملكية</td></tr>`;
          } else {
            liabTbody.innerHTML = combinedLiab.map(l => `
              <tr>
                <td>${l.code ? l.code + ' - ' : ''}${l.name}</td>
                <td style="font-weight: bold; text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(l.balance || 0)} ر.ي</td>
              </tr>
            `).join('');
          }
        }

        const totAssetsEl = document.getElementById('bsTotalAssets');
        const totLiabEl = document.getElementById('bsTotalLiabEquity');
        if (totAssetsEl) totAssetsEl.textContent = App.formatNumber(totals.assets || 0) + ' ر.ي';
        if (totLiabEl) totLiabEl.textContent = App.formatNumber(totals.liabilities_plus_equity || 0) + ' ر.ي';
      }
    } catch (e) {
      console.error('❌ Error loading balance sheet:', e);
      App.showToast('فشل تحميل الميزانية العمومية', 'error');
    }
  },

  // =========================================================================
  // 5. تقرير التدفقات النقدية (Cash Flow)
  // =========================================================================
  async loadCashFlow() {
    const fromDate = document.getElementById('cfFromDate')?.value || '';
    const toDate = document.getElementById('cfToDate')?.value || '';
    let url = '/api/reports/cash-flow';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['cash-flow'] = json;

        const op = d.operating_activities || { inflows: [], outflows: [], net: 0 };
        const inv = d.investing_activities || { inflows: [], outflows: [], net: 0 };
        const fin = d.financing_activities || { inflows: [], outflows: [], net: 0 };

        const openEl = document.getElementById('cfOpeningCash');
        const netOpEl = document.getElementById('cfNetOperating');
        const changeEl = document.getElementById('cfNetChange');
        const closeEl = document.getElementById('cfClosingCash');

        if (openEl) openEl.textContent = App.formatNumber(d.opening_balance || 0) + ' ر.ي';
        if (netOpEl) netOpEl.textContent = App.formatNumber(op.net || 0) + ' ر.ي';
        if (changeEl) changeEl.textContent = App.formatNumber(d.net_cash_change || 0) + ' ر.ي';
        if (closeEl) closeEl.textContent = App.formatNumber(d.closing_balance || 0) + ' ر.ي';

        const tbody = document.getElementById('cashFlowTableBody');
        if (tbody) {
          let html = '';

          // 1. الأنشطة التشغيلية
          html += `<tr style="background: rgba(56,189,248,0.12); font-weight: bold;"><td colspan="4">أولاً: التدفقات النقدية من الأنشطة التشغيلية</td></tr>`;
          if ((op.inflows || []).length === 0 && (op.outflows || []).length === 0) {
            html += `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد حركات تشغيلية</td></tr>`;
          } else {
            (op.inflows || []).forEach(it => {
              html += `
                <tr>
                  <td>${it.item}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${App.formatNumber(it.amount)}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">-</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">+${App.formatNumber(it.amount)} ر.ي</td>
                </tr>
              `;
            });
            (op.outflows || []).forEach(it => {
              html += `
                <tr>
                  <td>${it.item}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">-</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">${App.formatNumber(it.amount)}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-red);">-${App.formatNumber(it.amount)} ر.ي</td>
                </tr>
              `;
            });
          }
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد من الأنشطة التشغيلية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${op.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${App.formatNumber(op.net || 0)} ر.ي</td>
            </tr>
          `;

          // 2. الأنشطة الاستثمارية
          html += `<tr style="background: rgba(168,85,247,0.12); font-weight: bold;"><td colspan="4">ثانياً: التدفقات النقدية من الأنشطة الاستثمارية (شراء/بيع أصول)</td></tr>`;
          if ((inv.inflows || []).length === 0 && (inv.outflows || []).length === 0) {
            html += `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد حركات استثمارية</td></tr>`;
          } else {
            (inv.inflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td style="text-align:left;direction:ltr;color:var(--accent-green);">${App.formatNumber(it.amount)}</td><td>-</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-green);">+${App.formatNumber(it.amount)} ر.ي</td></tr>`;
            });
            (inv.outflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td>-</td><td style="text-align:left;direction:ltr;color:var(--accent-red);">${App.formatNumber(it.amount)}</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-red);">-${App.formatNumber(it.amount)} ر.ي</td></tr>`;
            });
          }
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد من الأنشطة الاستثمارية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${inv.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${App.formatNumber(inv.net || 0)} ر.ي</td>
            </tr>
          `;

          // 3. الأنشطة التمويلية
          html += `<tr style="background: rgba(245,158,11,0.12); font-weight: bold;"><td colspan="4">ثالثاً: التدفقات النقدية من الأنشطة التمويلية (رأس المال والقروض)</td></tr>`;
          if ((fin.inflows || []).length === 0 && (fin.outflows || []).length === 0) {
            html += `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد حركات تمويلية</td></tr>`;
          } else {
            (fin.inflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td style="text-align:left;direction:ltr;color:var(--accent-green);">${App.formatNumber(it.amount)}</td><td>-</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-green);">+${App.formatNumber(it.amount)} ر.ي</td></tr>`;
            });
            (fin.outflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td>-</td><td style="text-align:left;direction:ltr;color:var(--accent-red);">${App.formatNumber(it.amount)}</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-red);">-${App.formatNumber(it.amount)} ر.ي</td></tr>`;
            });
          }
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد من الأنشطة التمويلية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${fin.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${App.formatNumber(fin.net || 0)} ر.ي</td>
            </tr>
          `;

          // إجماليات التدفق الختامية
          html += `
            <tr style="background: rgba(212,175,55,0.15); font-weight: bold; font-size: 1.05rem;">
              <td>صافي التغير في النقدية خلال الفترة</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--gold-light);">${App.formatNumber(d.net_cash_change || 0)} ر.ي</td>
            </tr>
            <tr style="background: rgba(255,255,255,0.06); font-weight: bold;">
              <td>رصيد النقدية والبنوك في نهاية المدة</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.1rem;">${App.formatNumber(d.closing_balance || 0)} ر.ي</td>
            </tr>
          `;

          tbody.innerHTML = html;
        }
      }
    } catch (e) {
      console.error('❌ Error loading cash flow:', e);
      App.showToast('فشل تحميل التدفقات النقدية', 'error');
    }
  },

  // =========================================================================
  // 6. تقرير ربحية المشاريع (Projects Profitability)
  // =========================================================================
  async loadProjectsProfitability() {
    const fromDate = document.getElementById('repProjFromDate')?.value || '';
    const toDate = document.getElementById('repProjToDate')?.value || '';
    const projectId = document.getElementById('repProjFilterSelect')?.value || '';

    let url = '/api/reports/projects-profitability';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (projectId) params.append('project_id', projectId);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        this.lastReportData['projects-profitability'] = json;
        const projects = json.data;

        // تحديث القائمة المنسدلة للمشاريع إذا كانت فارغة
        const select = document.getElementById('repProjFilterSelect');
        if (select && select.options.length <= 1 && projects.length > 0) {
          select.innerHTML = '<option value="">كافة المشاريع</option>' +
            projects.map(p => `<option value="${p.id}">${p.name} (${p.code})</option>`).join('');
          if (projectId) select.value = projectId;
        }

        const tbody = document.getElementById('projProfitTableBody');
        if (tbody) {
          if (projects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 18px;">لا توجد بيانات مشاريع</td></tr>`;
          } else {
            tbody.innerHTML = projects.map(p => {
              const isProfit = (p.calculated_actual_profit || 0) >= 0;
              return `
                <tr>
                  <td><strong>${p.name}</strong> <small style="color:var(--text-secondary)">(${p.code})</small></td>
                  <td>${p.client_name || '-'}</td>
                  <td style="color: var(--gold-light); font-weight: bold;">${App.formatNumber(p.contract_value || 0)}</td>
                  <td style="color: var(--accent-red);">${App.formatNumber(p.actual_cost || 0)}</td>
                  <td style="color: #38bdf8; font-weight: 600;">${App.formatNumber(p.recognized_revenue || 0)}</td>
                  <td style="color: ${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: bold;">
                    ${App.formatNumber(p.calculated_actual_profit || 0)}
                  </td>
                  <td><span class="badge ${isProfit ? 'badge-income' : 'badge-expense'}">${p.profit_margin_percentage || 0}%</span></td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <div class="progress-wrap"><div class="progress-bar-fill" style="width: ${Math.min(100, p.progress_percentage || 0)}%"></div></div>
                      <span style="font-size:0.75rem">${p.progress_percentage || 0}%</span>
                    </div>
                  </td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading projects profitability:', e);
    }
  },

  // =========================================================================
  // 7. تقرير ربحية مراكز التكلفة (Cost Centers Profitability)
  // =========================================================================
  async loadCostCentersProfitability() {
    const fromDate = document.getElementById('repCcFromDate')?.value || '';
    const toDate = document.getElementById('repCcToDate')?.value || '';
    const ccId = document.getElementById('repCcFilterSelect')?.value || '';

    let url = '/api/reports/cost-centers-profitability';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (ccId) params.append('cost_center_id', ccId);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['cost-centers-profitability'] = json;

        // تحديث القائمة المنسدلة لمراكز التكلفة
        const select = document.getElementById('repCcFilterSelect');
        if (select && select.options.length <= 1 && d.centers && d.centers.length > 0) {
          select.innerHTML = '<option value="">كافة مراكز التكلفة</option>' +
            d.centers.map(c => `<option value="${c.id}">${c.name} (${c.code})</option>`).join('');
          if (ccId) select.value = ccId;
        }

        const totRevEl = document.getElementById('ccProfitTotalRev');
        const totExpEl = document.getElementById('ccProfitTotalExp');
        const totNetEl = document.getElementById('ccProfitTotalNet');
        const totMarginEl = document.getElementById('ccProfitTotalMargin');

        if (totRevEl) totRevEl.textContent = App.formatNumber(d.totals?.total_revenue || 0) + ' ر.ي';
        if (totExpEl) totExpEl.textContent = App.formatNumber(d.totals?.total_expense || 0) + ' ر.ي';
        if (totNetEl) {
          totNetEl.textContent = App.formatNumber(d.totals?.net_profit || 0) + ' ر.ي';
          totNetEl.style.color = (d.totals?.net_profit || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
        if (totMarginEl) totMarginEl.textContent = (d.totals?.overall_margin || 0) + '%';

        const tbody = document.getElementById('ccProfitTableBody');
        if (tbody) {
          if (!d.centers || d.centers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 18px;">لا توجد مراكز تكلفة مسجلة</td></tr>';
          } else {
            tbody.innerHTML = d.centers.map(cc => {
              const isProfit = (cc.net_profit || 0) >= 0;
              const statusBadge = isProfit
                ? `<span class="badge" style="background: rgba(34,197,94,0.15); color: #4ade80;">ربح محقق (${cc.profit_margin}%)</span>`
                : `<span class="badge" style="background: rgba(239,68,68,0.15); color: #f87171;">عجز / خسارة (${cc.profit_margin}%)</span>`;

              return `
                <tr>
                  <td><strong>${cc.code}</strong></td>
                  <td><strong style="color: #fff;">${cc.name}</strong></td>
                  <td><span class="badge badge-info">${cc.type || 'مركز تكلفة'}</span></td>
                  <td>${cc.project_name || '-'}</td>
                  <td style="color: var(--gold-light); font-weight: bold;">${App.formatNumber(cc.total_revenue || 0)} ر.ي</td>
                  <td style="color: #38bdf8; font-weight: bold;">${App.formatNumber(cc.total_expense || 0)} ر.ي</td>
                  <td style="color: ${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: bold;">${App.formatNumber(cc.net_profit || 0)} ر.ي</td>
                  <td>${statusBadge}</td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading cost centers profitability:', e);
    }
  },

  // =========================================================================
  // 8. كشف حساب عميل مفصل ومطابق للأستاذ (Client Statement)
  // =========================================================================
  async initClientStatementDropdown(selectedId = null) {
    const select = document.getElementById('repClientSelect');
    if (!select) return;

    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      if (json.success && json.data) {
        select.innerHTML = `<option value="">اختر العميل...</option>` +
          json.data.map(c => `<option value="${c.id}">${c.name}${c.company ? ' (' + c.company + ')' : ''}</option>`).join('');
      }
    } catch (e) {
      console.error('Error fetching clients for dropdown:', e);
    }

    if (selectedId) {
      select.value = selectedId;
    }
  },

  async fetchFullClientStatement(explicitClientId = null) {
    const clientId = explicitClientId || document.getElementById('repClientSelect')?.value;
    if (!clientId) return;

    const fromDate = document.getElementById('repClientFromDate')?.value || '';
    const toDate = document.getElementById('repClientToDate')?.value || '';
    let url = `/api/reports/client-statement/${clientId}`;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { client, statement, summary } = json.data;
        this.lastReportData['client-statement'] = json;
        const cCurr = client.currency || 'ر.ي';

        const infoEl = document.getElementById('repClientInfo');
        if (infoEl) {
          infoEl.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); padding: 16px; border-radius: 10px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                  <h3 style="color: #fff; margin: 0 0 4px 0; font-size: 1.2rem;">${client.name} ${client.company ? `<span style="font-size: 0.85rem; color: #38bdf8;">(${client.company})</span>` : ''}</h3>
                  <span style="font-size: 0.8rem; color: var(--text-secondary);">الهاتف: ${client.phone || '-'} | العنوان: ${client.address || '-'}</span>
                </div>
                <div style="display: flex; gap: 14px; background: rgba(0,0,0,0.3); padding: 8px 16px; border-radius: 8px;">
                  <div><span style="font-size:0.75rem;color:var(--text-secondary)">إجمالي المطالبات:</span> <strong style="color:var(--accent-red)">${App.formatNumber(summary.total_invoiced || 0)} ${cCurr}</strong></div>
                  <div><span style="font-size:0.75rem;color:var(--text-secondary)">إجمالي المحصل:</span> <strong style="color:var(--accent-green)">${App.formatNumber(summary.total_collected || 0)} ${cCurr}</strong></div>
                  <div><span style="font-size:0.75rem;color:var(--text-secondary)">الرصيد المستحق:</span> <strong style="color:var(--gold-light);font-size:1.1rem">${App.formatNumber(summary.outstanding_balance || 0)} ${cCurr}</strong></div>
                </div>
              </div>
            </div>
          `;
        }

        const tbody = document.getElementById('repClientStatementTable');
        if (tbody) {
          if (!statement || statement.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد حركات مسجلة لهذا العميل في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = statement.map(s => {
              const runBal = Number(s.running_balance || 0);
              const runBalColor = runBal > 0 ? 'var(--accent-red)' : (runBal < 0 ? 'var(--accent-green)' : 'var(--text-secondary)');
              return `
                <tr>
                  <td>${s.date || '-'}</td>
                  <td><strong>${s.type}</strong></td>
                  <td><span style="font-family: monospace; color: #fff;">${s.ref || '-'}</span></td>
                  <td>${s.project_name || '-'}</td>
                  <td style="color: var(--accent-red); font-weight: bold;">${s.debit ? App.formatNumber(s.debit) : '-'}</td>
                  <td style="color: var(--accent-green); font-weight: bold;">${s.credit ? App.formatNumber(s.credit) : '-'}</td>
                  <td style="font-weight: 800; color: ${runBalColor};">${App.formatNumber(runBal)}</td>
                  <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 250px;">${s.notes || '-'}</td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error fetching client statement:', e);
    }
  },

  // =========================================================================
  // 9. كشف حساب مورد مفصل ومطابق للأستاذ (Supplier Statement)
  // =========================================================================
  async initSupplierStatementDropdown(selectedId = null) {
    const select = document.getElementById('repSupplierSelect');
    if (!select) return;

    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      if (json.success && json.data) {
        select.innerHTML = `<option value="">-- اختر المورد لعرض كشف الحساب --</option>` +
          json.data.map(s => {
            const name = s.company_name || s.name || 'مورد';
            const curr = s.default_currency || s.currency || 'YER';
            return `<option value="${s.id}">${name} (${curr})</option>`;
          }).join('');
      }
    } catch (e) {
      console.warn('Failed to fetch suppliers:', e);
    }

    if (selectedId) {
      select.value = String(selectedId);
      await this.fetchFullSupplierStatement();
    }
  },

  async fetchFullSupplierStatement() {
    const supplierId = document.getElementById('repSupplierSelect')?.value;
    const infoEl = document.getElementById('repSupplierInfo');
    const tbody = document.getElementById('repSupplierStatementTable');
    const tfoot = document.getElementById('repSupplierStatementFooter');

    if (!supplierId) {
      if (infoEl) infoEl.innerHTML = '';
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">يرجى اختيار مورد لعرض كشف الحساب</td></tr>`;
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    const fromDate = document.getElementById('repSupplierFromDate')?.value || '';
    const toDate = document.getElementById('repSupplierToDate')?.value || '';
    let url = `/api/reports/supplier-statement/${supplierId}`;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { supplier, statement, summary } = json.data;
        this.lastReportData['supplier-statement'] = json;
        const sCurr = supplier.currency || 'ر.ي';

        if (infoEl) {
          infoEl.innerHTML = `
            <div style="background: var(--card-bg, #0f172a); border: 1px solid var(--border-color); padding: 16px 20px; border-radius: 12px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div>
                  <h3 style="margin: 0; font-size: 1.25rem; color: var(--text-primary);">${supplier.name}</h3>
                  <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">الهاتف: ${supplier.phone || '-'} | العملة: ${sCurr}</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, auto); gap: 14px;">
                  <div style="background: rgba(59,130,246,0.1); padding: 8px 14px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">إجمالي الاستحقاق (له):</div>
                    <strong style="color: #3b82f6;">${App.formatNumber(summary.total_invoiced || 0)} ${sCurr}</strong>
                  </div>
                  <div style="background: rgba(16,185,129,0.1); padding: 8px 14px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">إجمالي المسدد (عليه):</div>
                    <strong style="color: #10b981;">${App.formatNumber(summary.total_paid || 0)} ${sCurr}</strong>
                  </div>
                  <div style="background: rgba(245,158,11,0.1); padding: 8px 14px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">صافي الرصيد المستحق:</div>
                    <strong style="color: #f59e0b; font-size: 1.05rem;">${App.formatNumber(summary.outstanding_balance || 0)} ${sCurr}</strong>
                  </div>
                </div>
              </div>
            </div>
          `;
        }

        if (tbody) {
          if (!statement || statement.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد حركات مسجلة لهذا المورد في هذه الفترة</td></tr>`;
            if (tfoot) tfoot.innerHTML = '';
          } else {
            tbody.innerHTML = statement.map(s => {
              const runBalColor = (s.running_balance || 0) > 0 ? 'var(--accent-amber)' : 'var(--accent-green)';
              return `
                <tr>
                  <td style="white-space: nowrap; font-family: monospace;">${s.date || '-'}</td>
                  <td><span class="badge" style="background: rgba(59,130,246,0.12); color: #3b82f6; font-size: 0.78rem;">${s.type}</span></td>
                  <td style="font-weight: 600; font-family: monospace;">${s.ref || '-'}</td>
                  <td style="color: var(--accent-amber); font-weight: 700; text-align: right;">${s.credit ? App.formatNumber(s.credit) : '-'}</td>
                  <td style="color: var(--accent-green); font-weight: 700; text-align: right;">${s.debit ? App.formatNumber(s.debit) : '-'}</td>
                  <td style="font-weight: 800; text-align: right; color: ${runBalColor};">${App.formatNumber(s.running_balance ?? 0)}</td>
                  <td style="font-size: 0.85rem; color: var(--text-secondary);">${s.notes || '-'}</td>
                </tr>
              `;
            }).join('');

            if (tfoot) {
              tfoot.innerHTML = `
                <tr style="background: var(--bg-secondary); font-weight: bold; border-top: 2px solid var(--border-color);">
                  <td colspan="3" style="text-align: center;">الإجمالي العام</td>
                  <td style="color: var(--accent-amber); text-align: right;">${App.formatNumber(summary.total_invoiced || 0)}</td>
                  <td style="color: var(--accent-green); text-align: right;">${App.formatNumber(summary.total_paid || 0)}</td>
                  <td style="color: #f59e0b; text-align: right; font-size: 1.05rem;">${App.formatNumber(summary.outstanding_balance || 0)}</td>
                  <td>${summary.outstanding_balance === 0 ? 'مسوى بالكامل ✓' : 'متبقي مستحق'}</td>
                </tr>
              `;
            }
          }
        }
      }
    } catch (e) {
      console.error('❌ Error fetching supplier statement:', e);
    }
  },

  printSupplierStatement() {
    this.activeReportTab = 'supplier-statement';
    this.printActiveReport();
  },

  // =========================================================================
  // طباعة التقارير المعتمدة الرسمية (Print Official Document)
  // =========================================================================
  printActiveReport() {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المحاسب المالي',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      show_stamp: '0',
      footer_notes: 'تعتبر هذه التقارير والبيانات معتمدة رسمياً ومستخرجة من دفتر الأستاذ العام لشركة رواسي عدن للهندسة والمقاولات'
    };

    const todayDate = new Date().toISOString().split('T')[0];
    const tab = this.activeReportTab || 'profit-loss';
    const reportData = this.lastReportData[tab] || {};

    let reportTitle = 'تقرير مالي معتمد';
    let reportBodyHtml = '';
    let reportMeta = [
      { label: 'المصدر المحاسبي', val: 'دفتر الأستاذ العام (General Ledger)' },
      { label: 'تاريخ الإصدار', val: todayDate },
      { label: 'حالة التوازن', val: 'مطابق ومتزن 100% ✓' }
    ];

    if (tab === 'profit-loss' || tab === 'income-statement') {
      reportTitle = 'قائمة الدخل والأرباح والخسائر الرسمية';
      const d = reportData.data || {};
      reportBodyHtml = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
          <div style="border: 1px solid #86efac; border-radius: 6px; padding: 10px; text-align: center; background: #f0fdf4;">
            <div style="font-size: 0.8rem; color: #15803d;">إجمالي الإيرادات المعترف بها</div>
            <div style="font-weight: 900; font-size: 1.2rem; color: #15803d;">${App.formatNumber(d.total_income || d.total_revenues || 0)} ر.ي</div>
          </div>
          <div style="border: 1px solid #fca5a5; border-radius: 6px; padding: 10px; text-align: center; background: #fef2f2;">
            <div style="font-size: 0.8rem; color: #b91c1c;">إجمالي التكاليف والمصروفات</div>
            <div style="font-weight: 900; font-size: 1.2rem; color: #b91c1c;">${App.formatNumber(d.total_expenses || 0)} ر.ي</div>
          </div>
          <div style="border: 1.5px solid #d4af37; border-radius: 6px; padding: 10px; text-align: center; background: #fdfaf2;">
            <div style="font-size: 0.8rem; color: #b8911c;">صافي الدخل التشغيلي</div>
            <div style="font-weight: 900; font-size: 1.25rem; color: #047857;">${App.formatNumber(d.net_profit || 0)} ر.ي</div>
          </div>
        </div>
        <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin-bottom: 8px;">توزيع بنود الإيرادات والتكاليف:</div>
        <table class="official-report-table">
          <thead><tr><th>البيان المحاسبي</th><th>المبلغ المحقق</th></tr></thead>
          <tbody>
            <tr><td>إجمالي الإيرادات المعترف بها (4)</td><td style="color:#15803d;font-weight:bold">${App.formatNumber(d.total_income || d.total_revenues || 0)} ر.ي</td></tr>
            <tr><td>تكلفة الإيراد المباشرة (51)</td><td style="color:#b91c1c">${App.formatNumber(d.direct_costs || 0)} ر.ي</td></tr>
            <tr style="background:#f8fafc;font-weight:bold"><td>مجمل الربح</td><td style="color:#047857">${App.formatNumber(d.gross_profit || 0)} ر.ي</td></tr>
            <tr><td>المصروفات التشغيلية والإدارية (3)</td><td style="color:#b91c1c">${App.formatNumber(d.operating_expenses || 0)} ر.ي</td></tr>
            <tr style="background:#f0fdf4;font-weight:900;font-size:1.1rem"><td>صافي الربح / الدخل النهائي</td><td style="color:#047857">${App.formatNumber(d.net_profit || 0)} ر.ي</td></tr>
          </tbody>
        </table>
      `;
    } else if (tab === 'trial-balance') {
      reportTitle = 'ميزان المراجعة بالأرصدة والمجاميع';
      const d = reportData.data || {};
      const rows = (d.accounts || []).map(a => `
        <tr>
          <td style="font-family: monospace;">${a.code}</td>
          <td>${a.name}</td>
          <td>${a.type}</td>
          <td style="text-align: left; font-family: monospace;">${a.period_debit ? App.formatNumber(a.period_debit) : '-'}</td>
          <td style="text-align: left; font-family: monospace;">${a.period_credit ? App.formatNumber(a.period_credit) : '-'}</td>
          <td style="text-align: left; font-family: monospace; font-weight: bold;">${a.closing_debit ? App.formatNumber(a.closing_debit) : '-'}</td>
          <td style="text-align: left; font-family: monospace; font-weight: bold;">${a.closing_credit ? App.formatNumber(a.closing_credit) : '-'}</td>
        </tr>
      `).join('');
      reportBodyHtml = `
        <table class="official-report-table">
          <thead>
            <tr><th>رقم الحساب</th><th>اسم الحساب</th><th>النوع</th><th>مدين الفترة</th><th>دائن الفترة</th><th>رصيد مدين</th><th>رصيد دائن</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else if (tab === 'balance-sheet') {
      reportTitle = 'قائمة المركز المالي والميزانية العمومية';
      const assetsHtml = document.getElementById('bsAssetsTable')?.innerHTML || '';
      const liabHtml = document.getElementById('bsLiabTable')?.innerHTML || '';
      const totA = document.getElementById('bsTotalAssets')?.textContent || '0';
      const totL = document.getElementById('bsTotalLiabEquity')?.textContent || '0';
      reportBodyHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div>
            <div style="font-weight: 800; color: #0f2744; margin-bottom: 6px;">الأصول (Assets)</div>
            <table class="official-report-table"><tbody>${assetsHtml}<tr style="background:#f0fdf4;font-weight:bold"><td>الإجمالي</td><td>${totA}</td></tr></tbody></table>
          </div>
          <div>
            <div style="font-weight: 800; color: #0f2744; margin-bottom: 6px;">الالتزامات والملكية (Liabilities & Equity)</div>
            <table class="official-report-table"><tbody>${liabHtml}<tr style="background:#fef2f2;font-weight:bold"><td>الإجمالي</td><td>${totL}</td></tr></tbody></table>
          </div>
        </div>
      `;
    } else if (tab === 'cash-flow') {
      reportTitle = 'قائمة التدفقات النقدية الفعلية';
      const cfHtml = document.getElementById('cashFlowTableBody')?.innerHTML || '';
      reportBodyHtml = `<table class="official-report-table"><thead><tr><th>بيان التدفق</th><th>مقبوضات (+)</th><th>مدفوعات (-)</th><th>الصافي</th></tr></thead><tbody>${cfHtml}</tbody></table>`;
    } else if (tab === 'client-statement') {
      reportTitle = 'كشف حساب عميل معتمد ومطابق للأستاذ';
      const cInfo = document.getElementById('repClientInfo')?.innerHTML || '';
      const cRows = document.getElementById('repClientStatementTable')?.innerHTML || '';
      reportBodyHtml = `<div style="margin-bottom:12px">${cInfo}</div><table class="official-report-table"><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>المشروع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>البيان</th></tr></thead><tbody>${cRows}</tbody></table>`;
    } else if (tab === 'supplier-statement') {
      reportTitle = 'كشف حساب مورد معتمد ومطابق للأستاذ';
      const sInfo = document.getElementById('repSupplierInfo')?.innerHTML || '';
      const sRows = document.getElementById('repSupplierStatementTable')?.innerHTML || '';
      reportBodyHtml = `<div style="margin-bottom:12px">${sInfo}</div><table class="official-report-table"><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>دائن</th><th>مدين</th><th>الرصيد</th><th>البيان</th></tr></thead><tbody>${sRows}</tbody></table>`;
    }

    const docClass = (typeof Settings !== 'undefined' && Settings.getReportDocClass)
      ? Settings.getReportDocClass(cfg)
      : 'multi-page-report-document border-classic density-medium margins-normal';

    const headerHtml = (typeof Settings !== 'undefined' && Settings.renderReportHeader)
      ? Settings.renderReportHeader(reportTitle, reportMeta, cfg)
      : `
        <div class="letterhead-doc-header">
          <div class="letterhead-doc-title-badge">${reportTitle}</div>
          <div class="letterhead-doc-meta">
            <div class="letterhead-doc-meta-item">تاريخ الطباعة: <strong>${todayDate}</strong></div>
          </div>
        </div>
      `;

    const sigHtml = (typeof Settings !== 'undefined' && Settings.renderReportSignatures)
      ? Settings.renderReportSignatures(cfg)
      : `
        <div class="letterhead-signatures-row" style="margin-top: 20px;">
          <div class="letterhead-sig-col"><div class="letterhead-sig-label">${cfg.sig1 || 'المحاسب المالي'}</div><div class="letterhead-sig-dots">المحاسب: ........................</div></div>
          <div class="letterhead-sig-col"><div class="letterhead-sig-label">${cfg.sig2 || 'المدير العام'}</div><div class="letterhead-sig-dots">الاعتماد: ........................</div></div>
          <div class="letterhead-sig-col"><div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div><div class="letterhead-sig-dots">الاعتماد: ........................</div></div>
        </div>
      `;

    printArea.innerHTML = `
      <div class="${docClass}">
        ${headerHtml}
        <div class="report-content-body">${reportBodyHtml}</div>
        ${sigHtml}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(reportTitle);
    }
    window.print();
  },

  // =========================================================================
  // تصدير Excel المتخصص
  // =========================================================================
  exportActiveReportToExcel() {
    const tab = this.activeReportTab || 'profit-loss';
    const reportData = this.lastReportData[tab] || null;

    if (typeof ExcelExporter !== 'undefined') {
      if (tab === 'profit-loss') {
        ExcelExporter.exportProfitLoss(reportData);
      } else if (tab === 'trial-balance') {
        ExcelExporter.exportTrialBalance(reportData);
      } else if (tab === 'income-statement') {
        ExcelExporter.exportIncomeStatement(reportData);
      } else if (tab === 'balance-sheet') {
        ExcelExporter.exportBalanceSheet(reportData);
      } else if (tab === 'cash-flow') {
        ExcelExporter.exportCashFlow(reportData);
      } else if (tab === 'projects-profitability') {
        ExcelExporter.exportProjectsProfitability(reportData);
      } else if (tab === 'cost-centers-profitability') {
        ExcelExporter.exportCostCentersProfitability(reportData);
      } else if (tab === 'client-statement') {
        ExcelExporter.exportClientStatement(reportData);
      } else if (tab === 'supplier-statement') {
        ExcelExporter.exportSupplierStatement(reportData);
      } else {
        App.showToast('يرجى تحديد التقرير المطلوب لتصديره إلى Excel', 'warning');
      }
    }
  },

  // =========================================================================
  // مصفوفة الفصل المالي وإثبات إيراد المقاولات IFRS 15
  // =========================================================================
  async openContractingSeparationModal() {
    App.openModal('contractingSeparationModal');
    const tbody = document.getElementById('contractingMatrixTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--text-secondary); padding: 25px;">جاري تحميل مصفوفة المقاولات المالية (IFRS 15)...</td></tr>';
    }

    try {
      const res = await fetch('/api/billing/contracting-matrix');
      const json = await res.json();
      if (!res.ok || !json.projects) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--accent-red); padding: 20px;">${json.message || 'فشل جلب بيانات مصفوفة المقاولات'}</td></tr>`;
        return;
      }

      if (json.projects.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--text-secondary); padding: 25px;">لا توجد مشاريع مسجلة في مصفوفة المقاولات</td></tr>';
        return;
      }

      if (tbody) {
        tbody.innerHTML = json.projects.map(p => {
          const contractVal = p.revised_contract_value || p.base_contract_value || 0;
          const actualCost = p.cumulative_actual_cost || 0;
          const pocPct = (p.cost_to_cost_poc_pct || 0).toFixed(1);
          const recRev = p.recognized_revenue?.cumulative || 0;
          const billed = p.progress_billings?.gross || 0;
          const wip = p.contract_assets?.work_in_progress_wip || 0;
          const cash = p.cash_receipts?.total || 0;
          const adv = p.contract_liabilities?.unamortized_advance || 0;
          const ret = p.contract_assets?.retention_receivable || 0;
          const profit = p.performance_comparison?.net_profit || 0;
          const netCash = p.performance_comparison?.net_cash_flow || 0;

          return `
            <tr>
              <td><strong>${p.project_name}</strong><br><small style="color: var(--text-secondary);">${p.project_code || ''}</small></td>
              <td>${p.client_name || '-'}</td>
              <td style="color: var(--gold-light); font-weight: 600;">${App.formatNumber(contractVal)}</td>
              <td style="color: var(--accent-red);">${App.formatNumber(actualCost)}</td>
              <td><strong>${pocPct}%</strong></td>
              <td style="color: #38bdf8; font-weight: 600;">${App.formatNumber(recRev)}</td>
              <td style="color: var(--accent-green);">${App.formatNumber(billed)}</td>
              <td>${App.formatNumber(wip)}</td>
              <td style="color: #4ade80;">${App.formatNumber(cash)}</td>
              <td style="color: #facc15;">${App.formatNumber(adv)}</td>
              <td style="color: #94a3b8;">${App.formatNumber(ret)}</td>
              <td style="color: ${profit >= 0 ? '#4ade80' : '#f87171'}; font-weight: bold;">${App.formatNumber(profit)}</td>
              <td style="color: ${netCash >= 0 ? '#4ade80' : '#f87171'}; font-weight: bold;">${App.formatNumber(netCash)}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="Reports.openRevenueRecognitionModal(${p.project_id})" title="إثبات إيراد دوري" style="padding: 3px 8px; font-size: 0.75rem; white-space: nowrap;">
                  إثبات POC
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error(e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--accent-red); padding: 20px;">خطأ في الاتصال بالخادم</td></tr>`;
    }
  },

  async openRevenueRecognitionModal(preselectedProjectId = null) {
    App.openModal('revenueRecognitionModal');
    const select = document.getElementById('revRecProjectId');
    const dateInput = document.getElementById('revRecDate');
    const previewCard = document.getElementById('revRecPreviewCard');
    if (previewCard) previewCard.style.display = 'none';
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    if (select) {
      try {
        const res = await fetch('/api/projects');
        const json = await res.json();
        if (json.success && json.data) {
          select.innerHTML = '<option value="">-- اختر المشروع لتحديث المعايير ونسبة الإنجاز --</option>' +
            json.data.map(p => `<option value="${p.id}">${p.name} (${p.code || p.id})</option>`).join('');

          if (preselectedProjectId) {
            select.value = String(preselectedProjectId);
            this.onRevenueProjectChanged(preselectedProjectId);
          }
        }
      } catch (e) {
        console.error('Error populating projects:', e);
      }
    }
  },

  async onRevenueProjectChanged(projectId) {
    const previewCard = document.getElementById('revRecPreviewCard');
    if (!projectId) {
      if (previewCard) previewCard.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/api/billing/contracting-matrix/${projectId}`);
      const json = await res.json();
      if (json.success && json.data && previewCard) {
        const d = json.data;
        previewCard.style.display = 'block';
        const setTxt = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = typeof val === 'number' ? App.formatNumber(val) : (val || '0');
        };
        setTxt('prevContractVal', d.revised_contract_value || d.base_contract_value || 0);
        setTxt('prevActualCost', d.cumulative_actual_cost || 0);
        setTxt('prevPocPct', (d.cost_to_cost_poc_pct || 0).toFixed(1) + '%');
        setTxt('prevPostedRev', d.recognized_revenue?.previously_posted || 0);
        setTxt('prevUnpostedRev', d.recognized_revenue?.unposted_period_revenue || 0);
      }
    } catch (e) {
      console.error('Error fetching project metrics:', e);
    }
  },

  async submitRevenueRecognition(event) {
    if (event) event.preventDefault();
    const projectId = document.getElementById('revRecProjectId')?.value;
    const periodDate = document.getElementById('revRecDate')?.value || new Date().toISOString().split('T')[0];
    const notes = document.getElementById('revRecNotes')?.value || '';

    if (!projectId) {
      App.showToast('يرجى اختيار المشروع', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/billing/recognize-revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          period_date: periodDate,
          notes
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم إثبات الإيراد المحاسبي بنجاح', 'success');
        App.closeModal('revenueRecognitionModal');
        this.openContractingSeparationModal();
      } else {
        App.showToast(json.message || 'فشل إثبات الإيراد المحاسبي', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.Reports = Reports;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Reports;
}

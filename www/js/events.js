/**
 * محرك تفويض الأحداث الموحد (Declarative Event Delegation Engine)
 * يستبدل سمات onclick المباشرة بنظام تفويض أحداث مركزي نظيف ومتوافق مع معايير CSP
 */

(function () {
  'use strict';

  const ActionDispatcher = {
    handlers: {},

    /**
     * تسجيل معالج إجراء مخصص
     */
    register(actionName, handler) {
      this.handlers[actionName] = handler;
    },

    /**
     * تنفيذ إجراء
     */
    dispatch(actionName, element, event) {
      if (typeof this.handlers[actionName] === 'function') {
        try {
          this.handlers[actionName](element, event);
        } catch (err) {
          console.error(`[ActionDispatcher] خطأ أثناء تنفيذ الإجراء '${actionName}':`, err);
        }
        return true;
      }
      return false;
    },

    init() {
      // 1. تفويض أحداث النقر (Click Delegation)
      document.addEventListener('click', (event) => {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.action;
        if (!action) return;

        // تنفيذ الإجراءات المعيارية
        switch (action) {
          case 'navigate': {
            const view = actionEl.dataset.view;
            if (view && window.App && typeof App.navigate === 'function') {
              event.preventDefault();
              App.navigate(view, actionEl);
            }
            break;
          }

          case 'navigate-deep': {
            const view = actionEl.dataset.view;
            const tab = actionEl.dataset.tab;
            if (view && window.App && typeof App.navigateDeep === 'function') {
              event.preventDefault();
              App.navigateDeep(view, tab, actionEl);
            }
            break;
          }

          case 'open-modal': {
            const modalId = actionEl.dataset.modal;
            if (modalId && window.App && typeof App.openModal === 'function') {
              event.preventDefault();
              App.openModal(modalId);
            }
            break;
          }

          case 'close-modal': {
            event.preventDefault();
            const modalId = actionEl.dataset.modal;
            if (modalId && window.App && typeof App.closeModal === 'function') {
              App.closeModal(modalId);
            } else {
              const overlay = actionEl.closest('.modal-overlay');
              if (overlay && window.App && typeof App.closeModal === 'function') {
                App.closeModal(overlay.id);
              }
            }
            break;
          }

          case 'toggle-sidebar': {
            if (window.App && typeof App.toggleMobileSidebar === 'function') {
              App.toggleMobileSidebar();
            }
            break;
          }

          case 'toggle-theme': {
            if (window.App && typeof App.toggleTheme === 'function') {
              App.toggleTheme();
            }
            break;
          }

          case 'print-report': {
            if (window.Reports && typeof Reports.printActiveReport === 'function') {
              Reports.printActiveReport();
            }
            break;
          }

          case 'close-period-modal': {
            const pId = actionEl.dataset.periodId;
            const pName = actionEl.dataset.periodName;
            if (window.Accounting && typeof Accounting.openClosePeriodModal === 'function') {
              Accounting.openClosePeriodModal(pId, pName);
            }
            break;
          }

          case 'reopen-period': {
            const pId = actionEl.dataset.periodId;
            if (window.Accounting && typeof Accounting.reopenPeriod === 'function') {
              Accounting.reopenPeriod(pId);
            }
            break;
          }

          case 'statutory-rules': {
            if (window.HR && typeof HR.showStatutoryRulesModal === 'function') {
              HR.showStatutoryRulesModal();
            }
            break;
          }

          case 'preview-payroll-journal': {
            if (window.HR && typeof HR.postPayrollToJournal === 'function') {
              HR.postPayrollToJournal();
            }
            break;
          }

          case 'auto-balance': {
            if (window.Accounting && typeof Accounting.autoBalanceJournal === 'function') {
              Accounting.autoBalanceJournal();
            }
            break;
          }

          case 'filter-audit-logs': {
            if (window.Accounting && typeof Accounting.loadAuditLogs === 'function') {
              Accounting.loadAuditLogs();
            }
            break;
          }

          default:
            this.dispatch(action, actionEl, event);
            break;
        }
      });

      // 2. تفويض أحداث الإرسال للنماذج (Submit Delegation)
      document.addEventListener('submit', (event) => {
        const form = event.target;
        const submitAction = form.dataset.action;
        if (!submitAction) return;

        event.preventDefault();
        this.dispatch(submitAction, form, event);
      });

      console.log('⚡ [EventDelegation] تم تفعيل محرك تفويض الأحداث المركزي بنجاح');
    }
  };

  window.UI = window.UI || {};
  window.UI.ActionDispatcher = ActionDispatcher;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ActionDispatcher.init());
  } else {
    ActionDispatcher.init();
  }
})();

/**
 * bankReconciliationService.js
 * 
 * محرك التسويات البنكية ومحفظة الشيكات (Enterprise Bank Reconciliation & Cheques Suite)
 * يدعم:
 *  1. استيراد وتخزين كشوف حسابات البنوك الدورية
 *  2. خوارزمية المطابقة الآلية الذكية (Auto-Reconciliation Engine)
 *  3. تسجيل العمولات والمصاريف البنكية وفروق التسوية بقيود يومية متزنة
 *  4. محفظة الشيكات الصادرة والواردة وتتبع الشيكات المرتجعة (Bounced Cheques)
 *  5. إعداد مذكرة التسوية البنكية الشهرية المعتمدة (Bank Reconciliation Statement - BRS)
 */

const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const { assertPeriodOpen, resolveValidUserId } = require('./financialControlService');

const BANK_ACCOUNTS = {
  BANK_GL_ACCOUNT: 3,         // 111 - حـ/ الصندوق والبنك الرئيسي
  BANK_CHARGES_EXPENSE: 26,   // 5210 - عمولات ومصاريف بنكية عامة
  CHEQUES_UNDER_COLLECTION: 4, // ذمم مدينة / أوراق قبض
  SUPPLIER_PAYABLES: 7        // ذمم دائنة / موردين
};

const BankReconciliationService = {
  BANK_ACCOUNTS,

  /**
   * استيراد كشف حساب البنك وتسجيل حركاته
   */
  async importBankStatement(data, req = null) {
    const {
      bank_account_id,
      statement_date = new Date().toISOString().split('T')[0],
      opening_balance = 0,
      closing_balance = 0,
      currency = 'ر.ي',
      lines = [],
      user
    } = data;

    if (!bank_account_id) throw new Error('يرجى تحديد الحساب البنكي المرتبط');
    if (!lines || lines.length === 0) throw new Error('يجب تضمين أسطر حركات كشف الحساب');

    await assertPeriodOpen(statement_date);
    const userId = await resolveValidUserId(user?.id);

    return await transaction(async (tx) => {
      const stmtRes = await tx.run(`
        INSERT INTO bank_statements (
          bank_account_id, statement_date, opening_balance, closing_balance,
          currency, status, imported_by
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?)
      `, [
        bank_account_id, statement_date, Number(opening_balance),
        Number(closing_balance), currency, userId
      ]);

      const statementId = stmtRes.lastInsertRowid || stmtRes.insertId;

      for (const line of lines) {
        await tx.run(`
          INSERT INTO bank_statement_lines (
            statement_id, transaction_date, value_date, description,
            reference_no, debit, credit, balance, is_reconciled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `, [
          statementId, line.transaction_date || statement_date, line.value_date || null,
          line.description || 'حركة بنكية', line.reference_no || null,
          Number(line.debit) || 0, Number(line.credit) || 0, Number(line.balance) || 0
        ]);
      }

      if (req) {
        await logAudit(req, {
          action: 'IMPORT_BANK_STATEMENT',
          entity_type: 'bank_statement',
          entity_id: `STMT-${statementId}`,
          details: { statementId, bank_account_id, lines_count: lines.length, closing_balance }
        });
      }

      return {
        statement_id: statementId,
        lines_count: lines.length,
        status: 'draft'
      };
    });
  },

  /**
   * المطابقة الآلية الذكية بين كشف البنك وحركات الدفاتر (Auto-Reconciliation)
   */
  async autoMatchStatementLines(statementId, toleranceDays = 5, user = null, req = null) {
    const stmt = await get('SELECT * FROM bank_statements WHERE id = ?', [statementId]);
    if (!stmt) throw new Error('كشف الحساب البنكي غير موجود');

    const lines = await query('SELECT * FROM bank_statement_lines WHERE statement_id = ? AND is_reconciled = 0', [statementId]);
    let matchedCount = 0;

    for (const line of lines) {
      // إذا كانت الحركة إيداع بالبنك (credit في كشف البنك) -> ابحث في سندات القبض الدفترية
      if (Number(line.credit) > 0) {
        const creditAmt = Number(line.credit);
        const matchPayment = await get(`
          SELECT * FROM payments 
          WHERE type = 'قبض' AND amount = ? AND status = 'posted'
          AND abs(julianday(?) - julianday(date)) <= ?
          LIMIT 1
        `, [creditAmt, line.transaction_date, toleranceDays]);

        if (matchPayment) {
          await run(`
            UPDATE bank_statement_lines 
            SET is_reconciled = 1, matched_entity_type = 'payment', matched_entity_id = ?, matched_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [matchPayment.receipt_no, line.id]);
          matchedCount++;
          continue;
        }
      }

      // إذا كانت الحركة سحب من البنك (debit في كشف البنك) -> ابحث في سندات الصرف والمصروفات
      if (Number(line.debit) > 0) {
        const debitAmt = Number(line.debit);
        const matchExpense = await get(`
          SELECT * FROM expenses 
          WHERE amount = ? AND status = 'posted'
          AND abs(julianday(?) - julianday(date)) <= ?
          LIMIT 1
        `, [debitAmt, line.transaction_date, toleranceDays]);

        if (matchExpense) {
          await run(`
            UPDATE bank_statement_lines 
            SET is_reconciled = 1, matched_entity_type = 'expense', matched_entity_id = ?, matched_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [matchExpense.receipt_no, line.id]);
          matchedCount++;
          continue;
        }
      }
    }

    if (req) {
      await logAudit(req, {
        action: 'AUTO_RECONCILE',
        entity_type: 'bank_statement',
        entity_id: `STMT-${statementId}`,
        details: { statementId, total_lines: lines.length, matchedCount }
      });
    }

    return {
      statement_id: statementId,
      total_lines: lines.length,
      matched_count: matchedCount,
      unmatched_count: lines.length - matchedCount
    };
  },

  /**
   * تسجيل العمولات والمصاريف البنكية بقيد يومية متزن آلياً
   */
  async recordBankCharge(data, req = null) {
    const {
      bank_account_id,
      amount,
      fee_type = 'عمولة مصرفية',
      reference_no,
      date = new Date().toISOString().split('T')[0],
      notes,
      user
    } = data;

    if (!bank_account_id || !amount || Number(amount) <= 0) {
      throw new Error('يرجى تحديد الحساب البنكي ومبلغ العمولة الإيجابي');
    }

    await assertPeriodOpen(date);
    const userId = await resolveValidUserId(user?.id);
    const parsedAmount = Number(amount);

    return await transaction(async (tx) => {
      const bankAcct = await tx.get('SELECT * FROM bank_accounts WHERE id = ?', [bank_account_id]);
      if (!bankAcct) throw new Error('الحساب البنكي غير موجود');

      // 1. توليد قيد اليومية: من حـ/ عمولات ومصاريف بنكية (5210) إلى حـ/ البنك
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'عمولة بنكية', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, date, `إثبات ${fee_type} لحساب (${bankAcct.bank_name}) - ${notes || reference_no || ''}`,
        parsedAmount, parsedAmount, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      // سطر مدين: مصاريف وعمولات بنكية
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?)
      `, [entryId, BANK_ACCOUNTS.BANK_CHARGES_EXPENSE, parsedAmount, `مدين: ${fee_type}`]);

      // سطر دائن: تخفيض رصيد البنك
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, 0, ?, ?)
      `, [entryId, bankAcct.account_id || BANK_ACCOUNTS.BANK_GL_ACCOUNT, parsedAmount, `دائن: خصم من رصيد البنك`]);

      // 2. تحديث رصيد الحساب البنكي
      await tx.run('UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?', [parsedAmount, bank_account_id]);

      if (req) {
        await logAudit(req, {
          action: 'RECORD_BANK_CHARGE',
          entity_type: 'bank_charge',
          entity_id: entry_no,
          details: { bank_account_id, amount: parsedAmount, fee_type, entry_no }
        });
      }

      return {
        success: true,
        entry_no,
        amount: parsedAmount,
        message: 'تم تسجيل العمولة البنكية وترحيل قيدها المحاسبي بنجاح'
      };
    });
  },

  /**
   * تسجيل شيك جديد في محفظة الشيكات (صادر أو وارد)
   */
  async createCheque(data, req = null) {
    const {
      cheque_no,
      type = 'issued', // 'issued' (صادر لمورد) أو 'received' (وارد من عميل)
      bank_account_id,
      drawer_name,
      beneficiary_name,
      amount,
      currency = 'ر.ي',
      issue_date = new Date().toISOString().split('T')[0],
      due_date,
      project_id,
      client_id,
      supplier_id,
      notes,
      user
    } = data;

    if (!cheque_no || !beneficiary_name || !amount || Number(amount) <= 0) {
      throw new Error('يرجى تحديد رقم الشيك، المستفيد، والمبلغ الصحيح');
    }

    const parsedAmount = Number(amount);
    const initialStatus = type === 'issued' ? 'issued' : 'received';

    const result = await run(`
      INSERT INTO cheques (
        cheque_no, type, bank_account_id, drawer_name, beneficiary_name,
        amount, currency, issue_date, due_date, status, project_id,
        client_id, supplier_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cheque_no, type, bank_account_id || null, drawer_name || '', beneficiary_name,
      parsedAmount, currency, issue_date, due_date || issue_date, initialStatus,
      project_id || null, client_id || null, supplier_id || null, notes || ''
    ]);

    const chequeId = result.lastInsertRowid || result.insertId;

    if (req) {
      await logAudit(req, {
        action: 'CREATE_CHEQUE',
        entity_type: 'cheque',
        entity_id: cheque_no,
        details: { cheque_no, type, amount: parsedAmount, beneficiary_name, status: initialStatus }
      });
    }

    return {
      id: chequeId,
      cheque_no,
      type,
      amount: parsedAmount,
      status: initialStatus
    };
  },

  /**
   * معالجة الشيك المرتجع (Bounced Cheque) وتوليد قيد التصحيح
   */
  async processBouncedCheque(chequeId, bounceData, req = null) {
    const {
      bounce_reason = 'عدم كفاية الرصيد',
      bounce_date = new Date().toISOString().split('T')[0],
      user
    } = bounceData;

    const cheque = await get('SELECT * FROM cheques WHERE id = ?', [chequeId]);
    if (!cheque) throw new Error('الشيك غير موجود في النظام');
    if (cheque.status === 'bounced') throw new Error('الشيك مسجل كمرتجع مسبقاً');

    await assertPeriodOpen(bounce_date);
    const userId = await resolveValidUserId(user?.id);

    return await transaction(async (tx) => {
      // 1. توليد قيد عكسي للشيك المرتجع
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entry_no = `JV-${new Date().getFullYear()}-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(4, '0')}`;

      const jvRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, total_debit, total_credit,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, 'شيك مرتجع', ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entry_no, bounce_date, `قيد شيك مرتجع رقم (${cheque.cheque_no}) - السبب: ${bounce_reason}`,
        cheque.amount, cheque.amount, userId, user?.username || 'المحاسب', userId, user?.username || 'المحاسب'
      ]);

      const entryId = jvRes.lastInsertRowid || jvRes.insertId;

      if (cheque.type === 'received') {
        // شيك وارد من عميل ارتد: إعادة فتح مديونية العميل (مدين) وتخفيض البنك/أوراق القبض (دائن)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?)
        `, [entryId, BANK_ACCOUNTS.CHEQUES_UNDER_COLLECTION, cheque.amount, `مدين: إعادة إثبات مديونية العميل بسبب ارتداد الشيك ${cheque.cheque_no}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, 0, ?, ?)
        `, [entryId, BANK_ACCOUNTS.BANK_GL_ACCOUNT, cheque.amount, `دائن: تخفيض رصيد البنك المحصل مؤقتاً`]);

        if (cheque.client_id) {
          await tx.run('UPDATE clients SET current_balance = current_balance + ? WHERE id = ?', [cheque.amount, cheque.client_id]);
        }
      } else {
        // شيك صادر لمورد ارتد: زيادة البنك (مدين) وإعادة إثبات التزام المورد (دائن)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, ?, 0, ?)
        `, [entryId, BANK_ACCOUNTS.BANK_GL_ACCOUNT, cheque.amount, `مدين: استعادة رصيد البنك للشيك المرتجع ${cheque.cheque_no}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, 0, ?, ?)
        `, [entryId, BANK_ACCOUNTS.SUPPLIER_PAYABLES, cheque.amount, `دائن: إعادة إثبات استحقاق المورد`]);

        if (cheque.supplier_id) {
          await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [cheque.amount, cheque.supplier_id]);
        }
      }

      // 2. تحديث حالة الشيك
      await tx.run(`
        UPDATE cheques
        SET status = 'bounced', bounce_date = ?, bounce_reason = ?, journal_entry_id = ?
        WHERE id = ?
      `, [bounce_date, bounce_reason, entryId, chequeId]);

      if (req) {
        await logAudit(req, {
          action: 'BOUNCE_CHEQUE',
          entity_type: 'cheque',
          entity_id: cheque.cheque_no,
          details: { chequeId, cheque_no: cheque.cheque_no, bounce_reason, entry_no }
        });
      }

      return {
        id: chequeId,
        cheque_no: cheque.cheque_no,
        status: 'bounced',
        journal_entry_no: entry_no,
        message: `تم توثيق ارتداد الشيك وتوليد قيد التصحيح ${entry_no} وإعادة فتح الذمة بنجاح`
      };
    });
  },

  /**
   * إعداد مذكرة التسوية البنكية الشهرية المعتمدة (Bank Reconciliation Statement - BRS)
   */
  async generateBankReconciliationStatement(bankAccountId, statementId, periodDate, user = null, req = null) {
    const bankAcct = await get('SELECT * FROM bank_accounts WHERE id = ?', [bankAccountId]);
    if (!bankAcct) throw new Error('الحساب البنكي غير موجود');

    const stmt = await get('SELECT * FROM bank_statements WHERE id = ?', [statementId]);
    if (!stmt) throw new Error('كشف حساب البنك غير موجود');

    // 1. رصيد البنك بموجب كشف الحساب
    const bankStatementBalance = Number(stmt.closing_balance) || 0;

    // 2. رصيد البنك بموجب الدفاتر المحاسبية
    const bookBalance = Number(bankAcct.current_balance) || 0;

    // 3. إيداعات بالطريق (حركات بالدفاتر لم تظهر في كشف البنك)
    const uncreditedDepositsRes = await get(`
      SELECT COALESCE(SUM(credit), 0) as total_uncredited
      FROM bank_statement_lines
      WHERE statement_id = ? AND is_reconciled = 0 AND credit > 0
    `, [statementId]);
    const depositsInTransit = Number(uncreditedDepositsRes?.total_uncredited) || 0;

    // 4. شيكات صادرة لم تصرف بعد (حركات بالدفاتر لم تُسحب من البنك بعد)
    const unpresentedChequesRes = await get(`
      SELECT COALESCE(SUM(amount), 0) as total_unpresented
      FROM cheques
      WHERE bank_account_id = ? AND type = 'issued' AND status = 'issued'
    `, [bankAccountId]);
    const outstandingCheques = Number(unpresentedChequesRes?.total_unpresented) || 0;

    // 5. مصاريف وعمولات بنكية غير مسجلة بالدفاتر
    const unrecordedChargesRes = await get(`
      SELECT COALESCE(SUM(debit), 0) as total_charges
      FROM bank_statement_lines
      WHERE statement_id = ? AND is_reconciled = 0 AND debit > 0
    `, [statementId]);
    const bankChargesUnrecorded = Number(unrecordedChargesRes?.total_charges) || 0;

    // حساب الرصيدين المعدلين:
    // الرصيد المعدل للبنك = رصيد الكشف + إيداعات بالطريق - شيكات لم تصرف
    const adjustedBankBalance = bankStatementBalance + depositsInTransit - outstandingCheques;

    // الرصيد المعدل للدفاتر = رصيد الدفاتر - العمولات غير المسجلة
    const adjustedBookBalance = bookBalance - bankChargesUnrecorded;

    // الفارق (يجب أن يساوي 0.00 للتطابق التام)
    const variance = adjustedBankBalance - adjustedBookBalance;
    const isBalanced = Math.abs(variance) < 0.01;

    const countRes = await get('SELECT COUNT(*) as cnt FROM bank_reconciliations');
    const reconciliation_no = `BRS-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    const userId = user ? await resolveValidUserId(user?.id) : null;

    const brsRes = await run(`
      INSERT INTO bank_reconciliations (
        reconciliation_no, bank_account_id, statement_id, reconciliation_date,
        bank_statement_balance, book_balance, deposits_in_transit, outstanding_cheques,
        bank_charges_unrecorded, adjusted_bank_balance, adjusted_book_balance,
        variance, status, prepared_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      reconciliation_no, bankAccountId, statementId, periodDate,
      bankStatementBalance, bookBalance, depositsInTransit, outstandingCheques,
      bankChargesUnrecorded, adjustedBankBalance, adjustedBookBalance,
      variance, isBalanced ? 'balanced' : 'variance_flagged', userId
    ]);

    if (req) {
      await logAudit(req, {
        action: 'GENERATE_BRS',
        entity_type: 'bank_reconciliation',
        entity_id: reconciliation_no,
        details: { reconciliation_no, bankAccountId, bankStatementBalance, bookBalance, variance, isBalanced }
      });
    }

    return {
      id: brsRes.lastInsertRowid || brsRes.insertId,
      reconciliation_no,
      bank_name: bankAcct.bank_name,
      account_number: bankAcct.account_number,
      bank_statement_balance: bankStatementBalance,
      book_balance: bookBalance,
      deposits_in_transit: depositsInTransit,
      outstanding_cheques: outstandingCheques,
      bank_charges_unrecorded: bankChargesUnrecorded,
      adjusted_bank_balance: adjustedBankBalance,
      adjusted_book_balance: adjustedBookBalance,
      variance: variance,
      is_balanced: isBalanced,
      status: isBalanced ? 'balanced' : 'variance_flagged'
    };
  }
};

module.exports = BankReconciliationService;

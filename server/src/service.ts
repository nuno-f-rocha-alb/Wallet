import type { DatabaseSync } from 'node:sqlite';
import type {
  Account,
  Category,
  CategoryTotal,
  DashboardResponse,
  Transaction,
  Transfer,
} from '@wallet/shared';
import { HttpError } from './errors.js';

type Row = Record<string, unknown>;
const one = <T>(r: unknown): T => r as T;
const rows = <T>(r: unknown[]): T[] => r as T[];

// ---- mappers (snake_case row -> camelCase DTO) ----

function toAccount(r: Row): Account {
  return {
    id: r.id as number,
    name: r.name as string,
    type: r.type as Account['type'],
    currency: r.currency as string,
    openingBalanceCents: r.opening_balance_cents as number,
    creditLimitCents: (r.credit_limit_cents as number | null) ?? null,
    archived: !!r.archived,
    sort: r.sort as number,
    interestRateBps: (r.interest_rate_bps as number | null) ?? null,
    monthlyPaymentCents: (r.monthly_payment_cents as number | null) ?? null,
    rateVariableFrom: (r.rate_variable_from as string | null) ?? null,
    variableRateBps: (r.variable_rate_bps as number | null) ?? null,
    termEndMonth: (r.term_end_month as string | null) ?? null,
    ...(r.balance_cents !== undefined ? { balanceCents: r.balance_cents as number } : {}),
  };
}
function toCategory(r: Row): Category {
  return {
    id: r.id as number,
    name: r.name as string,
    parentId: (r.parent_id as number | null) ?? null,
    kind: r.kind as Category['kind'],
    color: (r.color as string | null) ?? null,
    icon: (r.icon as string | null) ?? null,
    archived: !!r.archived,
    sort: r.sort as number,
  };
}
function toTransaction(r: Row): Transaction {
  return {
    id: r.id as number,
    date: r.date as string,
    amountCents: r.amount_cents as number,
    accountId: r.account_id as number,
    categoryId: (r.category_id as number | null) ?? null,
    description: r.description as string,
    note: (r.note as string | null) ?? null,
    source: r.source as Transaction['source'],
    transferId: (r.transfer_id as number | null) ?? null,
    ...(r.has_receipt !== undefined ? { hasReceipt: !!r.has_receipt } : {}),
  };
}
function toTransfer(r: Row): Transfer {
  return {
    id: r.id as number,
    date: r.date as string,
    fromAccountId: r.from_account_id as number,
    toAccountId: r.to_account_id as number,
    amountCents: r.amount_cents as number,
    note: (r.note as string | null) ?? null,
  };
}

// Whitelisted column map so PATCH only ever touches known columns.
export function applyUpdate(
  db: DatabaseSync,
  table: string,
  columns: Record<string, string>,
  patch: Record<string, unknown>,
  id: number,
  userId: number,
): number {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [key, col] of Object.entries(columns)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const v = patch[key];
    sets.push(`${col} = ?`);
    vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null));
  }
  if (sets.length === 0) return 0;
  vals.push(id, userId);
  return db
    .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...vals).changes as number;
}

// ---- accounts ----

export function listAccounts(db: DatabaseSync, userId: number): Account[] {
  const r = db
    .prepare(
      `SELECT a.*, a.opening_balance_cents + COALESCE(
         (SELECT SUM(t.amount_cents) FROM transactions t
          WHERE t.account_id = a.id AND t.user_id = a.user_id), 0) AS balance_cents
       FROM accounts a WHERE a.user_id = ? ORDER BY a.sort, a.id`,
    )
    .all(userId);
  return rows<Row>(r).map(toAccount);
}

export function createAccount(db: DatabaseSync, userId: number, input: Omit<Account, 'id' | 'archived' | 'balanceCents'>): Account {
  const info = db
    .prepare(
      `INSERT INTO accounts(user_id,name,type,currency,opening_balance_cents,credit_limit_cents,sort,interest_rate_bps,monthly_payment_cents,rate_variable_from,variable_rate_bps,term_end_month)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      userId,
      input.name,
      input.type,
      input.currency,
      input.openingBalanceCents,
      input.creditLimitCents,
      input.sort,
      input.interestRateBps,
      input.monthlyPaymentCents,
      input.rateVariableFrom,
      input.variableRateBps,
      input.termEndMonth,
    );
  return getAccount(db, userId, Number(info.lastInsertRowid));
}

export function getAccount(db: DatabaseSync, userId: number, id: number): Account {
  const r = db
    .prepare(
      `SELECT a.*, a.opening_balance_cents + COALESCE(
         (SELECT SUM(t.amount_cents) FROM transactions t
          WHERE t.account_id = a.id AND t.user_id = a.user_id), 0) AS balance_cents
       FROM accounts a WHERE a.id = ? AND a.user_id = ?`,
    )
    .get(id, userId);
  if (!r) throw new HttpError(404, 'account not found');
  return toAccount(one<Row>(r));
}

const ACCOUNT_COLS = {
  name: 'name',
  type: 'type',
  currency: 'currency',
  openingBalanceCents: 'opening_balance_cents',
  creditLimitCents: 'credit_limit_cents',
  archived: 'archived',
  sort: 'sort',
  interestRateBps: 'interest_rate_bps',
  monthlyPaymentCents: 'monthly_payment_cents',
  rateVariableFrom: 'rate_variable_from',
  variableRateBps: 'variable_rate_bps',
  termEndMonth: 'term_end_month',
};

export function updateAccount(db: DatabaseSync, userId: number, id: number, patch: Record<string, unknown>): Account {
  // The variable-rate pair must stay both-or-neither once the patch is applied, otherwise the
  // payoff projection would silently ignore a half-configured switch.
  const current = getAccount(db, userId, id);
  const merged = {
    rateVariableFrom: (patch.rateVariableFrom !== undefined ? patch.rateVariableFrom : current.rateVariableFrom) as string | null,
    variableRateBps: (patch.variableRateBps !== undefined ? patch.variableRateBps : current.variableRateBps) as number | null,
  };
  if ((merged.rateVariableFrom == null) !== (merged.variableRateBps == null))
    throw new HttpError(400, 'set both the variable-from month and the variable rate, or neither');

  const changed = applyUpdate(db, 'accounts', ACCOUNT_COLS, patch, id, userId);
  if (changed === 0 && !accountExists(db, userId, id)) throw new HttpError(404, 'account not found');
  return getAccount(db, userId, id);
}

export function deleteAccount(db: DatabaseSync, userId: number, id: number): void {
  const used = one<{ n: number }>(
    db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND user_id = ?').get(id, userId),
  ).n;
  if (used > 0) throw new HttpError(409, 'account has transactions; archive it instead');
  const changes = db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, userId).changes;
  if (changes === 0) throw new HttpError(404, 'account not found');
}

function accountExists(db: DatabaseSync, userId: number, id: number): boolean {
  return !!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').get(id, userId);
}

// ---- categories ----

export function listCategories(db: DatabaseSync, userId: number): Category[] {
  const r = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort, id').all(userId);
  return rows<Row>(r).map(toCategory);
}

function assertParentCategory(db: DatabaseSync, userId: number, parentId: number | null, excludeId?: number): void {
  if (parentId === null) return;
  if (parentId === excludeId) throw new HttpError(400, 'category cannot be its own parent');
  if (!db.prepare('SELECT 1 FROM categories WHERE id=? AND user_id=?').get(parentId, userId))
    throw new HttpError(400, 'parent category not found');
}

export function createCategory(db: DatabaseSync, userId: number, input: Omit<Category, 'id' | 'archived'>): Category {
  assertParentCategory(db, userId, input.parentId);
  const info = db
    .prepare('INSERT INTO categories(user_id,name,parent_id,kind,color,icon,sort) VALUES(?,?,?,?,?,?,?)')
    .run(userId, input.name, input.parentId, input.kind, input.color, input.icon, input.sort);
  return getCategory(db, userId, Number(info.lastInsertRowid));
}

export function getCategory(db: DatabaseSync, userId: number, id: number): Category {
  const r = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, userId);
  if (!r) throw new HttpError(404, 'category not found');
  return toCategory(one<Row>(r));
}

const CATEGORY_COLS = {
  name: 'name',
  parentId: 'parent_id',
  kind: 'kind',
  color: 'color',
  icon: 'icon',
  archived: 'archived',
  sort: 'sort',
};

export function updateCategory(db: DatabaseSync, userId: number, id: number, patch: Record<string, unknown>): Category {
  if (patch.parentId !== undefined) assertParentCategory(db, userId, patch.parentId as number | null, id);
  const changed = applyUpdate(db, 'categories', CATEGORY_COLS, patch, id, userId);
  if (changed === 0 && !db.prepare('SELECT 1 FROM categories WHERE id=? AND user_id=?').get(id, userId))
    throw new HttpError(404, 'category not found');
  return getCategory(db, userId, id);
}

export function deleteCategory(db: DatabaseSync, userId: number, id: number): void {
  // Detach transactions and child categories rather than orphaning them.
  db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ? AND user_id = ?').run(id, userId);
  db.prepare('UPDATE categories SET parent_id = NULL WHERE parent_id = ? AND user_id = ?').run(id, userId);
  const changes = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, userId).changes;
  if (changes === 0) throw new HttpError(404, 'category not found');
}

// ---- transactions ----

export interface TxFilters {
  month?: string;
  accountId?: number;
  categoryId?: number;
  limit: number;
}

export function listTransactions(db: DatabaseSync, userId: number, f: TxFilters): Transaction[] {
  // Columns are qualified with the `t` alias up front — the receipts EXISTS sub-select below
  // introduces a second table, so bare column names would be ambiguous.
  const where = ['t.user_id = ?'];
  const vals: (string | number)[] = [userId];
  if (f.month) {
    where.push('substr(t.date,1,7) = ?');
    vals.push(f.month);
  }
  if (f.accountId) {
    where.push('t.account_id = ?');
    vals.push(f.accountId);
  }
  if (f.categoryId) {
    where.push('t.category_id = ?');
    vals.push(f.categoryId);
  }
  vals.push(f.limit);
  const r = db
    .prepare(
      `SELECT t.*, EXISTS(SELECT 1 FROM receipts rc WHERE rc.transaction_id = t.id AND rc.user_id = t.user_id) AS has_receipt
       FROM transactions t WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC LIMIT ?`,
    )
    .all(...vals);
  return rows<Row>(r).map(toTransaction);
}

export function getTransaction(db: DatabaseSync, userId: number, id: number): Transaction {
  const r = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!r) throw new HttpError(404, 'transaction not found');
  return toTransaction(one<Row>(r));
}

function assertAccount(db: DatabaseSync, userId: number, accountId: number): void {
  if (!accountExists(db, userId, accountId)) throw new HttpError(400, 'account not found');
}
function assertCategory(db: DatabaseSync, userId: number, categoryId: number | null): void {
  if (categoryId !== null && !db.prepare('SELECT 1 FROM categories WHERE id=? AND user_id=?').get(categoryId, userId))
    throw new HttpError(400, 'category not found');
}

export function createTransaction(
  db: DatabaseSync,
  userId: number,
  input: Omit<Transaction, 'id' | 'transferId'>,
): Transaction {
  assertAccount(db, userId, input.accountId);
  assertCategory(db, userId, input.categoryId);
  const info = db
    .prepare(
      `INSERT INTO transactions(user_id,date,amount_cents,account_id,category_id,description,note,source)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(userId, input.date, input.amountCents, input.accountId, input.categoryId, input.description, input.note, input.source);
  return getTransaction(db, userId, Number(info.lastInsertRowid));
}

const TX_COLS = {
  date: 'date',
  amountCents: 'amount_cents',
  accountId: 'account_id',
  categoryId: 'category_id',
  description: 'description',
  note: 'note',
  source: 'source',
};

export function updateTransaction(db: DatabaseSync, userId: number, id: number, patch: Record<string, unknown>): Transaction {
  const existing = getTransaction(db, userId, id); // 404s if missing
  if (existing.transferId !== null) throw new HttpError(409, 'transfer legs cannot be edited directly');
  if (patch.accountId !== undefined) assertAccount(db, userId, patch.accountId as number);
  if (patch.categoryId !== undefined) assertCategory(db, userId, patch.categoryId as number | null);
  applyUpdate(db, 'transactions', TX_COLS, patch, id, userId);
  return getTransaction(db, userId, id);
}

export function deleteTransaction(db: DatabaseSync, userId: number, id: number): void {
  const tx = getTransaction(db, userId, id);
  if (tx.transferId !== null) throw new HttpError(409, 'delete the transfer instead');
  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId);
}

// ---- transfers (transfer row + two mirror transaction legs) ----

export function createTransfer(
  db: DatabaseSync,
  userId: number,
  input: { date: string; fromAccountId: number; toAccountId: number; amountCents: number; note: string | null },
): Transfer {
  const owned = one<{ n: number }>(
    db
      .prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND id IN (?, ?)')
      .get(userId, input.fromAccountId, input.toAccountId),
  ).n;
  if (owned !== 2) throw new HttpError(400, 'account not found');

  db.exec('BEGIN');
  try {
    const trId = Number(
      db
        .prepare('INSERT INTO transfers(user_id,date,from_account_id,to_account_id,amount_cents,note) VALUES(?,?,?,?,?,?)')
        .run(userId, input.date, input.fromAccountId, input.toAccountId, input.amountCents, input.note).lastInsertRowid,
    );
    const leg = db.prepare(
      `INSERT INTO transactions(user_id,date,amount_cents,account_id,category_id,description,note,source,transfer_id)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    const desc = input.note ?? 'Transfer';
    leg.run(userId, input.date, -input.amountCents, input.fromAccountId, null, desc, input.note, 'manual', trId);
    leg.run(userId, input.date, input.amountCents, input.toAccountId, null, desc, input.note, 'manual', trId);
    db.exec('COMMIT');
    return one<Transfer>(
      toTransfer(one<Row>(db.prepare('SELECT * FROM transfers WHERE id = ?').get(trId))),
    );
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function deleteTransfer(db: DatabaseSync, userId: number, id: number): void {
  // legs cascade via ON DELETE CASCADE
  const changes = db.prepare('DELETE FROM transfers WHERE id = ? AND user_id = ?').run(id, userId).changes;
  if (changes === 0) throw new HttpError(404, 'transfer not found');
}

// ---- dashboard ----

export function getDashboard(db: DatabaseSync, userId: number, month: string): DashboardResponse {
  // Internal transfers (transfer_id NOT NULL) are excluded from income/expense.
  const totals = one<{ income: number | null; expense: number | null }>(
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS income,
           SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END) AS expense
         FROM transactions
         WHERE user_id = ? AND transfer_id IS NULL AND substr(date,1,7) = ?`,
      )
      .get(userId, month),
  );
  const income = totals.income ?? 0;
  const expense = totals.expense ?? 0;

  const catRows = rows<Row>(
    db
      .prepare(
        `SELECT t.category_id, c.name AS cat_name, c.kind AS cat_kind, SUM(t.amount_cents) AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.user_id = ? AND t.transfer_id IS NULL AND substr(t.date,1,7) = ?
         GROUP BY t.category_id
         ORDER BY total ASC`,
      )
      .all(userId, month),
  );
  const byCategory: CategoryTotal[] = catRows.map((r) => {
    const total = r.total as number;
    return {
      categoryId: (r.category_id as number | null) ?? null,
      name: (r.cat_name as string | null) ?? 'Uncategorized',
      kind: (r.cat_kind as CategoryTotal['kind'] | null) ?? (total < 0 ? 'expense' : 'income'),
      totalCents: total,
    };
  });

  return {
    month,
    incomeCents: income,
    expenseCents: expense,
    netCents: income + expense,
    byCategory,
    accounts: listAccounts(db, userId),
  };
}

import type { DatabaseSync } from 'node:sqlite';
import type { CategoryTotal, StatsResponse, TrendPoint, FyRollup } from '@wallet/shared';

type Row = Record<string, unknown>;
const rows = <T>(r: unknown[]): T[] => r as T[];

// ---- pure date math (DoD unit under test) ----

/** First month of the fiscal year containing `month` (YYYY-MM), given a 1-12 start month. */
export function fiscalYearStart(month: string, fyStartMonth: number): string {
  const [y, m] = month.split('-').map(Number);
  const year = m >= fyStartMonth ? y : y - 1;
  return `${year}-${String(fyStartMonth).padStart(2, '0')}`;
}
/** `n` months before `month` (YYYY-MM), inclusive-friendly for building a trend window. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** net/income as a 0-1 rate (0 when no income); expense is stored negative. */
export function savingsRate(incomeCents: number, expenseCents: number): number {
  return incomeCents > 0 ? (incomeCents + expenseCents) / incomeCents : 0;
}

// ---- queries (transfers excluded: transfer_id IS NULL) ----

function periodTotals(db: DatabaseSync, userId: number, fromMonth: string, toMonthExcl: string): { income: number; expense: number } {
  const r = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS income,
         COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND transfer_id IS NULL
         AND substr(date,1,7) >= ? AND substr(date,1,7) < ?`,
    )
    .get(userId, fromMonth, toMonthExcl) as { income: number; expense: number };
  return r;
}

function rollup(db: DatabaseSync, userId: number, startMonth: string): FyRollup {
  const end = addMonths(startMonth, 12);
  const { income, expense } = periodTotals(db, userId, startMonth, end);
  return {
    label: startMonth.slice(0, 4),
    startMonth,
    incomeCents: income,
    expenseCents: expense,
    netCents: income + expense,
    savingsRate: savingsRate(income, expense),
  };
}

export function getStats(db: DatabaseSync, userId: number, thisMonth: string, fyStartMonth: number, months: number): StatsResponse {
  // Monthly trend over the last `months` (oldest first).
  const from = addMonths(thisMonth, -(months - 1));
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const r of rows<Row>(
    db
      .prepare(
        `SELECT substr(date,1,7) AS m,
           COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS income,
           COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS expense
         FROM transactions
         WHERE user_id = ? AND transfer_id IS NULL AND substr(date,1,7) >= ? AND substr(date,1,7) <= ?
         GROUP BY m`,
      )
      .all(userId, from, thisMonth),
  )) {
    monthly.set(r.m as string, { income: r.income as number, expense: r.expense as number });
  }
  const trend: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths(from, i);
    const t = monthly.get(m) ?? { income: 0, expense: 0 };
    trend.push({ month: m, incomeCents: t.income, expenseCents: t.expense, netCents: t.income + t.expense });
  }

  const fyStart = fiscalYearStart(thisMonth, fyStartMonth);
  const fiscalYear = rollup(db, userId, fyStart);
  const previousFiscalYear = rollup(db, userId, addMonths(fyStart, -12));

  // Category breakdown for the current fiscal year.
  const fyEnd = addMonths(fyStart, 12);
  const byCategory: CategoryTotal[] = rows<Row>(
    db
      .prepare(
        `SELECT t.category_id, c.name AS cat_name, c.kind AS cat_kind, SUM(t.amount_cents) AS total
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.user_id = ? AND t.transfer_id IS NULL
           AND substr(t.date,1,7) >= ? AND substr(t.date,1,7) < ?
         GROUP BY t.category_id ORDER BY total ASC`,
      )
      .all(userId, fyStart, fyEnd),
  ).map((r) => {
    const total = r.total as number;
    return {
      categoryId: (r.category_id as number | null) ?? null,
      name: (r.cat_name as string | null) ?? 'Uncategorized',
      kind: (r.cat_kind as CategoryTotal['kind'] | null) ?? (total < 0 ? 'expense' : 'income'),
      totalCents: total,
    };
  });

  return { trend, fiscalYear, previousFiscalYear, byCategory };
}

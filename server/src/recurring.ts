import type { DatabaseSync } from 'node:sqlite';
import type {
  ForecastPoint,
  Occurrence,
  RecurringRule,
  RuleSuggestion,
} from '@wallet/shared';
import { HttpError } from './errors.js';
import { applyUpdate } from './service.js';

type Row = Record<string, unknown>;
const one = <T>(r: unknown): T => r as T;
const rows = <T>(r: unknown[]): T[] => r as T[];

// ---- pure date maths (DoD unit under test — no DB) ----

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parse = (s: string): { y: number; m: number; d: number } => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
};
/** Days in month m (1-12) of year y. */
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The date a rule fires in a given year/month, or null if it doesn't fire then. */
export function occurrenceInMonth(rule: RecurringRule, y: number, m: number): string | null {
  if (rule.cadence === 'yearly' && rule.month !== m) return null;
  const day = Math.min(rule.dayOfMonth, daysInMonth(y, m)); // month-end clamp (day 31 → Feb 28/29)
  const date = iso(y, m, day);
  if (date < rule.startDate) return null;
  if (rule.endDate && date > rule.endDate) return null;
  return date;
}

/** All dates a rule fires on within [startISO, endISO] inclusive, ascending. */
export function occurrencesBetween(rule: RecurringRule, startISO: string, endISO: string): string[] {
  if (startISO > endISO) return [];
  const s = parse(startISO);
  const e = parse(endISO);
  const out: string[] = [];
  let y = s.y;
  let m = s.m;
  while (y < e.y || (y === e.y && m <= e.m)) {
    const date = occurrenceInMonth(rule, y, m);
    if (date && date >= startISO && date <= endISO) out.push(date);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Project total account balance at each of the next `months` month-ends.
 * balance(k) = current total + Σ rule occurrences in (from, month-end k] + avg monthly net × k.
 * Recurring rules are projected explicitly; everything else rides the historical average,
 * so the two don't double-count (the average excludes source='recurring').
 */
export function projectForecast(opts: {
  currentTotalCents: number;
  avgMonthlyNetCents: number;
  rules: RecurringRule[];
  fromISO: string;
  months: number;
}): ForecastPoint[] {
  const { currentTotalCents, avgMonthlyNetCents, rules, fromISO, months } = opts;
  const from = parse(fromISO);
  const points: ForecastPoint[] = [];
  for (let k = 1; k <= months; k++) {
    // k-th month-end, counting the current month as k=1.
    const total = from.m - 1 + (k - 1);
    const y = from.y + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const monthEnd = iso(y, m, daysInMonth(y, m));
    let recurring = 0;
    for (const r of rules) {
      for (const _d of occurrencesBetween(r, fromISO, monthEnd)) {
        if (_d > fromISO) recurring += r.amountCents; // only future occurrences move the balance
      }
    }
    points.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      balanceCents: currentTotalCents + recurring + avgMonthlyNetCents * k,
    });
  }
  return points;
}

interface TxLite {
  date: string;
  amountCents: number;
  accountId: number;
  categoryId: number | null;
  description: string;
}

/**
 * Detect monthly recurring series in history: same normalized description + amount +
 * account, ≥3 times, on a stable day-of-month. Returns one suggestion per series.
 * ponytail: monthly only (covers most bills); yearly detection is a later add.
 */
export function detectRecurring(txs: TxLite[], minCount = 3): RuleSuggestion[] {
  const groups = new Map<string, TxLite[]>();
  for (const t of txs) {
    if (!t.description.trim()) continue;
    const key = `${t.description.trim().toLowerCase()}|${t.amountCents}|${t.accountId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: RuleSuggestion[] = [];
  for (const list of groups.values()) {
    if (list.length < minCount) continue;
    // Distinct months only (two charges in one month aren't a monthly cadence).
    const byMonth = new Map<string, TxLite>();
    for (const t of list) byMonth.set(t.date.slice(0, 7), t);
    if (byMonth.size < minCount) continue;
    const members = [...byMonth.values()];
    const dayMode = mode(members.map((t) => parse(t.date).d));
    const stable = members.filter((t) => Math.abs(parse(t.date).d - dayMode) <= 2);
    if (stable.length < minCount) continue;
    const first = list[0];
    out.push({
      cadence: 'monthly',
      dayOfMonth: dayMode,
      amountCents: first.amountCents,
      accountId: first.accountId,
      categoryId: mode(members.map((t) => t.categoryId ?? -1)) === -1 ? null : mode(members.map((t) => t.categoryId ?? -1)),
      description: first.description.trim(),
      count: byMonth.size,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  let best = nums[0];
  let bestN = 0;
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1;
    counts.set(n, c);
    if (c > bestN) {
      bestN = c;
      best = n;
    }
  }
  return best;
}

// ---- mapper ----

function toRule(r: Row): RecurringRule {
  return {
    id: r.id as number,
    cadence: r.cadence as RecurringRule['cadence'],
    dayOfMonth: r.day_of_month as number,
    month: (r.month as number | null) ?? null,
    amountCents: r.amount_cents as number,
    accountId: r.account_id as number,
    categoryId: (r.category_id as number | null) ?? null,
    description: r.description as string,
    note: (r.note as string | null) ?? null,
    autoPost: !!r.auto_post,
    startDate: r.start_date as string,
    endDate: (r.end_date as string | null) ?? null,
    lastPostedDate: (r.last_posted_date as string | null) ?? null,
    archived: !!r.archived,
  };
}

// ---- rule CRUD ----

function assertRefs(db: DatabaseSync, userId: number, accountId: number, categoryId: number | null): void {
  if (!db.prepare('SELECT 1 FROM accounts WHERE id=? AND user_id=?').get(accountId, userId))
    throw new HttpError(400, 'account not found');
  if (categoryId !== null && !db.prepare('SELECT 1 FROM categories WHERE id=? AND user_id=?').get(categoryId, userId))
    throw new HttpError(400, 'category not found');
}

export function listRules(db: DatabaseSync, userId: number): RecurringRule[] {
  return rows<Row>(
    db.prepare('SELECT * FROM recurring_rules WHERE user_id=? ORDER BY archived, day_of_month, id').all(userId),
  ).map(toRule);
}

export function getRule(db: DatabaseSync, userId: number, id: number): RecurringRule {
  const r = db.prepare('SELECT * FROM recurring_rules WHERE id=? AND user_id=?').get(id, userId);
  if (!r) throw new HttpError(404, 'rule not found');
  return toRule(one<Row>(r));
}

export function createRule(
  db: DatabaseSync,
  userId: number,
  input: Omit<RecurringRule, 'id' | 'lastPostedDate' | 'archived'>,
): RecurringRule {
  assertRefs(db, userId, input.accountId, input.categoryId);
  const info = db
    .prepare(
      `INSERT INTO recurring_rules(user_id,cadence,day_of_month,month,amount_cents,account_id,category_id,description,note,auto_post,start_date,end_date)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      userId,
      input.cadence,
      input.dayOfMonth,
      input.cadence === 'yearly' ? input.month : null,
      input.amountCents,
      input.accountId,
      input.categoryId,
      input.description,
      input.note,
      input.autoPost ? 1 : 0,
      input.startDate,
      input.endDate,
    );
  return getRule(db, userId, Number(info.lastInsertRowid));
}

const RULE_COLS = {
  cadence: 'cadence',
  dayOfMonth: 'day_of_month',
  month: 'month',
  amountCents: 'amount_cents',
  accountId: 'account_id',
  categoryId: 'category_id',
  description: 'description',
  note: 'note',
  autoPost: 'auto_post',
  startDate: 'start_date',
  endDate: 'end_date',
  archived: 'archived',
};

export function updateRule(db: DatabaseSync, userId: number, id: number, patch: Record<string, unknown>): RecurringRule {
  getRule(db, userId, id); // 404s if missing
  if (patch.accountId !== undefined || patch.categoryId !== undefined) {
    const cur = getRule(db, userId, id);
    assertRefs(
      db,
      userId,
      (patch.accountId as number) ?? cur.accountId,
      patch.categoryId !== undefined ? (patch.categoryId as number | null) : cur.categoryId,
    );
  }
  applyUpdate(db, 'recurring_rules', RULE_COLS, patch, id, userId);
  return getRule(db, userId, id);
}

export function deleteRule(db: DatabaseSync, userId: number, id: number): void {
  const changes = db.prepare('DELETE FROM recurring_rules WHERE id=? AND user_id=?').run(id, userId).changes;
  if (changes === 0) throw new HttpError(404, 'rule not found');
}

// ---- upcoming, auto-post, forecast, suggestions ----

const todayISO = (): string => new Date().toISOString().slice(0, 10);

function occurrencesFor(rule: RecurringRule, startISO: string, endISO: string): Occurrence[] {
  return occurrencesBetween(rule, startISO, endISO).map((date) => ({
    ruleId: rule.id,
    date,
    description: rule.description,
    amountCents: rule.amountCents,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
  }));
}

export function upcoming(db: DatabaseSync, userId: number, days: number): Occurrence[] {
  const start = todayISO();
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const out: Occurrence[] = [];
  for (const rule of listRules(db, userId)) {
    if (rule.archived) continue;
    for (const o of occurrencesFor(rule, start, end)) if (o.date >= start) out.push(o);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Post every due occurrence since last run, up to today. Idempotent: an occurrence
 *  already materialised (same external_ref) is skipped, so running twice posts once. */
export function runAutoPost(db: DatabaseSync, userId: number): { posted: number } {
  const today = todayISO();
  let posted = 0;
  const insert = db.prepare(
    `INSERT INTO transactions(user_id,date,amount_cents,account_id,category_id,description,note,source,external_ref)
     VALUES(?,?,?,?,?,?,?, 'recurring', ?)`,
  );
  const exists = db.prepare('SELECT 1 FROM transactions WHERE user_id=? AND external_ref=?');

  for (const rule of listRules(db, userId)) {
    if (rule.archived || !rule.autoPost) continue;
    // Catch up from the day after the last post (or the rule start) through today.
    const from = rule.lastPostedDate ?? rule.startDate;
    for (const date of occurrencesBetween(rule, from, today)) {
      if (rule.lastPostedDate && date <= rule.lastPostedDate) continue;
      const ref = `recur:${rule.id}:${date}`;
      if (exists.get(userId, ref)) continue;
      insert.run(userId, date, rule.amountCents, rule.accountId, rule.categoryId, rule.description, rule.note, ref);
      posted++;
    }
    db.prepare('UPDATE recurring_rules SET last_posted_date=? WHERE id=? AND user_id=?').run(today, rule.id, userId);
  }
  return { posted };
}

export function forecast(db: DatabaseSync, userId: number, months: number): ForecastPoint[] {
  const currentTotalCents = one<{ t: number }>(
    db
      .prepare(
        `SELECT COALESCE(SUM(bal),0) AS t FROM (
           SELECT a.opening_balance_cents + COALESCE(
             (SELECT SUM(amount_cents) FROM transactions t WHERE t.account_id=a.id AND t.user_id=a.user_id), 0) AS bal
           FROM accounts a WHERE a.user_id=? AND a.archived=0)`,
      )
      .get(userId),
  ).t;

  // Average monthly net of non-transfer, non-recurring activity over the last 6 months.
  const HIST = 6;
  const since = new Date(Date.now() - HIST * 31 * 86400000).toISOString().slice(0, 7);
  const histNet = one<{ n: number | null }>(
    db
      .prepare(
        `SELECT SUM(amount_cents) AS n FROM transactions
         WHERE user_id=? AND transfer_id IS NULL AND source<>'recurring' AND substr(date,1,7) >= ?`,
      )
      .get(userId, since),
  ).n;
  const avgMonthlyNetCents = Math.round((histNet ?? 0) / HIST);

  return projectForecast({
    currentTotalCents,
    avgMonthlyNetCents,
    rules: listRules(db, userId).filter((r) => !r.archived),
    fromISO: todayISO(),
    months,
  });
}

export function suggestions(db: DatabaseSync, userId: number): RuleSuggestion[] {
  const txs = rows<TxLite>(
    db
      .prepare(
        `SELECT date, amount_cents AS amountCents, account_id AS accountId, category_id AS categoryId, description
         FROM transactions
         WHERE user_id=? AND transfer_id IS NULL AND source<>'recurring'
         ORDER BY date`,
      )
      .all(userId),
  );
  const found = detectRecurring(txs);
  // Drop series that already have an active rule (same amount + account + day).
  const existing = listRules(db, userId).filter((r) => !r.archived);
  return found.filter(
    (s) =>
      !existing.some(
        (r) => r.amountCents === s.amountCents && r.accountId === s.accountId && r.dayOfMonth === s.dayOfMonth,
      ),
  );
}

import type { DatabaseSync } from 'node:sqlite';
import type {
  CommitResult,
  ImportBatch,
  ImportPreview,
  ImportSource,
  ParsedRow,
  StagedRow,
} from '@wallet/shared';
import { HttpError } from './errors.js';

type Row = Record<string, unknown>;
const rows = <T>(r: unknown[]): T[] => r as T[];

// ---- pure dedup / normalize (DoD unit under test — no DB) ----

/** Lowercase, strip punctuation, collapse whitespace. Stable merchant key. */
export function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const withinDays = (a: string, b: string, days: number): boolean => Math.abs(dayNumber(a) - dayNumber(b)) <= days;

/**
 * Give every row a stable external_ref. If the bank supplies one, keep it; otherwise
 * synthesize `bank:<date>:<amount>:<descKey>:<n>` where n disambiguates identical rows
 * on the same day. Re-importing the same statement reproduces the same refs (→ exact
 * dedup) while genuine same-day duplicates keep distinct refs (n=0, n=1, …).
 */
export function assignRefs(parsed: ParsedRow[]): (ParsedRow & { externalRef: string })[] {
  const seen = new Map<string, number>();
  return parsed.map((r) => {
    if (r.externalRef) return { ...r, externalRef: r.externalRef };
    const base = `bank:${r.date}:${r.amountCents}:${normalizeDesc(r.description).replace(/ /g, '-')}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...r, externalRef: `${base}:${n}` };
  });
}

export interface ExistingTx {
  date: string;
  amountCents: number;
  description: string;
  externalRef: string | null;
  categoryId: number | null;
}

/**
 * Index of existing rows for O(1)/O(k) dedup instead of a full scan per row — a large
 * import (up to 5000 rows) would otherwise be O(n·m) with a normalize on every compare.
 * `refs` = exact ref set; `buckets` = fuzzy candidates keyed by amount+normalized desc.
 */
interface DedupIndex {
  refs: Set<string>;
  buckets: Map<string, ExistingTx[]>;
}
const bucketKey = (amountCents: number, description: string): string => `${amountCents}:${normalizeDesc(description)}`;

function buildIndex(existing: ExistingTx[]): DedupIndex {
  const idx: DedupIndex = { refs: new Set(), buckets: new Map() };
  for (const e of existing) addToIndex(idx, e);
  return idx;
}
function addToIndex(idx: DedupIndex, e: ExistingTx): void {
  if (e.externalRef) idx.refs.add(e.externalRef);
  const key = bucketKey(e.amountCents, e.description);
  (idx.buckets.get(key) ?? idx.buckets.set(key, []).get(key)!).push(e);
}
function dupInIndex(row: ParsedRow & { externalRef: string }, idx: DedupIndex, windowDays = 1): boolean {
  if (idx.refs.has(row.externalRef)) return true; // exact — covers overlapping re-imports
  const cands = idx.buckets.get(bucketKey(row.amountCents, row.description)) ?? [];
  return cands.some((e) => withinDays(e.date, row.date, windowDays)); // fuzzy — already recorded by hand
}

/**
 * A row is a duplicate if its ref already exists (exact — covers overlapping re-imports),
 * or a fuzzy match exists: same amount + normalized description within `windowDays`
 * (covers a transaction the user already entered by hand).
 */
export function isDuplicate(row: ParsedRow & { externalRef: string }, existing: ExistingTx[], windowDays = 1): boolean {
  return dupInIndex(row, buildIndex(existing), windowDays);
}

// Generic banking/payment words that show up across unrelated merchants — ignored so a shared
// "compras" or "pagamento" can't wrongly link two different shops. (Short tokens are dropped by
// the length filter, so only ≥4-char noise needs listing here.)
const STOPWORDS = new Set([
  'compras', 'compra', 'pagamento', 'pagamentos', 'servico', 'servicos', 'multibanco',
  'transferencia', 'levantamento', 'unipessoal', 'cartao', 'debito', 'credito',
]);

/** Distinctive tokens of a description: ≥4 chars, minus generic banking words. */
function significantTokens(s: string): string[] {
  return normalizeDesc(s).split(' ').filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Pick the most-common category among a tally, or null. */
function topCategory(counts: Map<number, number>): number | null {
  let best: number | null = null;
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = cat;
    }
  }
  return best;
}

/**
 * Merchant memory: the category most often used for a *similar* merchant in history. Matches on
 * a shared distinctive token rather than exact string equality, so "CONTINENTE LISBOA" and
 * "CONTINENTE PORTO 4471" categorize together even though the tails differ.
 */
export function suggestCategory(existing: ExistingTx[], description: string): number | null {
  const want = new Set(significantTokens(description));
  if (want.size === 0) return null;
  const counts = new Map<number, number>();
  for (const e of existing) {
    if (e.categoryId === null) continue;
    if (significantTokens(e.description).some((t) => want.has(t))) {
      counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
    }
  }
  return topCategory(counts);
}

export interface CategoryRuleLite {
  pattern: string;
  categoryId: number;
}

/**
 * First rule whose (normalized) pattern is contained in the (normalized) description wins.
 * Caller supplies rules already ordered by priority. Explicit rules beat merchant memory.
 */
export function matchCategoryRule(rules: CategoryRuleLite[], description: string): number | null {
  const hay = normalizeDesc(description);
  for (const r of rules) {
    const needle = normalizeDesc(r.pattern);
    if (needle && hay.includes(needle)) return r.categoryId;
  }
  return null;
}

// ---- db ----

function assertAccount(db: DatabaseSync, userId: number, accountId: number): void {
  if (!db.prepare('SELECT 1 FROM accounts WHERE id=? AND user_id=?').get(accountId, userId))
    throw new HttpError(400, 'account not found');
}
function assertCategoriesOwned(db: DatabaseSync, userId: number, categoryIds: (number | null | undefined)[]): void {
  for (const id of new Set(categoryIds.filter((c): c is number => c != null))) {
    if (!db.prepare('SELECT 1 FROM categories WHERE id=? AND user_id=?').get(id, userId))
      throw new HttpError(400, 'category not found');
  }
}

function existingFor(db: DatabaseSync, userId: number, accountId: number): ExistingTx[] {
  return rows<Row>(
    db
      .prepare('SELECT date, amount_cents, description, external_ref, category_id FROM transactions WHERE user_id=? AND account_id=?')
      .all(userId, accountId),
  ).map((r) => ({
    date: r.date as string,
    amountCents: r.amount_cents as number,
    description: r.description as string,
    externalRef: (r.external_ref as string | null) ?? null,
    categoryId: (r.category_id as number | null) ?? null,
  }));
}

function categoryRulesFor(db: DatabaseSync, userId: number): CategoryRuleLite[] {
  return rows<Row>(
    db.prepare('SELECT pattern, category_id FROM category_rules WHERE user_id=? ORDER BY sort, id').all(userId),
  ).map((r) => ({ pattern: r.pattern as string, categoryId: r.category_id as number }));
}

/**
 * Suggest a category for a free-text description across ALL the user's history (not one account) —
 * used by receipt capture and manual entry. Same precedence as import: keyword rule, then the
 * most-used category for a similar merchant. Null when nothing is confident enough.
 */
export function suggestCategoryForUser(db: DatabaseSync, userId: number, description: string): number | null {
  const ruleHit = matchCategoryRule(categoryRulesFor(db, userId), description);
  if (ruleHit !== null) return ruleHit;
  const existing = rows<Row>(
    db.prepare('SELECT description, category_id FROM transactions WHERE user_id=? AND category_id IS NOT NULL').all(userId),
  ).map((r) => ({
    date: '',
    amountCents: 0,
    externalRef: null,
    description: r.description as string,
    categoryId: r.category_id as number,
  }));
  return suggestCategory(existing, description);
}

export function previewImport(db: DatabaseSync, userId: number, accountId: number, parsed: ParsedRow[]): ImportPreview {
  assertAccount(db, userId, accountId);
  const existing = existingFor(db, userId, accountId);
  const rules = categoryRulesFor(db, userId);
  const idx = buildIndex(existing);
  const staged: StagedRow[] = assignRefs(parsed).map((r) => ({
    ...r,
    status: dupInIndex(r, idx) ? 'duplicate' : 'new',
    // Explicit keyword rules take precedence; fall back to learned merchant memory.
    suggestedCategoryId: matchCategoryRule(rules, r.description) ?? suggestCategory(existing, r.description),
  }));
  return {
    accountId,
    rows: staged,
    newCount: staged.filter((r) => r.status === 'new').length,
    duplicateCount: staged.filter((r) => r.status === 'duplicate').length,
  };
}

export function commitImport(
  db: DatabaseSync,
  userId: number,
  input: {
    accountId: number;
    source: ImportSource;
    description: string;
    rows: (ParsedRow & { categoryId?: number | null })[];
    reconcileToBalanceCents?: number | null;
  },
): CommitResult {
  assertAccount(db, userId, input.accountId);
  assertCategoriesOwned(db, userId, input.rows.map((r) => r.categoryId)); // reject cross-user / unknown categories
  const withRefs = assignRefs(input.rows);

  db.exec('BEGIN');
  try {
    const importId = Number(
      db
        .prepare('INSERT INTO bank_imports(user_id,account_id,source,description,row_count) VALUES(?,?,?,?,0)')
        .run(userId, input.accountId, input.source, input.description).lastInsertRowid,
    );
    const insert = db.prepare(
      `INSERT INTO transactions(user_id,date,amount_cents,account_id,category_id,description,note,source,external_ref,import_id)
       VALUES(?,?,?,?,?,?,NULL,'bank',?,?)`,
    );
    // Dedup against what was already recorded BEFORE this import (frozen), so commit matches the
    // preview exactly. We only track newly-inserted *refs* incrementally — enough to drop a
    // repeated exact ref within the batch — but NOT their fuzzy (amount+desc) fingerprint, so two
    // genuine same-amount charges on adjacent days (e.g. two tolls) both import instead of one
    // silently swallowing the other. assignRefs already gives distinct refs to same-day repeats.
    const idx = buildIndex(existingFor(db, userId, input.accountId));
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < withRefs.length; i++) {
      const r = withRefs[i];
      if (dupInIndex(r, idx)) {
        skipped++;
        continue;
      }
      const categoryId = (input.rows[i].categoryId as number | null | undefined) ?? null;
      insert.run(userId, r.date, r.amountCents, input.accountId, categoryId, r.description, r.externalRef, importId);
      idx.refs.add(r.externalRef); // exact-ref guard only; do not feed the fuzzy buckets
      inserted++;
    }
    db.prepare('UPDATE bank_imports SET row_count=? WHERE id=?').run(inserted, importId);

    // Reconcile: nudge the opening balance so opening + Σtx == the statement's book balance. Runs
    // inside the tx and after the inserts, so it targets the final balance regardless of how many
    // rows dedup dropped (count-independent). Works for a fresh or already-populated account.
    let openingBalanceCents: number | undefined;
    if (input.reconcileToBalanceCents != null) {
      const acc = db
        .prepare(
          `SELECT opening_balance_cents AS opening, opening_balance_cents + COALESCE(
             (SELECT SUM(amount_cents) FROM transactions WHERE account_id=? AND user_id=?), 0) AS balance
           FROM accounts WHERE id=? AND user_id=?`,
        )
        .get(input.accountId, userId, input.accountId, userId) as { opening: number; balance: number };
      openingBalanceCents = acc.opening + (input.reconcileToBalanceCents - acc.balance);
      db.prepare('UPDATE accounts SET opening_balance_cents=? WHERE id=? AND user_id=?').run(openingBalanceCents, input.accountId, userId);
    }

    db.exec('COMMIT');
    return { importId, inserted, skipped, ...(openingBalanceCents !== undefined && { openingBalanceCents }) };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function toBatch(r: Row): ImportBatch {
  return {
    id: r.id as number,
    accountId: r.account_id as number,
    source: r.source as ImportSource,
    description: r.description as string,
    rowCount: r.row_count as number,
    createdAt: r.created_at as string,
  };
}

export function listImports(db: DatabaseSync, userId: number): ImportBatch[] {
  return rows<Row>(
    db.prepare('SELECT * FROM bank_imports WHERE user_id=? ORDER BY id DESC').all(userId),
  ).map(toBatch);
}

/** Revert an import: its transactions cascade-delete via transactions.import_id. */
export function revertImport(db: DatabaseSync, userId: number, id: number): void {
  const batch = db.prepare('SELECT id FROM bank_imports WHERE id=? AND user_id=?').get(id, userId);
  if (!batch) throw new HttpError(404, 'import not found');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM transactions WHERE import_id=? AND user_id=?').run(id, userId);
    db.prepare('DELETE FROM bank_imports WHERE id=? AND user_id=?').run(id, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

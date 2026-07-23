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

/** Merchant memory: the category most often used for this merchant in history. */
export function suggestCategory(existing: ExistingTx[], description: string): number | null {
  const norm = normalizeDesc(description);
  const counts = new Map<number, number>();
  for (const e of existing) {
    if (e.categoryId === null || normalizeDesc(e.description) !== norm) continue;
    counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
  }
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

export function previewImport(db: DatabaseSync, userId: number, accountId: number, parsed: ParsedRow[]): ImportPreview {
  assertAccount(db, userId, accountId);
  const existing = existingFor(db, userId, accountId);
  const idx = buildIndex(existing);
  const staged: StagedRow[] = assignRefs(parsed).map((r) => ({
    ...r,
    status: dupInIndex(r, idx) ? 'duplicate' : 'new',
    suggestedCategoryId: suggestCategory(existing, r.description),
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
  input: { accountId: number; source: ImportSource; description: string; rows: (ParsedRow & { categoryId?: number | null })[] },
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
    // Re-check dedup at commit time so a double-submit can't insert twice. Indexed so a
    // large batch stays ~O(n) instead of O(n²) inside this synchronous transaction.
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
      addToIndex(idx, { date: r.date, amountCents: r.amountCents, description: r.description, externalRef: r.externalRef, categoryId });
      inserted++;
    }
    db.prepare('UPDATE bank_imports SET row_count=? WHERE id=?').run(inserted, importId);
    db.exec('COMMIT');
    return { importId, inserted, skipped };
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

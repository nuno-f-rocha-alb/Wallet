import type { DatabaseSync } from 'node:sqlite';
import type { BackupData } from '@wallet/shared';
import { HttpError } from './errors.js';

type Row = Record<string, unknown>;
const rows = <T>(r: unknown[]): T[] => r as T[];

// Every user-owned table, parent→child. Deferred FKs at import time mean order only
// matters for readability, not correctness. receipts.image (BLOB) is base64'd in JSON.
const TABLES = [
  'accounts',
  'categories',
  'transfers',
  'transactions',
  'vehicles',
  'fuel_entries',
  'recurring_rules',
  'bank_imports',
  'receipts',
] as const;

// Real column names per table, read once from the live schema. Import filters incoming keys
// to this set so untrusted JSON keys can never reach the INSERT's column-name text (injection).
const colCache = new Map<string, Set<string>>();
function allowedColumns(db: DatabaseSync, table: string): Set<string> {
  let s = colCache.get(table);
  if (!s) {
    s = new Set(rows<Row>(db.prepare(`PRAGMA table_info(${table})`).all()).map((r) => r.name as string));
    colCache.set(table, s);
  }
  return s;
}

/** Full user backup: every domain row, ids preserved so relationships round-trip exactly. */
export function exportBackup(db: DatabaseSync, userId: number): BackupData {
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const r = rows<Row>(db.prepare(`SELECT * FROM ${t} WHERE user_id = ?`).all(userId));
    if (t === 'receipts') for (const row of r) if (row.image) row.image = Buffer.from(row.image as Uint8Array).toString('base64');
    tables[t] = r;
  }
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}

/**
 * Replace the user's data with a backup: wipe their rows, reinsert with original ids.
 * defer_foreign_keys lets us delete/insert in any order and validate once at COMMIT.
 * Restores only into free primary keys — importing over ids another user already holds
 * fails cleanly (rollback). ponytail: id-remapping only if cross-DB merge is ever needed.
 */
export function importBackup(db: DatabaseSync, userId: number, backup: BackupData): { restored: Record<string, number> } {
  if (backup?.version !== 1 || typeof backup.tables !== 'object') throw new HttpError(400, 'unrecognized backup');
  db.exec('BEGIN');
  try {
    db.exec('PRAGMA defer_foreign_keys = ON');
    for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    const restored: Record<string, number> = {};
    for (const t of TABLES) {
      const list = Array.isArray(backup.tables[t]) ? backup.tables[t] : [];
      let n = 0;
      const allowed = allowedColumns(db, t);
      for (const raw of list) {
        const row: Row = { ...raw, user_id: userId }; // force ownership; ignore any foreign user_id
        if (t === 'receipts' && typeof row.image === 'string') row.image = Buffer.from(row.image, 'base64');
        // Only real schema columns — drops any injected/unknown keys from the untrusted file.
        const cols = Object.keys(row).filter((c) => allowed.has(c));
        if (cols.length === 0) continue;
        db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(
          ...cols.map((c) => row[c] as string | number | null | Uint8Array),
        );
        n++;
      }
      restored[t] = n;
    }
    db.exec('COMMIT');
    return { restored };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Transactions as CSV (euros, signed), joined to account/category names. */
export function exportCsv(db: DatabaseSync, userId: number): string {
  const r = rows<Row>(
    db
      .prepare(
        `SELECT t.date, t.amount_cents, a.name AS account, c.name AS category, t.description, t.source
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.user_id = ? ORDER BY t.date, t.id`,
      )
      .all(userId),
  );
  const header = ['date', 'amount_eur', 'account', 'category', 'description', 'source'];
  const lines = r.map((row) =>
    [
      row.date,
      ((row.amount_cents as number) / 100).toFixed(2),
      row.account,
      row.category ?? '',
      row.description,
      row.source,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

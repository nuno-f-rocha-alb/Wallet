import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env.js';

// Load the built-in via require so bundlers (Vite/vitest) don't try to resolve
// this newer builtin statically. ponytail: one line beats a bundler config hack.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

// Inlined migrations (no .sql files to copy into the image). Append-only:
// bump the version, never edit a shipped one. ponytail: a ~20-line runner
// beats a migration framework for a single-file DB.
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        ext_subject    TEXT UNIQUE NOT NULL,
        email          TEXT,
        display_name   TEXT,
        is_admin       INTEGER NOT NULL DEFAULT 0,
        api_token_hash TEXT UNIQUE,
        fy_start_month INTEGER NOT NULL DEFAULT 1,
        base_currency  TEXT NOT NULL DEFAULT 'EUR',
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

let _db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(dirname(env.dbPath), { recursive: true });
  const db = new DatabaseSync(env.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  let current = row ? Number(row.value) : 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO app_meta(key, value) VALUES('schema_version', ?) " +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(String(m.version));
      db.exec('COMMIT');
      current = m.version;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

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
  {
    // Composite (user_id, id) uniques + composite FKs so a row can only ever
    // reference *its own user's* rows — tenant isolation enforced by the DB, not
    // just the service layer. FKs on nullable cols (parent/category/transfer) use
    // SQLite's default MATCH SIMPLE: not enforced when the column is NULL.
    version: 2,
    sql: `
      CREATE TABLE accounts (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id               INTEGER NOT NULL REFERENCES users(id),
        name                  TEXT NOT NULL,
        type                  TEXT NOT NULL CHECK(type IN ('cash','bank','credit_card','loan')),
        currency              TEXT NOT NULL DEFAULT 'EUR',
        opening_balance_cents INTEGER NOT NULL DEFAULT 0,
        credit_limit_cents    INTEGER,
        archived              INTEGER NOT NULL DEFAULT 0,
        sort                  INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id)
      );
      CREATE INDEX idx_accounts_user ON accounts(user_id);

      CREATE TABLE categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        name       TEXT NOT NULL,
        parent_id  INTEGER,
        kind       TEXT NOT NULL CHECK(kind IN ('expense','income')),
        color      TEXT,
        icon       TEXT,
        archived   INTEGER NOT NULL DEFAULT 0,
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id),
        FOREIGN KEY(user_id, parent_id) REFERENCES categories(user_id, id)
      );
      CREATE INDEX idx_categories_user ON categories(user_id);

      CREATE TABLE transfers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        date            TEXT NOT NULL,
        from_account_id INTEGER NOT NULL,
        to_account_id   INTEGER NOT NULL,
        amount_cents    INTEGER NOT NULL CHECK(amount_cents > 0),
        note            TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id),
        CHECK(from_account_id <> to_account_id),
        FOREIGN KEY(user_id, from_account_id) REFERENCES accounts(user_id, id),
        FOREIGN KEY(user_id, to_account_id) REFERENCES accounts(user_id, id)
      );
      CREATE INDEX idx_transfers_user ON transfers(user_id);

      CREATE TABLE transactions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        date         TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        account_id   INTEGER NOT NULL,
        category_id  INTEGER,
        description  TEXT NOT NULL DEFAULT '',
        note         TEXT,
        source       TEXT NOT NULL DEFAULT 'manual'
                       CHECK(source IN ('manual','receipt','bank','recurring')),
        external_ref TEXT,
        transfer_id  INTEGER,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(user_id, account_id) REFERENCES accounts(user_id, id),
        FOREIGN KEY(user_id, category_id) REFERENCES categories(user_id, id),
        FOREIGN KEY(user_id, transfer_id) REFERENCES transfers(user_id, id) ON DELETE CASCADE
      );
      CREATE INDEX idx_tx_user_date ON transactions(user_id, date);
      CREATE INDEX idx_tx_user_account ON transactions(user_id, account_id);
      CREATE INDEX idx_tx_user_ext ON transactions(user_id, external_ref);
    `,
  },
  {
    // Phase 2 — car module. Liters stored as integer millilitres, odometer as
    // integer km, price as integer cents (no floats in the DB). Owner-scoped
    // composite FK so a fuel entry can only reference the same user's vehicle.
    version: 3,
    sql: `
      CREATE TABLE vehicles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        name       TEXT NOT NULL,
        make       TEXT,
        plate      TEXT,
        archived   INTEGER NOT NULL DEFAULT 0,
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id)
      );
      CREATE INDEX idx_vehicles_user ON vehicles(user_id);

      CREATE TABLE fuel_entries (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id           INTEGER NOT NULL REFERENCES users(id),
        vehicle_id        INTEGER NOT NULL,
        date              TEXT NOT NULL,
        odometer_km       INTEGER NOT NULL CHECK(odometer_km > 0),
        liters_ml         INTEGER NOT NULL CHECK(liters_ml > 0),
        total_price_cents INTEGER NOT NULL CHECK(total_price_cents >= 0),
        is_full           INTEGER NOT NULL DEFAULT 1,
        note              TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id),
        FOREIGN KEY(user_id, vehicle_id) REFERENCES vehicles(user_id, id)
      );
      CREATE INDEX idx_fuel_user_vehicle ON fuel_entries(user_id, vehicle_id, odometer_km);
    `,
  },
  {
    // Stable identity for the seeded "Car" category so renaming it doesn't silently
    // break monthly car-spend aggregation. Backfills existing users by current name.
    version: 4,
    sql: `
      ALTER TABLE categories ADD COLUMN system_key TEXT;
      UPDATE categories SET system_key = 'car' WHERE parent_id IS NULL AND name = 'Car';
    `,
  },
  {
    // Phase 3 — recurring rules. day_of_month clamps to the real month length at
    // occurrence time; month is set only for yearly rules. last_posted_date drives
    // idempotent auto-post catch-up. Owner-scoped composite FKs (tenant isolation).
    version: 5,
    sql: `
      CREATE TABLE recurring_rules (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL REFERENCES users(id),
        cadence          TEXT NOT NULL CHECK(cadence IN ('monthly','yearly')),
        day_of_month     INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
        month            INTEGER CHECK(month BETWEEN 1 AND 12),
        amount_cents     INTEGER NOT NULL CHECK(amount_cents <> 0),
        account_id       INTEGER NOT NULL,
        category_id      INTEGER,
        description      TEXT NOT NULL DEFAULT '',
        note             TEXT,
        auto_post        INTEGER NOT NULL DEFAULT 0,
        start_date       TEXT NOT NULL,
        end_date         TEXT,
        last_posted_date TEXT,
        archived         INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id),
        FOREIGN KEY(user_id, account_id) REFERENCES accounts(user_id, id),
        FOREIGN KEY(user_id, category_id) REFERENCES categories(user_id, id)
      );
      CREATE INDEX idx_recurring_user ON recurring_rules(user_id, archived);
    `,
  },
  {
    // Phase 4 — bank import. A batch groups the rows committed by one import so it
    // can be reverted in one shot (transactions.import_id ON DELETE CASCADE). Rows
    // carry a synthesized external_ref for exact re-import dedup.
    version: 6,
    sql: `
      CREATE TABLE bank_imports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        account_id  INTEGER NOT NULL,
        source      TEXT NOT NULL DEFAULT 'pdf' CHECK(source IN ('pdf','csv')),
        description TEXT NOT NULL DEFAULT '',
        row_count   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, id),
        FOREIGN KEY(user_id, account_id) REFERENCES accounts(user_id, id)
      );
      CREATE INDEX idx_bank_imports_user ON bank_imports(user_id);

      ALTER TABLE transactions ADD COLUMN import_id INTEGER
        REFERENCES bank_imports(id) ON DELETE CASCADE;
      CREATE INDEX idx_tx_import ON transactions(import_id);
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

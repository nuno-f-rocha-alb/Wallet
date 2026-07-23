import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { addMonths, fiscalYearStart, getStats, savingsRate } from './stats.js';

// ---- pure date/rate math ----

test('fiscalYearStart / addMonths / savingsRate', () => {
  expect(fiscalYearStart('2026-07', 1)).toBe('2026-01'); // calendar year
  expect(fiscalYearStart('2026-01', 2)).toBe('2025-02'); // Jan is before a Feb start → prior FY
  expect(fiscalYearStart('2026-02', 2)).toBe('2026-02');
  expect(addMonths('2026-01', -1)).toBe('2025-12');
  expect(addMonths('2026-12', 1)).toBe('2027-01');
  expect(savingsRate(1000, -400)).toBeCloseTo(0.6, 6);
  expect(savingsRate(0, -100)).toBe(0); // no income → 0, not -Infinity
});

// ---- stats against a seeded fixture (deterministic thisMonth, calendar FY) ----

let dir: string;
let db: DatabaseSync;
const orig = process.env.DB_PATH;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wallet-stats-'));
  process.env.DB_PATH = join(dir, 'test.db');
  db = (await import('./db.js')).getDb();
  db.prepare("INSERT INTO users(ext_subject) VALUES('s')").run();
  db.prepare("INSERT INTO accounts(user_id,name,type) VALUES(1,'A','cash')").run();
  db.prepare("INSERT INTO categories(user_id,name,kind) VALUES(1,'Salary','income')").run(); // id 1
  db.prepare("INSERT INTO categories(user_id,name,kind) VALUES(1,'Food','expense')").run(); // id 2
  const tx = (date: string, amt: number, cat: number) =>
    db.prepare('INSERT INTO transactions(user_id,date,amount_cents,account_id,category_id) VALUES(1,?,?,1,?)').run(date, amt, cat);
  // FY2026: +2000 salary, -500 food
  tx('2026-03-01', 200000, 1);
  tx('2026-04-01', -50000, 2);
  // FY2025: +1000 salary, -300 food
  tx('2025-06-01', 100000, 1);
  tx('2025-06-15', -30000, 2);
});

afterAll(async () => {
  (await import('./db.js')).closeDb();
  rmSync(dir, { recursive: true, force: true });
  if (orig === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = orig;
});

test('stats match the fixture: fiscal year, YoY, trend window, savings rate, category', () => {
  const s = getStats(db, 1, '2026-07', 1, 12);

  expect(s.fiscalYear).toMatchObject({ incomeCents: 200000, expenseCents: -50000, netCents: 150000 });
  expect(s.fiscalYear.savingsRate).toBeCloseTo(0.75, 6);
  expect(s.previousFiscalYear).toMatchObject({ incomeCents: 100000, netCents: 70000 });

  // 12-month window ending 2026-07 = 2025-08 … 2026-07 (so the FY2025 June rows fall outside it)
  expect(s.trend).toHaveLength(12);
  expect(s.trend.find((p) => p.month === '2026-03')!.incomeCents).toBe(200000);
  expect(s.trend.find((p) => p.month === '2026-04')!.expenseCents).toBe(-50000);
  expect(s.trend.find((p) => p.month === '2025-06')).toBeUndefined();

  expect(s.byCategory.find((c) => c.name === 'Food')!.totalCents).toBe(-50000);
  expect(s.byCategory.find((c) => c.name === 'Salary')!.totalCents).toBe(200000);
});

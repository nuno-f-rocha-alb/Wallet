import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Account, BackupData, Category, Vehicle } from '@wallet/shared';

let app: FastifyInstance;
let dir: string;
const alice = { 'remote-user': 'alice' };
const bob = { 'remote-user': 'bob' };
const orig = { DB_PATH: process.env.DB_PATH, TRUSTED_PROXIES: process.env.TRUSTED_PROXIES, AUTH_DEV_USER: process.env.AUTH_DEV_USER };

const req = (method: string, url: string, headers: Record<string, string>, body?: unknown) =>
  app.inject({ method: method as 'GET', url, headers, payload: body as object });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wallet-backup-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.TRUSTED_PROXIES = '*';
  process.env.AUTH_DEV_USER = '';
  app = await (await import('./index.js')).buildApp();

  // Seed a spread of related data so relationships (transfer legs, fuel→vehicle, categories) round-trip.
  const bank = (await req('POST', '/api/accounts', alice, { name: 'Bank', type: 'bank', openingBalanceCents: 100000 })).json() as Account;
  const cash = (await req('POST', '/api/accounts', alice, { name: 'Cash', type: 'cash' })).json() as Account;
  const cats = (await req('GET', '/api/categories', alice)).json() as Category[];
  const groceries = cats.find((c) => c.name === 'Groceries')!.id;
  await req('POST', '/api/transactions', alice, { date: '2026-05-01', amountCents: -1234, accountId: bank.id, categoryId: groceries, description: 'Lidl' });
  await req('POST', '/api/transfers', alice, { date: '2026-05-02', fromAccountId: bank.id, toAccountId: cash.id, amountCents: 5000 });
  const car = (await req('POST', '/api/vehicles', alice, { name: 'Car' })).json() as Vehicle;
  await req('POST', '/api/fuel', alice, { vehicleId: car.id, date: '2026-05-03', odometerKm: 1000, litersMl: 40000, totalPriceCents: 6000 });
  await req('POST', '/api/recurring', alice, { cadence: 'monthly', dayOfMonth: 1, amountCents: 200000, accountId: bank.id, description: 'Salary', startDate: '2026-01-01' });
});

afterAll(async () => {
  try {
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('export → import round-trips the user data identically', async () => {
  const before = (await req('GET', '/api/export', alice)).json() as BackupData;
  expect(before.tables.accounts).toHaveLength(2);
  expect(before.tables.transactions.length).toBeGreaterThanOrEqual(3); // manual + 2 transfer legs
  expect(before.tables.transfers).toHaveLength(1);

  const imp = await req('POST', '/api/import/backup', alice, before);
  expect(imp.statusCode).toBe(201);

  const after = (await req('GET', '/api/export', alice)).json() as BackupData;
  expect(after.tables).toEqual(before.tables); // ids + relationships preserved exactly
});

test('import replaces (does not duplicate) and stays user-isolated', async () => {
  const before = (await req('GET', '/api/export', alice)).json() as BackupData;
  // Importing the same backup twice must not grow the dataset.
  await req('POST', '/api/import/backup', alice, before);
  await req('POST', '/api/import/backup', alice, before);
  const accounts = (await req('GET', '/api/accounts', alice)).json() as Account[];
  expect(accounts).toHaveLength(2);

  // Bob sees nothing of alice's — his backup is empty.
  const bobBackup = (await req('GET', '/api/export', bob)).json() as BackupData;
  expect(bobBackup.tables.accounts).toHaveLength(0);
  expect(bobBackup.tables.transactions).toHaveLength(0);
});

test('CSV export lists transactions with euro amounts', async () => {
  const csv = (await req('GET', '/api/export.csv', alice)).body;
  expect(csv.split('\n')[0]).toBe('date,amount_eur,account,category,description,source');
  expect(csv).toContain('-12.34'); // the Lidl expense in euros
  expect(csv).toContain('Lidl');
});

// Runs last: a malicious import wipes+replaces, so keep it after the data-dependent tests.
test('import ignores unknown/injected column keys instead of putting them in SQL', async () => {
  const malicious: BackupData = {
    version: 1,
    exportedAt: '',
    tables: {
      // valid columns + a junk key crafted to break out of the column list if interpolated
      accounts: [{ id: 999, name: 'Safe', type: 'cash', 'x) VALUES(1);DROP TABLE accounts;--': 1 } as Record<string, unknown>],
      categories: [],
      transfers: [],
      transactions: [],
      vehicles: [],
      fuel_entries: [],
      recurring_rules: [],
      bank_imports: [],
      receipts: [],
    },
  };
  const res = await req('POST', '/api/import/backup', alice, malicious);
  expect(res.statusCode).toBe(201);
  // Table survived (no DROP) and the row inserted with only its real columns.
  const accounts = (await req('GET', '/api/accounts', alice)).json() as Account[];
  expect(accounts).toEqual([expect.objectContaining({ id: 999, name: 'Safe', type: 'cash' })]);
});

import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Account, Category, CommitResult, ImportBatch, ImportPreview, ParsedRow, Transaction } from '@wallet/shared';
import { assignRefs, isDuplicate, normalizeDesc, suggestCategory, type ExistingTx } from './bank.js';

// ---- pure dedup / normalize ----

test('normalizeDesc strips case, punctuation and extra whitespace', () => {
  expect(normalizeDesc('  PINGO DOCE   #1234, Lisboa ')).toBe('pingo doce 1234 lisboa');
});

test('assignRefs keeps bank refs and disambiguates identical same-day rows', () => {
  const refs = assignRefs([
    { date: '2026-01-05', amountCents: -500, description: 'Coffee' },
    { date: '2026-01-05', amountCents: -500, description: 'Coffee' }, // genuine same-day duplicate
    { date: '2026-01-06', amountCents: -999, description: 'Netflix', externalRef: 'BANK-XYZ' },
  ]).map((r) => r.externalRef);
  expect(refs[0]).not.toBe(refs[1]); // n=0 vs n=1 → both survive dedup
  expect(refs[2]).toBe('BANK-XYZ'); // bank-provided ref preserved
});

test('isDuplicate: exact ref match and fuzzy same-amount/desc within a day', () => {
  const existing: ExistingTx[] = [
    { date: '2026-01-10', amountCents: -2500, description: 'Lidl Lisboa', externalRef: 'bank:2026-01-10:-2500:lidl-lisboa:0', categoryId: 3 },
    { date: '2026-02-01', amountCents: -1200, description: 'Spotify', externalRef: null, categoryId: 5 }, // hand-entered
  ];
  const [exact] = assignRefs([{ date: '2026-01-10', amountCents: -2500, description: 'Lidl Lisboa' }]);
  expect(isDuplicate(exact, existing)).toBe(true); // same synthesized ref

  const [fuzzy] = assignRefs([{ date: '2026-02-02', amountCents: -1200, description: 'SPOTIFY' }]);
  expect(isDuplicate(fuzzy, existing)).toBe(true); // ±1 day, same amount+desc → already recorded

  const [fresh] = assignRefs([{ date: '2026-03-01', amountCents: -800, description: 'New shop' }]);
  expect(isDuplicate(fresh, existing)).toBe(false);
});

test('suggestCategory returns the most-used category for a merchant', () => {
  const existing: ExistingTx[] = [
    { date: '2026-01-01', amountCents: -1000, description: 'Lidl', externalRef: null, categoryId: 3 },
    { date: '2026-02-01', amountCents: -1100, description: 'LIDL', externalRef: null, categoryId: 3 },
    { date: '2026-03-01', amountCents: -900, description: 'lidl', externalRef: null, categoryId: 7 },
  ];
  expect(suggestCategory(existing, 'Lidl')).toBe(3);
  expect(suggestCategory(existing, 'Unknown')).toBeNull();
});

// ---- endpoints: dedup on re-import, merchant memory, reversible batch ----

let app: FastifyInstance;
let dir: string;
const alice = { 'remote-user': 'alice' };
const bob = { 'remote-user': 'bob' };
const originalEnv = {
  DB_PATH: process.env.DB_PATH,
  TRUSTED_PROXIES: process.env.TRUSTED_PROXIES,
  AUTH_DEV_USER: process.env.AUTH_DEV_USER,
};

async function req(method: string, url: string, headers: Record<string, string>, body?: unknown) {
  return app.inject({ method: method as 'GET', url, headers, payload: body as object });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wallet-bank-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.TRUSTED_PROXIES = '*';
  process.env.AUTH_DEV_USER = '';
  app = await (await import('./index.js')).buildApp();
});

afterAll(async () => {
  try {
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const STATEMENT: ParsedRow[] = [
  { date: '2026-05-02', amountCents: -2500, description: 'Pingo Doce' },
  { date: '2026-05-05', amountCents: -1200, description: 'Spotify' },
  { date: '2026-05-20', amountCents: 150000, description: 'Salary' },
];

test('importing the same statement twice yields zero duplicates', async () => {
  const acct = (await req('POST', '/api/accounts', alice, { name: 'Bank', type: 'bank' })).json() as Account;
  const rows = STATEMENT.map((r) => ({ ...r }));

  // first commit inserts all 3
  const c1 = (await req('POST', '/api/import/commit', alice, { accountId: acct.id, source: 'pdf', description: 'May', rows })).json() as CommitResult;
  expect(c1.inserted).toBe(3);

  // preview the identical statement again → all duplicates
  const p2 = (await req('POST', '/api/import/preview', alice, { accountId: acct.id, rows })).json() as ImportPreview;
  expect(p2.newCount).toBe(0);
  expect(p2.duplicateCount).toBe(3);

  // committing again inserts nothing
  const c2 = (await req('POST', '/api/import/commit', alice, { accountId: acct.id, source: 'pdf', description: 'May again', rows })).json() as CommitResult;
  expect(c2.inserted).toBe(0);
  expect(c2.skipped).toBe(3);

  const txs = (await req('GET', `/api/transactions?accountId=${acct.id}&limit=500`, alice)).json() as Transaction[];
  expect(txs.filter((t) => t.source === 'bank').length).toBe(3); // no doubling
});

test('an overlapping statement inserts only the new rows; merchant memory reapplies a mapping', async () => {
  const acct = (await req('POST', '/api/accounts', alice, { name: 'Bank2', type: 'bank' })).json() as Account;
  const cats = (await req('GET', '/api/categories', alice)).json() as Category[];
  const groceries = cats.find((c) => c.name === 'Groceries')!.id;

  // seed a categorized Pingo Doce so memory can learn the mapping
  await req('POST', '/api/transactions', alice, { date: '2026-04-10', amountCents: -3000, accountId: acct.id, categoryId: groceries, description: 'Pingo Doce' });

  // import May, then re-import a June statement that overlaps May by one row
  await req('POST', '/api/import/commit', alice, { accountId: acct.id, source: 'pdf', description: 'May', rows: STATEMENT });
  const overlap: ParsedRow[] = [
    { date: '2026-05-20', amountCents: 150000, description: 'Salary' }, // already imported
    { date: '2026-06-02', amountCents: -2500, description: 'Pingo Doce' }, // new
    { date: '2026-06-06', amountCents: -4200, description: 'IKEA' }, // new
  ];
  const prev = (await req('POST', '/api/import/preview', alice, { accountId: acct.id, rows: overlap })).json() as ImportPreview;
  expect(prev.newCount).toBe(2);
  expect(prev.duplicateCount).toBe(1);
  // merchant memory: the new Pingo Doce row is pre-categorized as Groceries
  const pingo = prev.rows.find((r) => r.description === 'Pingo Doce' && r.status === 'new')!;
  expect(pingo.suggestedCategoryId).toBe(groceries);

  const commit = (await req('POST', '/api/import/commit', alice, {
    accountId: acct.id, source: 'pdf', description: 'June',
    rows: prev.rows.filter((r) => r.status === 'new').map((r) => ({ ...r, categoryId: r.suggestedCategoryId })),
  })).json() as CommitResult;
  expect(commit.inserted).toBe(2);

  // reversible batch: deleting the import removes exactly its rows
  const before = ((await req('GET', `/api/transactions?accountId=${acct.id}&limit=500`, alice)).json() as Transaction[]).length;
  expect((await req('DELETE', `/api/import/${commit.importId}`, alice)).statusCode).toBe(204);
  const after = ((await req('GET', `/api/transactions?accountId=${acct.id}&limit=500`, alice)).json() as Transaction[]).length;
  expect(before - after).toBe(2);

  // isolation: bob cannot preview into or revert alice's data
  expect((await req('POST', '/api/import/preview', bob, { accountId: acct.id, rows: overlap })).statusCode).toBe(400);
  const batches = (await req('GET', '/api/import', alice)).json() as ImportBatch[];
  expect((await req('DELETE', `/api/import/${batches[0].id}`, bob)).statusCode).toBe(404);

  // security: committing with a category the caller doesn't own is rejected (not silently tagged)
  const bobCats = (await req('GET', '/api/categories', bob)).json() as Category[];
  const bobCat = bobCats[0].id;
  const badCommit = await req('POST', '/api/import/commit', alice, {
    accountId: acct.id, source: 'pdf', description: 'x',
    rows: [{ date: '2026-07-01', amountCents: -111, description: 'Xshop', categoryId: bobCat }],
  });
  expect(badCommit.statusCode).toBe(400); // cross-user category → clean 400, not a 500 or a leak
});

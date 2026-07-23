import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Account, Category, DashboardResponse } from '@wallet/shared';

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
  dir = mkdtempSync(join(tmpdir(), 'wallet-led-'));
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

test('new user is seeded with the category taxonomy', async () => {
  const r = await req('GET', '/api/categories', alice);
  expect(r.statusCode).toBe(200);
  const cats = r.json() as Category[];
  expect(cats.length).toBeGreaterThan(10);
  expect(cats.find((c) => c.name === 'Groceries')?.parentId).toBeTruthy();
});

test('balances = opening + transactions; transfers move money but are not income/expense', async () => {
  const bank = (await req('POST', '/api/accounts', alice, { name: 'Bank', type: 'bank', openingBalanceCents: 10000 })).json() as Account;
  const cash = (await req('POST', '/api/accounts', alice, { name: 'Cash', type: 'cash' })).json() as Account;
  const cats = (await req('GET', '/api/categories', alice)).json() as Category[];
  const groceries = cats.find((c) => c.name === 'Groceries')!.id;
  const salary = cats.find((c) => c.name === 'Salary')!.id;

  await req('POST', '/api/transactions', alice, {
    date: '2026-07-10', amountCents: -2500, accountId: bank.id, categoryId: groceries, description: 'Lidl',
  });
  await req('POST', '/api/transactions', alice, {
    date: '2026-07-25', amountCents: 5000, accountId: bank.id, categoryId: salary, description: 'Pay',
  });
  const tr = await req('POST', '/api/transfers', alice, {
    date: '2026-07-26', fromAccountId: bank.id, toAccountId: cash.id, amountCents: 3000,
  });
  expect(tr.statusCode).toBe(201);

  const accounts = (await req('GET', '/api/accounts', alice)).json() as Account[];
  const byName = Object.fromEntries(accounts.map((a) => [a.name, a.balanceCents]));
  expect(byName.Bank).toBe(10000 - 2500 + 5000 - 3000); // 9500
  expect(byName.Cash).toBe(3000);

  const dash = (await req('GET', '/api/dashboard?month=2026-07', alice)).json() as DashboardResponse;
  expect(dash.incomeCents).toBe(5000); // transfer +3000 leg excluded
  expect(dash.expenseCents).toBe(-2500); // transfer -3000 leg excluded
  expect(dash.netCents).toBe(2500);
  const grocRow = dash.byCategory.find((c) => c.name === 'Groceries');
  expect(grocRow?.totalCents).toBe(-2500);
});

test('deleting a transfer removes both legs (balances revert)', async () => {
  const a = (await req('POST', '/api/accounts', alice, { name: 'A', type: 'cash', openingBalanceCents: 5000 })).json() as Account;
  const b = (await req('POST', '/api/accounts', alice, { name: 'B', type: 'cash' })).json() as Account;
  const tr = (await req('POST', '/api/transfers', alice, { date: '2026-07-01', fromAccountId: a.id, toAccountId: b.id, amountCents: 2000 })).json();
  let accs = (await req('GET', '/api/accounts', alice)).json() as Account[];
  expect(accs.find((x) => x.id === b.id)!.balanceCents).toBe(2000);
  const del = await req('DELETE', `/api/transfers/${tr.id}`, alice);
  expect(del.statusCode).toBe(204);
  accs = (await req('GET', '/api/accounts', alice)).json() as Account[];
  expect(accs.find((x) => x.id === a.id)!.balanceCents).toBe(5000);
  expect(accs.find((x) => x.id === b.id)!.balanceCents).toBe(0);
});

test('users are isolated', async () => {
  const aliceAccts = (await req('GET', '/api/accounts', alice)).json() as Account[];
  const bobAccts = (await req('GET', '/api/accounts', bob)).json() as Account[];
  expect(aliceAccts.length).toBeGreaterThan(0);
  expect(bobAccts.length).toBe(0);
  // bob cannot touch alice's account
  const patch = await req('PATCH', `/api/accounts/${aliceAccts[0].id}`, bob, { name: 'hacked' });
  expect(patch.statusCode).toBe(404);
});

test('category parent is validated (existence, ownership, no self-parent)', async () => {
  const cats = (await req('GET', '/api/categories', alice)).json() as Category[];
  const bogus = await req('POST', '/api/categories', alice, { name: 'X', kind: 'expense', parentId: 999999 });
  expect(bogus.statusCode).toBe(400);
  const child = (await req('POST', '/api/categories', alice, { name: 'Child', kind: 'expense', parentId: cats[0].id })).json() as Category;
  const selfParent = await req('PATCH', `/api/categories/${child.id}`, alice, { parentId: child.id });
  expect(selfParent.statusCode).toBe(400);
  // bob cannot parent under alice's category
  const cross = await req('POST', '/api/categories', bob, { name: 'Y', kind: 'expense', parentId: cats[0].id });
  expect(cross.statusCode).toBe(400);
});

test('validation and guards', async () => {
  const bad = await req('POST', '/api/transactions', alice, { date: 'nope', amountCents: 0, accountId: 1 });
  expect(bad.statusCode).toBe(400);
  const accts = (await req('GET', '/api/accounts', alice)).json() as Account[];
  const withTx = accts.find((a) => a.name === 'Bank')!;
  const del = await req('DELETE', `/api/accounts/${withTx.id}`, alice);
  expect(del.statusCode).toBe(409); // has transactions → archive instead
  const selfTransfer = await req('POST', '/api/transfers', alice, { date: '2026-07-01', fromAccountId: withTx.id, toAccountId: withTx.id, amountCents: 100 });
  expect(selfTransfer.statusCode).toBe(400);
});

test('a loan rate switch must set both the month and the rate, or neither', async () => {
  const half = await req('POST', '/api/accounts', alice, { name: 'L1', type: 'loan', rateVariableFrom: '2027-06' });
  expect(half.statusCode).toBe(400); // month without a rate

  const otherHalf = await req('POST', '/api/accounts', alice, { name: 'L2', type: 'loan', variableRateBps: 295 });
  expect(otherHalf.statusCode).toBe(400); // rate without a month

  const ok = await req('POST', '/api/accounts', alice, {
    name: 'Mortgage', type: 'loan', openingBalanceCents: -100000,
    interestRateBps: 270, monthlyPaymentCents: 50000,
    rateVariableFrom: '2027-06', variableRateBps: 295,
  });
  expect(ok.statusCode).toBe(201);

  // PATCH is partial, so the pair is checked against the merged result.
  const loan = ok.json() as Account;
  const breakPair = await req('PATCH', `/api/accounts/${loan.id}`, alice, { variableRateBps: null });
  expect(breakPair.statusCode).toBe(400); // would leave the month set with no rate
  const clearBoth = await req('PATCH', `/api/accounts/${loan.id}`, alice, { rateVariableFrom: null, variableRateBps: null });
  expect(clearBoth.statusCode).toBe(200);
});

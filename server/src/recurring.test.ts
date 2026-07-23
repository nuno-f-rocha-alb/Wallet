import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Account, ForecastPoint, Occurrence, RecurringRule, RuleSuggestion, Transaction } from '@wallet/shared';
import { detectRecurring, occurrencesBetween, projectForecast } from './recurring.js';

const baseRule = (over: Partial<RecurringRule>): RecurringRule => ({
  id: 1,
  cadence: 'monthly',
  dayOfMonth: 1,
  month: null,
  amountCents: -10000,
  accountId: 1,
  categoryId: null,
  description: 'Rent',
  note: null,
  autoPost: false,
  startDate: '2000-01-01',
  endDate: null,
  lastPostedDate: null,
  archived: false,
  ...over,
});

// ---- DoD: next-date generation incl. month-end clamp & yearly ----

test('day-31 rule clamps to each month end', () => {
  const rule = baseRule({ dayOfMonth: 31 });
  expect(occurrencesBetween(rule, '2026-01-01', '2026-04-30')).toEqual([
    '2026-01-31',
    '2026-02-28', // clamped (2026 not a leap year)
    '2026-03-31',
    '2026-04-30', // April has 30 days
  ]);
  // leap year February
  expect(occurrencesBetween(rule, '2024-02-01', '2024-02-29')).toEqual(['2024-02-29']);
});

test('yearly rule fires only in its month', () => {
  const rule = baseRule({ cadence: 'yearly', month: 3, dayOfMonth: 15 });
  expect(occurrencesBetween(rule, '2026-01-01', '2027-12-31')).toEqual(['2026-03-15', '2027-03-15']);
});

test('start/end dates bound occurrences', () => {
  const rule = baseRule({ dayOfMonth: 10, startDate: '2026-02-10', endDate: '2026-04-10' });
  expect(occurrencesBetween(rule, '2026-01-01', '2026-12-31')).toEqual(['2026-02-10', '2026-03-10', '2026-04-10']);
});

// ---- DoD: forecast month-end balances for a fixture ----

test('forecast projects recurring occurrences onto month-end balances', () => {
  const rule = baseRule({ dayOfMonth: 1, amountCents: -10000 }); // -€100 on the 1st
  const points = projectForecast({
    currentTotalCents: 100000, // €1000
    avgMonthlyNetCents: 0,
    rules: [rule],
    fromISO: '2026-01-15',
    months: 3,
  });
  // Jan-end: the 1st already passed (< from) → €1000. Feb-end: +02-01 → €900. Mar-end: +02-01,03-01 → €800.
  expect(points).toEqual<ForecastPoint[]>([
    { month: '2026-01', balanceCents: 100000 },
    { month: '2026-02', balanceCents: 90000 },
    { month: '2026-03', balanceCents: 80000 },
  ]);
});

test('forecast adds the historical monthly average', () => {
  const points = projectForecast({
    currentTotalCents: 0,
    avgMonthlyNetCents: 5000, // +€50/month
    rules: [],
    fromISO: '2026-01-15',
    months: 3,
  });
  expect(points.map((p) => p.balanceCents)).toEqual([5000, 10000, 15000]);
});

// ---- DoD: detector recovers a known recurring series ----

test('detectRecurring recovers a monthly series and ignores one-offs', () => {
  const series = detectRecurring([
    { date: '2026-01-15', amountCents: -999, accountId: 1, categoryId: 7, description: 'Netflix' },
    { date: '2026-02-15', amountCents: -999, accountId: 1, categoryId: 7, description: 'netflix' }, // case-insensitive
    { date: '2026-03-16', amountCents: -999, accountId: 1, categoryId: 7, description: 'Netflix' }, // ±1 day still stable
    { date: '2026-01-03', amountCents: -4200, accountId: 1, categoryId: 2, description: 'Random shop' },
  ]);
  expect(series).toHaveLength(1);
  expect(series[0]).toMatchObject<Partial<RuleSuggestion>>({
    cadence: 'monthly',
    dayOfMonth: 15,
    amountCents: -999,
    accountId: 1,
    categoryId: 7,
    description: 'Netflix',
    count: 3,
  });
});

// ---- endpoints: CRUD, idempotent auto-post, isolation ----

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

const ymd = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wallet-rec-'));
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

test('auto-post is idempotent (running twice makes one transaction) + isolation', async () => {
  const acct = (await req('POST', '/api/accounts', alice, { name: 'Bank', type: 'bank', openingBalanceCents: 100000 })).json() as Account;

  // A rule with an autopost date that already passed → catch-up should post it.
  const startDate = ymd(new Date(Date.now() - 90 * 86400000));
  const yesterday = new Date(Date.now() - 86400000).getUTCDate();
  const rule = (await req('POST', '/api/recurring', alice, {
    cadence: 'monthly', dayOfMonth: yesterday, amountCents: -5000, accountId: acct.id,
    description: 'Gym', autoPost: true, startDate,
  })).json() as RecurringRule;
  expect(rule.id).toBeGreaterThan(0);

  const run1 = (await req('POST', '/api/recurring/run', alice)).json() as { posted: number };
  expect(run1.posted).toBeGreaterThanOrEqual(1);
  const after1 = ((await req('GET', '/api/transactions', alice, undefined)).json() as Transaction[])
    .filter((t) => t.source === 'recurring').length;

  const run2 = (await req('POST', '/api/recurring/run', alice)).json() as { posted: number };
  expect(run2.posted).toBe(0); // already caught up
  const after2 = ((await req('GET', '/api/transactions?limit=500', alice)).json() as Transaction[])
    .filter((t) => t.source === 'recurring').length;
  expect(after2).toBe(after1); // no duplicates

  // archive is reachable via PATCH and drops the rule from auto-post/upcoming
  expect((await req('PATCH', `/api/recurring/${rule.id}`, alice, { archived: true })).statusCode).toBe(200);
  expect(((await req('GET', '/api/recurring', alice)).json() as RecurringRule[]).find((r) => r.id === rule.id)?.archived).toBe(true);
  expect((await req('POST', '/api/recurring/run', alice)).json()).toMatchObject({ posted: 0 }); // archived → skipped
  await req('PATCH', `/api/recurring/${rule.id}`, alice, { archived: false }); // restore for later assertions

  // isolation: bob sees no rules and cannot post/patch alice's
  expect(((await req('GET', '/api/recurring', bob)).json() as RecurringRule[]).length).toBe(0);
  expect((await req('PATCH', `/api/recurring/${rule.id}`, bob, { description: 'hack' })).statusCode).toBe(404);

  // validation: yearly needs a month; zero amount rejected
  expect((await req('POST', '/api/recurring', alice, { cadence: 'yearly', dayOfMonth: 1, amountCents: -100, accountId: acct.id, startDate })).statusCode).toBe(400);
  expect((await req('POST', '/api/recurring', alice, { cadence: 'monthly', dayOfMonth: 1, amountCents: 0, accountId: acct.id, startDate })).statusCode).toBe(400);
});

test('upcoming, forecast and suggestions endpoints', async () => {
  const acct = (await req('POST', '/api/accounts', alice, { name: 'Cash', type: 'cash' })).json() as Account;

  // future monthly rule → appears in upcoming
  const nextMonth = new Date();
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  await req('POST', '/api/recurring', alice, {
    cadence: 'monthly', dayOfMonth: 5, amountCents: -2000, accountId: acct.id,
    description: 'Spotify', autoPost: false, startDate: ymd(new Date()),
  });
  const up = (await req('GET', '/api/recurring/upcoming?days=70', alice)).json() as Occurrence[];
  expect(up.some((o) => o.description === 'Spotify')).toBe(true);
  expect(up.every((o, i) => i === 0 || up[i - 1].date <= o.date)).toBe(true); // sorted

  const fc = (await req('GET', '/api/forecast?months=4', alice)).json() as ForecastPoint[];
  expect(fc).toHaveLength(4);
  expect(fc[0]).toHaveProperty('balanceCents');

  // seed a detectable series (3 months, same day/amount) → suggestions surfaces it
  for (const m of ['2026-01', '2026-02', '2026-03']) {
    await req('POST', '/api/transactions', alice, { date: `${m}-20`, amountCents: -799, accountId: acct.id, description: 'CloudDrive' });
  }
  const sug = (await req('GET', '/api/recurring/suggestions', alice)).json() as RuleSuggestion[];
  const cloud = sug.find((s) => s.description === 'CloudDrive');
  expect(cloud).toMatchObject({ dayOfMonth: 20, amountCents: -799, count: 3 });
});

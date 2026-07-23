import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CarStatsResponse, FuelEntry, Vehicle } from '@wallet/shared';
import { computeFuelStats, type FuelEntryCalc } from './car.js';

// ---- pure maths (DoD): fuel log → L/100km, €/L, €/km, incl. a partial fill ----

test('L/100km, €/L, €/km match hand-computed values (with a partial fill)', () => {
  // Litres as ml, price as cents. Odometer in km.
  // Distinct per-fill prices so a per-fill vs aggregate €/L mix-up can't pass.
  // full @ 1000km (baseline, 40L @ €60 = €1.50/L) — no interval yet
  // partial @ 1300km (10L @ €15 = €1.50/L) — accumulates, no L/100km point
  // full @ 1500km (30L @ €60 = €2.00/L) — closes the interval 1000→1500
  const entries: FuelEntryCalc[] = [
    { date: '2026-01-01', odometerKm: 1000, litersMl: 40000, totalPriceCents: 6000, isFull: true },
    { date: '2026-01-10', odometerKm: 1300, litersMl: 10000, totalPriceCents: 1500, isFull: false },
    { date: '2026-01-20', odometerKm: 1500, litersMl: 30000, totalPriceCents: 6000, isFull: true },
  ];
  const { points, summary } = computeFuelStats(entries);

  // Interval: distance 500km, fuel consumed = partial 10L + top-up 30L = 40L,
  // cost €15 + €60 = €75. L/100km = 40/500*100 = 8. €/km = 75/500 = 0.15.
  const closed = points.find((p) => p.l100km !== null)!;
  expect(closed.odometerKm).toBe(1500);
  expect(closed.l100km).toBeCloseTo(8, 6);

  // per-fill €/L on the closing fill = 60/30 = 2.00 (differs from the 1.875 aggregate)
  expect(closed.eurPerL).toBeCloseTo(2, 6);

  expect(summary.avgL100km).toBeCloseTo(8, 6);
  expect(summary.eurPerL).toBeCloseTo(1.875, 6); // €75 / 40L
  expect(summary.eurPerKm).toBeCloseTo(0.15, 6);
  expect(summary.totalDistanceKm).toBe(500);
  expect(summary.totalLiters).toBeCloseTo(40, 6);
});

test('a single full fill yields no interval; unsorted input is handled', () => {
  const { points, summary } = computeFuelStats([
    { date: '2026-02-02', odometerKm: 2000, litersMl: 35000, totalPriceCents: 5250, isFull: true },
    { date: '2026-02-01', odometerKm: 1800, litersMl: 30000, totalPriceCents: 4500, isFull: true },
  ]);
  // sorted by odometer → first (1800) baseline, second (2000) closes 200km/35L
  expect(summary.totalDistanceKm).toBe(200);
  expect(summary.avgL100km).toBeCloseTo(35 / 200 * 100, 6); // 17.5
  expect(points[0].l100km).toBeNull(); // baseline fill
  expect(points[1].l100km).toBeCloseTo(17.5, 6);
});

// ---- endpoint wiring + tenant isolation ----

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
  dir = mkdtempSync(join(tmpdir(), 'wallet-car-'));
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

test('vehicle + fuel CRUD, stats endpoint, and tenant isolation', async () => {
  const v = (await req('POST', '/api/vehicles', alice, { name: 'Golf', make: 'VW' })).json() as Vehicle;
  expect(v.id).toBeGreaterThan(0);

  const mk = (date: string, odo: number, ml: number, cents: number, full = true) =>
    req('POST', '/api/fuel', alice, { vehicleId: v.id, date, odometerKm: odo, litersMl: ml, totalPriceCents: cents, isFull: full });
  await mk('2026-03-01', 1000, 40000, 6000);
  await mk('2026-03-10', 1300, 10000, 1500, false);
  await mk('2026-03-20', 1500, 30000, 4500);

  const stats = (await req('GET', `/api/vehicles/${v.id}/stats`, alice)).json() as CarStatsResponse;
  expect(stats.entries.length).toBe(3);
  expect(stats.summary.avgL100km).toBeCloseTo(8, 6);
  expect(stats.monthlyCosts[0].month).toBe('2026-03');
  expect(stats.monthlyCosts[0].fuelCents).toBe(6000 + 1500 + 4500);

  // bob cannot see alice's vehicle or its stats
  expect(((await req('GET', '/api/vehicles', bob)).json() as Vehicle[]).length).toBe(0);
  expect((await req('GET', `/api/vehicles/${v.id}/stats`, bob)).statusCode).toBe(404);
  // bob cannot attach fuel to alice's vehicle
  expect(
    (await req('POST', '/api/fuel', bob, { vehicleId: v.id, date: '2026-03-01', odometerKm: 1, litersMl: 1, totalPriceCents: 1 })).statusCode,
  ).toBe(400);

  // delete blocked while entries exist → archive instead
  expect((await req('DELETE', `/api/vehicles/${v.id}`, alice)).statusCode).toBe(409);

  // bad input rejected
  expect((await req('POST', '/api/vehicles', alice, { name: '' })).statusCode).toBe(400);
  expect(
    (await req('POST', '/api/fuel', alice, { vehicleId: v.id, date: 'nope', odometerKm: 0, litersMl: 0, totalPriceCents: -1 })).statusCode,
  ).toBe(400);
  // impossible calendar date rejected (regex-valid but no Feb 31)
  expect(
    (await req('POST', '/api/fuel', alice, { vehicleId: v.id, date: '2026-02-31', odometerKm: 2000, litersMl: 1000, totalPriceCents: 100 })).statusCode,
  ).toBe(400);

  const entries = (await req('GET', `/api/fuel?vehicleId=${v.id}`, alice)).json() as FuelEntry[];
  await req('DELETE', `/api/fuel/${entries[0].id}`, alice);
  expect(((await req('GET', `/api/fuel?vehicleId=${v.id}`, alice)).json() as FuelEntry[]).length).toBe(2);
});

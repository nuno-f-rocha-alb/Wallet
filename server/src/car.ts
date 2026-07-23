import type { DatabaseSync } from 'node:sqlite';
import type {
  CarStatsResponse,
  FuelEntry,
  FuelPoint,
  FuelSummary,
  MonthlyCarCost,
  Vehicle,
} from '@wallet/shared';
import { HttpError } from './errors.js';
import { applyUpdate } from './service.js';

type Row = Record<string, unknown>;
const one = <T>(r: unknown): T => r as T;
const rows = <T>(r: unknown[]): T[] => r as T[];

// ---- pure fuel maths (DoD unit under test — no DB) ----

export interface FuelEntryCalc {
  date: string;
  odometerKm: number;
  litersMl: number;
  totalPriceCents: number;
  isFull: boolean;
}

/**
 * L/100km between consecutive full fills. Partial fills don't close an interval;
 * their litres/cost accumulate into the next full fill (tank starts full, ends
 * full → fuel added over the interval == fuel consumed). €/L is per-fill; the
 * summary's €/L, €/km and avg L/100km use only fuel actually consumed between
 * full tanks. Integer ml/cents in, so: L/100km = ml/dist/10, €/L = cents*10/ml,
 * €/km = cents/(100*dist).
 */
export function computeFuelStats(entries: FuelEntryCalc[]): {
  points: FuelPoint[];
  summary: FuelSummary;
} {
  const sorted = [...entries].sort((a, b) => a.odometerKm - b.odometerKm);
  const points: FuelPoint[] = [];
  let lastFullOdo: number | null = null;
  let accMl = 0;
  let accCents = 0;
  let sumDist = 0;
  let sumMl = 0;
  let sumCents = 0;

  for (const e of sorted) {
    accMl += e.litersMl;
    accCents += e.totalPriceCents;
    let l100km: number | null = null;
    if (e.isFull) {
      if (lastFullOdo !== null) {
        const dist = e.odometerKm - lastFullOdo;
        if (dist > 0) {
          l100km = accMl / dist / 10;
          sumDist += dist;
          sumMl += accMl;
          sumCents += accCents;
        }
      }
      lastFullOdo = e.odometerKm;
      accMl = 0;
      accCents = 0;
    }
    points.push({
      date: e.date,
      odometerKm: e.odometerKm,
      eurPerL: e.litersMl > 0 ? (e.totalPriceCents * 10) / e.litersMl : 0,
      l100km,
    });
  }

  const summary: FuelSummary = {
    avgL100km: sumDist > 0 ? sumMl / sumDist / 10 : null,
    eurPerL: sumMl > 0 ? (sumCents * 10) / sumMl : null,
    eurPerKm: sumDist > 0 ? sumCents / (100 * sumDist) : null,
    totalDistanceKm: sumDist,
    totalLiters: sumMl / 1000,
    totalCostCents: sumCents,
  };
  return { points, summary };
}

// ---- mappers ----

function toVehicle(r: Row): Vehicle {
  return {
    id: r.id as number,
    name: r.name as string,
    make: (r.make as string | null) ?? null,
    plate: (r.plate as string | null) ?? null,
    archived: !!r.archived,
    sort: r.sort as number,
  };
}
function toFuelEntry(r: Row): FuelEntry {
  return {
    id: r.id as number,
    vehicleId: r.vehicle_id as number,
    date: r.date as string,
    odometerKm: r.odometer_km as number,
    litersMl: r.liters_ml as number,
    totalPriceCents: r.total_price_cents as number,
    isFull: !!r.is_full,
    note: (r.note as string | null) ?? null,
  };
}

// ---- vehicles ----

export function listVehicles(db: DatabaseSync, userId: number): Vehicle[] {
  return rows<Row>(
    db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY sort, id').all(userId),
  ).map(toVehicle);
}

export function getVehicle(db: DatabaseSync, userId: number, id: number): Vehicle {
  const r = db.prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ?').get(id, userId);
  if (!r) throw new HttpError(404, 'vehicle not found');
  return toVehicle(one<Row>(r));
}

export function createVehicle(
  db: DatabaseSync,
  userId: number,
  input: Omit<Vehicle, 'id' | 'archived'>,
): Vehicle {
  const info = db
    .prepare('INSERT INTO vehicles(user_id,name,make,plate,sort) VALUES(?,?,?,?,?)')
    .run(userId, input.name, input.make, input.plate, input.sort);
  return getVehicle(db, userId, Number(info.lastInsertRowid));
}

const VEHICLE_COLS = { name: 'name', make: 'make', plate: 'plate', archived: 'archived', sort: 'sort' };

export function updateVehicle(
  db: DatabaseSync,
  userId: number,
  id: number,
  patch: Record<string, unknown>,
): Vehicle {
  const changed = applyUpdate(db, 'vehicles', VEHICLE_COLS, patch, id, userId);
  if (changed === 0 && !db.prepare('SELECT 1 FROM vehicles WHERE id=? AND user_id=?').get(id, userId))
    throw new HttpError(404, 'vehicle not found');
  return getVehicle(db, userId, id);
}

export function deleteVehicle(db: DatabaseSync, userId: number, id: number): void {
  const used = one<{ n: number }>(
    db.prepare('SELECT COUNT(*) AS n FROM fuel_entries WHERE vehicle_id = ? AND user_id = ?').get(id, userId),
  ).n;
  if (used > 0) throw new HttpError(409, 'vehicle has fuel entries; archive it instead');
  const changes = db.prepare('DELETE FROM vehicles WHERE id = ? AND user_id = ?').run(id, userId).changes;
  if (changes === 0) throw new HttpError(404, 'vehicle not found');
}

// ---- fuel entries ----

function assertVehicle(db: DatabaseSync, userId: number, vehicleId: number): void {
  if (!db.prepare('SELECT 1 FROM vehicles WHERE id=? AND user_id=?').get(vehicleId, userId))
    throw new HttpError(400, 'vehicle not found');
}

export function listFuelEntries(db: DatabaseSync, userId: number, vehicleId: number): FuelEntry[] {
  return rows<Row>(
    db
      .prepare('SELECT * FROM fuel_entries WHERE user_id=? AND vehicle_id=? ORDER BY odometer_km DESC, id DESC')
      .all(userId, vehicleId),
  ).map(toFuelEntry);
}

export function getFuelEntry(db: DatabaseSync, userId: number, id: number): FuelEntry {
  const r = db.prepare('SELECT * FROM fuel_entries WHERE id=? AND user_id=?').get(id, userId);
  if (!r) throw new HttpError(404, 'fuel entry not found');
  return toFuelEntry(one<Row>(r));
}

export function createFuelEntry(
  db: DatabaseSync,
  userId: number,
  input: Omit<FuelEntry, 'id'>,
): FuelEntry {
  assertVehicle(db, userId, input.vehicleId);
  const info = db
    .prepare(
      `INSERT INTO fuel_entries(user_id,vehicle_id,date,odometer_km,liters_ml,total_price_cents,is_full,note)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(
      userId,
      input.vehicleId,
      input.date,
      input.odometerKm,
      input.litersMl,
      input.totalPriceCents,
      input.isFull ? 1 : 0,
      input.note,
    );
  return getFuelEntry(db, userId, Number(info.lastInsertRowid));
}

const FUEL_COLS = {
  date: 'date',
  odometerKm: 'odometer_km',
  litersMl: 'liters_ml',
  totalPriceCents: 'total_price_cents',
  isFull: 'is_full',
  note: 'note',
};

export function updateFuelEntry(
  db: DatabaseSync,
  userId: number,
  id: number,
  patch: Record<string, unknown>,
): FuelEntry {
  getFuelEntry(db, userId, id); // 404s if missing
  applyUpdate(db, 'fuel_entries', FUEL_COLS, patch, id, userId);
  return getFuelEntry(db, userId, id);
}

export function deleteFuelEntry(db: DatabaseSync, userId: number, id: number): void {
  const changes = db.prepare('DELETE FROM fuel_entries WHERE id=? AND user_id=?').run(id, userId).changes;
  if (changes === 0) throw new HttpError(404, 'fuel entry not found');
}

// ---- stats ----

// Ids of the seeded "Car" category and its children. Fuel is tracked in the fuel
// log, so log fuel there rather than as a Car>Fuel transaction to avoid double
// counting. Identity is the stable system_key (survives a rename), not the name.
function carCategoryIds(db: DatabaseSync, userId: number): number[] {
  const parent = db
    .prepare("SELECT id FROM categories WHERE user_id=? AND system_key='car'")
    .get(userId) as { id: number } | undefined;
  if (!parent) return [];
  const kids = rows<{ id: number }>(
    db.prepare('SELECT id FROM categories WHERE user_id=? AND parent_id=?').all(userId, parent.id),
  ).map((r) => r.id);
  return [parent.id, ...kids];
}

function monthlyCosts(db: DatabaseSync, userId: number, vehicleId: number): MonthlyCarCost[] {
  const byMonth = new Map<string, MonthlyCarCost>();
  const get = (m: string): MonthlyCarCost => {
    let row = byMonth.get(m);
    if (!row) {
      row = { month: m, fuelCents: 0, otherCents: 0, reimbursedCents: 0, totalCents: 0 };
      byMonth.set(m, row);
    }
    return row;
  };

  for (const r of rows<{ m: string; c: number }>(
    db
      .prepare(
        "SELECT substr(date,1,7) AS m, SUM(total_price_cents) AS c FROM fuel_entries WHERE user_id=? AND vehicle_id=? GROUP BY m",
      )
      .all(userId, vehicleId),
  )) {
    get(r.m).fuelCents = r.c;
  }

  const catIds = carCategoryIds(db, userId);
  if (catIds.length > 0) {
    const placeholders = catIds.map(() => '?').join(',');
    for (const r of rows<{ m: string; exp: number; inc: number }>(
      db
        .prepare(
          `SELECT substr(date,1,7) AS m,
             SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS exp,
             SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS inc
           FROM transactions
           WHERE user_id=? AND transfer_id IS NULL AND category_id IN (${placeholders})
           GROUP BY m`,
        )
        .all(userId, ...catIds),
    )) {
      const row = get(r.m);
      row.otherCents = r.exp;
      row.reimbursedCents = r.inc;
    }
  }

  for (const row of byMonth.values()) {
    row.totalCents = row.fuelCents + row.otherCents - row.reimbursedCents;
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
}

export function getCarStats(db: DatabaseSync, userId: number, vehicleId: number): CarStatsResponse {
  getVehicle(db, userId, vehicleId); // 404s if not owned
  const entries = listFuelEntries(db, userId, vehicleId);
  const { points, summary } = computeFuelStats(
    entries.map((e) => ({
      date: e.date,
      odometerKm: e.odometerKm,
      litersMl: e.litersMl,
      totalPriceCents: e.totalPriceCents,
      isFull: e.isFull,
    })),
  );
  return { vehicleId, entries, points, summary, monthlyCosts: monthlyCosts(db, userId, vehicleId) };
}

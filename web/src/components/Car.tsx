import { useEffect, useState } from 'react';
import type { FuelEntry, FuelPoint, MonthlyCarCost, Vehicle } from '@wallet/shared';
import { useCarStats, useVehicles } from '../api';
import { dayLabel, liters, money, monthLabel, num } from '../format';
import { btnGhost, btnPrimary, card } from './ui';

export function Car({
  onAddVehicle,
  onEditVehicle,
  onAddFuel,
  onEditFuel,
}: {
  onAddVehicle: () => void;
  onEditVehicle: (v: Vehicle) => void;
  onAddFuel: (vehicleId: number) => void;
  onEditFuel: (vehicleId: number, entry: FuelEntry) => void;
}) {
  const vehicles = useVehicles();
  const list = vehicles.data ?? [];
  const [selected, setSelected] = useState<number>();

  // Default to (and keep) a valid selection as vehicles load/change.
  useEffect(() => {
    if (list.length === 0) setSelected(undefined);
    else if (selected === undefined || !list.some((v) => v.id === selected)) setSelected(list[0].id);
  }, [list, selected]);

  const stats = useCarStats(selected);
  const current = list.find((v) => v.id === selected);

  if (vehicles.isLoading) return <p className="p-6 text-slate-400">Loading…</p>;

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-500">Vehicles</h3>
        <button className={btnPrimary} onClick={onAddVehicle}>Add vehicle</button>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-slate-400">No vehicles yet — add one to start logging fuel.</p>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {list.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelected(v.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
                  v.id === selected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>

          {current && (
            <div className="flex items-center justify-between">
              <button className="text-sm text-slate-400 hover:text-slate-600" onClick={() => onEditVehicle(current)}>
                Edit {current.name}
                {current.make ? ` · ${current.make}` : ''}
              </button>
              <button className={btnGhost} onClick={() => onAddFuel(current.id)}>Add fuel</button>
            </div>
          )}

          {stats.isLoading && <p className="text-slate-400">Loading stats…</p>}
          {stats.data && (
            <>
              {/* summary tiles */}
              <div className={`${card} grid grid-cols-3 divide-x divide-slate-100 p-4 dark:divide-slate-700`}>
                <Tile label="L/100km" value={num(stats.data.summary.avgL100km)} />
                <Tile label="€/L" value={num(stats.data.summary.eurPerL)} />
                <Tile label="€/km" value={num(stats.data.summary.eurPerKm, 3)} />
              </div>

              <Trend title="L/100km" points={stats.data.points} pick={(p) => p.l100km} digits={1} />
              <Trend title="€/L" points={stats.data.points} pick={(p) => p.eurPerL} digits={2} />
              <MonthlyCosts rows={stats.data.monthlyCosts} />

              {/* fuel log */}
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-500">Fuel log</h3>
                {stats.data.entries.length === 0 ? (
                  <p className="text-sm text-slate-400">No fuel entries yet.</p>
                ) : (
                  <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
                    {stats.data.entries.map((e) => (
                      <li key={e.id}>
                        <button
                          onClick={() => onEditFuel(e.vehicleId, e)}
                          className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          <span className="w-12 shrink-0 text-xs text-slate-400">{dayLabel(e.date)}</span>
                          <span className="flex-1 text-sm">
                            {e.odometerKm.toLocaleString()} km · {liters(e.litersMl)}
                            {e.isFull ? '' : ' (partial)'}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{money(e.totalPriceCents)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// CSS-bar trend (no chart lib): one bar per point that has a value.
function Trend({
  title,
  points,
  pick,
  digits,
}: {
  title: string;
  points: FuelPoint[];
  pick: (p: FuelPoint) => number | null;
  digits: number;
}) {
  const data = points.map((p) => ({ date: p.date, v: pick(p) })).filter((d): d is { date: string; v: number } => d.v != null && d.v > 0);
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.v));
  return (
    <section className={`${card} p-4`}>
      <h3 className="mb-3 text-sm font-semibold text-slate-500">{title}</h3>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-slate-400">{dayLabel(d.date)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full bg-blue-400" style={{ width: `${(d.v / max) * 100}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right text-sm tabular-nums">{d.v.toFixed(digits)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Monthly car spend split: fuel + other Car costs − reimbursements, as a stacked CSS bar.
function MonthlyCosts({ rows }: { rows: MonthlyCarCost[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.fuelCents + r.otherCents));
  return (
    <section className={`${card} p-4`}>
      <h3 className="mb-1 text-sm font-semibold text-slate-500">Monthly car spend</h3>
      {/* Bar shows gross spend (fuel + other); the total nets out reimbursements. */}
      <p className="mb-3 flex gap-3 text-[11px] text-slate-400">
        <Legend color="bg-blue-400" text="fuel" />
        <Legend color="bg-amber-400" text="other" />
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.month} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-slate-400">{monthLabel(r.month)}</span>
            <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full bg-blue-400" style={{ width: `${(r.fuelCents / max) * 100}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${(r.otherCents / max) * 100}%` }} />
            </div>
            <span className="w-20 shrink-0 text-right text-sm tabular-nums">{money(r.totalCents)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {text}
    </span>
  );
}

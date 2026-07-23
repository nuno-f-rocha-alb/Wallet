import { useStats } from '../api';
import { money, monthLabel } from '../format';
import { card } from './ui';

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function Stats() {
  const { data, isLoading } = useStats(12);
  if (isLoading || !data) return <p className="p-4 text-sm text-slate-400">Loading…</p>;

  const { trend, fiscalYear: fy, previousFiscalYear: prev, byCategory } = data;
  const maxNet = Math.max(1, ...trend.map((t) => Math.abs(t.netCents)));
  const yoy = prev.netCents !== 0 ? (fy.netCents - prev.netCents) / Math.abs(prev.netCents) : null;
  const expenses = byCategory.filter((c) => c.totalCents < 0);
  const maxExp = Math.max(1, ...expenses.map((c) => Math.abs(c.totalCents)));

  return (
    <div className="space-y-6 p-4">
      {/* fiscal-year tiles */}
      <section className="grid grid-cols-3 gap-2">
        <div className={`${card} p-3`}>
          <p className="text-xs text-slate-400">FY {fy.label} net</p>
          <p className={`text-lg font-semibold tabular-nums ${fy.netCents < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(fy.netCents)}</p>
        </div>
        <div className={`${card} p-3`}>
          <p className="text-xs text-slate-400">Savings rate</p>
          <p className="text-lg font-semibold tabular-nums">{pct(fy.savingsRate)}</p>
        </div>
        <div className={`${card} p-3`}>
          <p className="text-xs text-slate-400">vs FY {prev.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${yoy == null ? 'text-slate-400' : yoy >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {yoy == null ? '—' : `${yoy >= 0 ? '+' : ''}${pct(yoy)}`}
          </p>
        </div>
      </section>

      {/* monthly net trend */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Net by month</h3>
        <div className={`${card} space-y-1 p-3`}>
          {trend.map((t) => (
            <div key={t.month} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-slate-400">{monthLabel(t.month).slice(0, 3)} {t.month.slice(2, 4)}</span>
              <div className="flex h-4 flex-1 items-center">
                <div
                  className={`h-3 rounded ${t.netCents < 0 ? 'bg-red-500/70' : 'bg-green-500/70'}`}
                  style={{ width: `${(Math.abs(t.netCents) / maxNet) * 100}%` }}
                />
              </div>
              <span className={`w-20 shrink-0 text-right tabular-nums ${t.netCents < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(t.netCents)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* expense breakdown for the fiscal year */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">FY {fy.label} expenses by category</h3>
        {expenses.length === 0 ? (
          <p className="text-sm text-slate-400">No expenses recorded this fiscal year.</p>
        ) : (
          <div className={`${card} space-y-1 p-3`}>
            {expenses.map((c) => (
              <div key={c.categoryId ?? 'none'} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate text-slate-500">{c.name}</span>
                <div className="flex h-4 flex-1 items-center">
                  <div className="h-3 rounded bg-blue-500/70" style={{ width: `${(Math.abs(c.totalCents) / maxExp) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right tabular-nums">{money(c.totalCents)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

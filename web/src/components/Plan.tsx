import type { RecurringRule, RuleSuggestion } from '@wallet/shared';
import { useForecast, useRecurring, useSuggestions, useUpcoming } from '../api';
import { dayLabel, money, monthLabel } from '../format';
import { btnGhost, btnPrimary, card } from './ui';

export function Plan({
  onAddRule,
  onEditRule,
  onCreateFromSuggestion,
}: {
  onAddRule: () => void;
  onEditRule: (r: RecurringRule) => void;
  onCreateFromSuggestion: (s: RuleSuggestion) => void;
}) {
  const forecast = useForecast(6);
  const upcoming = useUpcoming(60);
  const rules = useRecurring();
  const suggestions = useSuggestions();

  const fc = forecast.data ?? [];
  const maxAbs = Math.max(1, ...fc.map((p) => Math.abs(p.balanceCents)));
  const rec = rules.data ?? [];
  const up = upcoming.data ?? [];
  const sug = suggestions.data ?? [];

  return (
    <div className="space-y-6 p-4">
      {/* forecast */}
      {fc.length > 0 && (
        <section className={`${card} p-4`}>
          <h3 className="mb-1 text-sm font-semibold text-slate-500">Forecast — projected balance</h3>
          <p className="mb-3 text-[11px] text-slate-400">Recurring rules + your recent monthly average.</p>
          <div className="space-y-2">
            {fc.map((p) => (
              <div key={p.month} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-slate-400">{monthLabel(p.month)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className={p.balanceCents < 0 ? 'h-full bg-red-400' : 'h-full bg-blue-400'}
                    style={{ width: `${(Math.abs(p.balanceCents) / maxAbs) * 100}%` }}
                  />
                </div>
                <span className={`w-24 shrink-0 text-right text-sm tabular-nums ${p.balanceCents < 0 ? 'text-red-600' : ''}`}>
                  {money(p.balanceCents)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* suggestions */}
      {sug.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-500">Suggested rules</h3>
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
            {sug.map((s, i) => (
              <li key={i} className="flex items-center gap-3 p-3">
                <div className="flex-1">
                  <p className="truncate text-sm">{s.description || '—'}</p>
                  <p className="text-xs text-slate-400">seen {s.count}× · day {s.dayOfMonth}</p>
                </div>
                <span className={`shrink-0 text-sm tabular-nums ${s.amountCents < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(s.amountCents)}</span>
                <button className={btnGhost} onClick={() => onCreateFromSuggestion(s)}>Add rule</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* upcoming */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Upcoming (next 60 days)</h3>
        {up.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing scheduled.</p>
        ) : (
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
            {up.map((o, i) => (
              <li key={`${o.ruleId}-${o.date}-${i}`} className="flex items-center gap-3 p-3">
                <span className="w-12 shrink-0 text-xs text-slate-400">{dayLabel(o.date)}</span>
                <span className="flex-1 truncate text-sm">{o.description || '—'}</span>
                <span className={`shrink-0 font-medium tabular-nums ${o.amountCents < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(o.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* rules */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">Recurring rules</h3>
          <button className={btnPrimary} onClick={onAddRule}>Add</button>
        </div>
        {rec.length === 0 ? (
          <p className="text-sm text-slate-400">No rules yet.</p>
        ) : (
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
            {rec.map((r) => (
              <li key={r.id}>
                <button onClick={() => onEditRule(r)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <div className="flex-1">
                    <p className="truncate text-sm">
                      {r.description || '—'}
                      {r.archived ? ' (archived)' : ''}
                    </p>
                    <p className="text-xs text-slate-400">
                      {r.cadence === 'yearly' ? 'Yearly' : 'Monthly'} · day {r.dayOfMonth}
                      {r.autoPost ? ' · auto' : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 font-medium tabular-nums ${r.amountCents < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(r.amountCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

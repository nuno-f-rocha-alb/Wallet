import type { Account, Category, Transaction } from '@wallet/shared';
import { useCategories, useDashboard, useTransactions } from '../api';
import { dayLabel, money } from '../format';
import { card } from './ui';

const typeLabel: Record<Account['type'], string> = {
  bank: 'Bank',
  cash: 'Cash',
  credit_card: 'Credit card',
  loan: 'Loan',
};

export function Dashboard({ month, onEditTx }: { month: string; onEditTx: (tx: Transaction) => void }) {
  const dash = useDashboard(month);
  const cats = useCategories();
  const txs = useTransactions(month);

  if (dash.isLoading) return <p className="p-6 text-slate-400">Loading…</p>;
  if (dash.error) return <p className="p-6 text-red-600">{dash.error.message}</p>;
  const d = dash.data!;
  const colorOf = new Map((cats.data ?? []).map((c: Category) => [c.id, c.color]));
  const maxAbs = Math.max(1, ...d.byCategory.map((c) => Math.abs(c.totalCents)));
  const recent = (txs.data ?? []).slice(0, 8);

  return (
    <div className="space-y-5 p-4">
      {/* summary */}
      <div className={`${card} grid grid-cols-3 divide-x divide-slate-100 p-4 dark:divide-slate-700`}>
        <Stat label="Income" value={money(d.incomeCents)} tone="text-green-600" />
        <Stat label="Expenses" value={money(d.expenseCents)} tone="text-red-600" />
        <Stat label="Net" value={money(d.netCents)} tone={d.netCents >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      {/* accounts */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Accounts</h3>
        {d.accounts.length === 0 ? (
          <p className="text-sm text-slate-400">No accounts yet — add one in Manage.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {d.accounts.map((a) => (
              <div key={a.id} className={`${card} min-w-[9rem] shrink-0 p-3`}>
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="text-xs text-slate-400">{typeLabel[a.type]}</p>
                <p className={`mt-1 text-lg font-semibold ${(a.balanceCents ?? 0) < 0 ? 'text-red-600' : ''}`}>
                  {money(a.balanceCents ?? 0)}
                </p>
                {a.type === 'credit_card' && a.creditLimitCents ? (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${Math.min(100, (Math.abs(Math.min(0, a.balanceCents ?? 0)) / a.creditLimitCents) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">limit {money(a.creditLimitCents)}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* category breakdown */}
      {d.byCategory.length > 0 && (
        <section className={`${card} p-4`}>
          <h3 className="mb-3 text-sm font-semibold text-slate-500">By category</h3>
          <div className="space-y-2">
            {d.byCategory.map((c) => (
              <div key={c.categoryId ?? 'none'} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf.get(c.categoryId ?? -1) ?? '#94a3b8' }} />
                <span className="w-28 shrink-0 truncate text-sm">{c.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className={c.totalCents < 0 ? 'h-full bg-red-400' : 'h-full bg-green-400'}
                    style={{ width: `${(Math.abs(c.totalCents) / maxAbs) * 100}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-sm tabular-nums">{money(c.totalCents)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* recent */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Recent</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-400">No transactions this month.</p>
        ) : (
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
            {recent.map((t) => (
              <li key={t.id}>
                <button onClick={() => onEditTx(t)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <span className="w-12 shrink-0 text-xs text-slate-400">{dayLabel(t.date)}</span>
                  <span className="flex-1 truncate">{t.description || '—'}</span>
                  <span className={`shrink-0 font-medium tabular-nums ${t.amountCents < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {money(t.amountCents)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="px-2 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

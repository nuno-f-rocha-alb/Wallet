import type { Account, Category, Transaction } from '@wallet/shared';
import { useAccounts, useCategories, useTransactions } from '../api';
import { dayLabel, money } from '../format';
import { card } from './ui';

export function Transactions({ month, onEditTx }: { month: string; onEditTx: (tx: Transaction) => void }) {
  const txs = useTransactions(month);
  const accounts = useAccounts();
  const cats = useCategories();

  if (txs.isLoading) return <p className="p-6 text-slate-400">Loading…</p>;
  if (txs.error) return <p className="p-6 text-red-600">{txs.error.message}</p>;

  const acctName = new Map((accounts.data ?? []).map((a: Account) => [a.id, a.name]));
  const catName = new Map((cats.data ?? []).map((c: Category) => [c.id, c.name]));
  const list = txs.data ?? [];

  if (list.length === 0) return <p className="p-6 text-center text-slate-400">No transactions this month.</p>;

  return (
    <div className="p-4">
      <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
        {list.map((t) => (
          <li key={t.id}>
            <button onClick={() => onEditTx(t)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
              <span className="w-12 shrink-0 text-xs text-slate-400">{dayLabel(t.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{t.description || (t.transferId ? 'Transfer' : '—')}</span>
                <span className="block truncate text-xs text-slate-400">
                  {acctName.get(t.accountId) ?? '?'}
                  {t.categoryId ? ` · ${catName.get(t.categoryId)}` : ''}
                </span>
              </span>
              {t.hasReceipt && (
                <img
                  src={`/api/receipts/by-tx/${t.id}/image`}
                  alt="Receipt"
                  loading="lazy"
                  className="h-9 w-9 shrink-0 rounded border border-slate-200 object-cover dark:border-slate-700"
                />
              )}
              <span className={`shrink-0 font-medium tabular-nums ${t.amountCents < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {money(t.amountCents)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

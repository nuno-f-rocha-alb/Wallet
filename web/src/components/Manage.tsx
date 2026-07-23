import type { Account, Category } from '@wallet/shared';
import { useAccounts, useCategories } from '../api';
import { money } from '../format';
import { btnGhost, btnPrimary, card } from './ui';

export function Manage({
  onAddAccount,
  onEditAccount,
  onTransfer,
  onAddCategory,
  onEditCategory,
}: {
  onAddAccount: () => void;
  onEditAccount: (a: Account) => void;
  onTransfer: () => void;
  onAddCategory: () => void;
  onEditCategory: (c: Category) => void;
}) {
  const accounts = useAccounts();
  const cats = useCategories();
  const list = accounts.data ?? [];
  const catList = cats.data ?? [];

  return (
    <div className="space-y-6 p-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">Accounts</h3>
          <div className="flex gap-2">
            {list.length >= 2 && (
              <button className={btnGhost} onClick={onTransfer}>Transfer</button>
            )}
            <button className={btnPrimary} onClick={onAddAccount}>Add</button>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-slate-400">No accounts yet.</p>
        ) : (
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
            {list.map((a) => (
              <li key={a.id}>
                <button onClick={() => onEditAccount(a)} className="flex w-full items-center justify-between p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <span>{a.name}{a.archived ? ' (archived)' : ''}</span>
                  <span className={`font-medium tabular-nums ${(a.balanceCents ?? 0) < 0 ? 'text-red-600' : ''}`}>{money(a.balanceCents ?? 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">Categories</h3>
          <button className={btnPrimary} onClick={onAddCategory}>Add</button>
        </div>
        <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
          {catList.map((c) => (
            <li key={c.id}>
              <button onClick={() => onEditCategory(c)} className="flex w-full items-center gap-2 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color ?? '#94a3b8' }} />
                <span className={c.parentId ? 'pl-3 text-slate-500' : ''}>{c.parentId ? `— ${c.name}` : c.name}</span>
                <span className="ml-auto text-xs text-slate-400">{c.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

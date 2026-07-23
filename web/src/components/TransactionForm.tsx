import { useState } from 'react';
import type { Account, Category, Transaction } from '@wallet/shared';
import { useDeleteTransaction, useSaveTransaction } from '../api';
import { todayISO, toCents } from '../format';
import { btnDanger, btnGhost, btnPrimary, input, label } from './ui';

export function TransactionForm({
  tx,
  accounts,
  categories,
  onClose,
}: {
  tx?: Transaction;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
}) {
  const save = useSaveTransaction();
  const del = useDeleteTransaction();
  const editing = !!tx;

  const [kind, setKind] = useState<'expense' | 'income'>(tx && tx.amountCents > 0 ? 'income' : 'expense');
  const [amount, setAmount] = useState(tx ? (Math.abs(tx.amountCents) / 100).toString() : '');
  const [accountId, setAccountId] = useState(tx?.accountId ?? accounts[0]?.id ?? 0);
  const [categoryId, setCategoryId] = useState<number | ''>(tx?.categoryId ?? '');
  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [description, setDescription] = useState(tx?.description ?? '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = toCents(Number(amount)) * (kind === 'expense' ? -1 : 1);
    if (!cents || !accountId) return;
    save.mutate(
      { id: tx?.id, date, amountCents: cents, accountId, categoryId: categoryId === '' ? null : categoryId, description },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(['expense', 'income'] as const).map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-lg py-2 font-medium capitalize ${
              kind === k
                ? k === 'expense'
                  ? 'bg-red-600 text-white'
                  : 'bg-green-600 text-white'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div>
        <label className={label} htmlFor="amount">Amount (€)</label>
        <input
          id="amount"
          className={input}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
          required
        />
      </div>

      <div>
        <label className={label} htmlFor="account">Account</label>
        <select id="account" className={input} value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="category">Category</label>
        <select id="category" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => c.parentId === null)
            .flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)])
            .map((c) => (
              <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>
            ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="date">Date</label>
        <input id="date" className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>

      <div>
        <label className={label} htmlFor="desc">Description</label>
        <input id="desc" className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Groceries at Lidl" />
      </div>

      {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}

      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button type="button" className={btnDanger} onClick={() => del.mutate(tx.id, { onSuccess: onClose })}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={save.isPending}>
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </form>
  );
}

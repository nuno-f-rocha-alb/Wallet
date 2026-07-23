import { useState } from 'react';
import type { Account, AccountType } from '@wallet/shared';
import { useDeleteAccount, useSaveAccount } from '../api';
import { toCents } from '../format';
import { btnDanger, btnGhost, btnPrimary, input, label } from './ui';

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
];

export function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const save = useSaveAccount();
  const del = useDeleteAccount();
  const editing = !!account;

  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank');
  const [opening, setOpening] = useState(account ? (account.openingBalanceCents / 100).toString() : '');
  const [limit, setLimit] = useState(account?.creditLimitCents != null ? (account.creditLimitCents / 100).toString() : '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      {
        id: account?.id,
        name: name.trim(),
        type,
        openingBalanceCents: toCents(Number(opening) || 0),
        creditLimitCents: type === 'credit_card' && limit !== '' ? toCents(Number(limit)) : null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="name">Name</label>
        <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </div>
      <div>
        <label className={label} htmlFor="type">Type</label>
        <select id="type" className={input} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="opening">Opening balance (€)</label>
        <input id="opening" className={input} type="number" inputMode="decimal" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
      </div>
      {type === 'credit_card' && (
        <div>
          <label className={label} htmlFor="limit">Credit limit (€)</label>
          <input id="limit" className={input} type="number" inputMode="decimal" step="0.01" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
      )}

      {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button type="button" className={btnDanger} onClick={() => del.mutate(account.id, { onSuccess: onClose })}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={save.isPending}>{editing ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </form>
  );
}

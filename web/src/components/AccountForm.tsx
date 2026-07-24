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
  const [rate, setRate] = useState(account?.interestRateBps != null ? (account.interestRateBps / 100).toString() : '');
  const [payment, setPayment] = useState(account?.monthlyPaymentCents != null ? (account.monthlyPaymentCents / 100).toString() : '');
  const [varFrom, setVarFrom] = useState(account?.rateVariableFrom ?? '');
  const [varRate, setVarRate] = useState(account?.variableRateBps != null ? (account.variableRateBps / 100).toString() : '');
  const [termEnd, setTermEnd] = useState(account?.termEndMonth ?? '');

  const isDebt = type === 'loan' || type === 'credit_card';

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
        interestRateBps: isDebt && rate !== '' ? Math.round(Number(rate) * 100) : null,
        monthlyPaymentCents: isDebt && payment !== '' ? toCents(Number(payment)) : null,
        rateVariableFrom: isDebt && varFrom !== '' && varRate !== '' ? varFrom : null,
        variableRateBps: isDebt && varFrom !== '' && varRate !== '' ? Math.round(Number(varRate) * 100) : null,
        termEndMonth: isDebt && termEnd !== '' ? termEnd : null,
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
      {isDebt && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label} htmlFor="rate">Interest rate (% / yr)</label>
            <input id="rate" className={input} type="number" inputMode="decimal" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 3.5" />
          </div>
          <div>
            <label className={label} htmlFor="payment">Monthly payment (€)</label>
            <input id="payment" className={input} type="number" inputMode="decimal" step="0.01" min="0" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="e.g. 850" />
          </div>
        </div>
      )}
      {isDebt && (
        <details className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <summary className="cursor-pointer text-sm text-slate-500">Rate changes to variable later (optional)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="varFrom">Variable from (month)</label>
              <input id="varFrom" className={input} type="month" value={varFrom} onChange={(e) => setVarFrom(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="varRate">Variable rate (% / yr)</label>
              <input id="varRate" className={input} type="number" inputMode="decimal" step="0.01" min="0" value={varRate} onChange={(e) => setVarRate(e.target.value)} placeholder="Euribor + spread" />
            </div>
          </div>
          <div className="mt-2">
            <label className={label} htmlFor="termEnd">Loan ends (month) — optional</label>
            <input id="termEnd" className={input} type="month" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            The rate above applies until the variable month; from then the projection uses the variable rate — update it on each
            Euribor reset. Set the end month if your lender keeps the term and re-levels the payment at each reset (most PT
            mortgages); leave it blank to project a fixed payment with a drifting term.
          </p>
        </details>
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

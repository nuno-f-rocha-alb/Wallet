import { useState } from 'react';
import type { Account, Category, Cadence, RecurringRule, RuleSuggestion } from '@wallet/shared';
import { useDeleteRecurring, useSaveRecurring } from '../api';
import { todayISO, toCents } from '../format';
import { btnDanger, btnGhost, btnPrimary, input, label } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function RecurringForm({
  rule,
  suggestion,
  accounts,
  categories,
  onClose,
}: {
  rule?: RecurringRule;
  suggestion?: RuleSuggestion;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
}) {
  const save = useSaveRecurring();
  const del = useDeleteRecurring();
  const editing = !!rule;
  const seed = rule ?? suggestion; // prefill from an existing rule or a detected suggestion

  const [kind, setKind] = useState<'expense' | 'income'>((seed?.amountCents ?? -1) > 0 ? 'income' : 'expense');
  const [amount, setAmount] = useState(seed ? (Math.abs(seed.amountCents) / 100).toString() : '');
  const [accountId, setAccountId] = useState(seed?.accountId ?? accounts[0]?.id ?? 0);
  const [categoryId, setCategoryId] = useState<number | ''>(seed?.categoryId ?? '');
  const [description, setDescription] = useState(seed?.description ?? '');
  const [cadence, setCadence] = useState<Cadence>(rule?.cadence ?? 'monthly');
  const [dayOfMonth, setDayOfMonth] = useState(seed?.dayOfMonth ?? 1);
  const [month, setMonth] = useState(rule?.month ?? 1);
  const [startDate, setStartDate] = useState(rule?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(rule?.endDate ?? '');
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = toCents(Number(amount)) * (kind === 'expense' ? -1 : 1);
    if (!cents || !accountId) return;
    save.mutate(
      {
        id: rule?.id,
        cadence,
        dayOfMonth,
        month: cadence === 'yearly' ? month : null,
        amountCents: cents,
        accountId,
        categoryId: categoryId === '' ? null : categoryId,
        description,
        autoPost,
        startDate,
        endDate: endDate || null,
      },
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
        <label className={label} htmlFor="r-amount">Amount (€)</label>
        <input id="r-amount" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label} htmlFor="r-cadence">Repeats</label>
          <select id="r-cadence" className={input} value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="r-day">Day of month</label>
          <input id="r-day" className={input} type="number" inputMode="numeric" min="1" max="31" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} required />
        </div>
      </div>
      {cadence === 'yearly' && (
        <div>
          <label className={label} htmlFor="r-month">Month</label>
          <select id="r-month" className={input} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={label} htmlFor="r-account">Account</label>
        <select id="r-account" className={input} value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="r-category">Category</label>
        <select id="r-category" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}>
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
        <label className={label} htmlFor="r-desc">Description</label>
        <input id="r-desc" className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Rent" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label} htmlFor="r-start">Start</label>
          <input id="r-start" className={input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label className={label} htmlFor="r-end">End (optional)</label>
          <input id="r-end" className={input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} className="h-4 w-4" />
        Auto-post on the due date
      </label>

      {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
      {del.error && <p className="text-sm text-red-600">{del.error.message}</p>}

      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button type="button" className={btnDanger} onClick={() => del.mutate(rule.id, { onSuccess: onClose })}>
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

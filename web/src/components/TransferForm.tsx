import { useState } from 'react';
import type { Account } from '@wallet/shared';
import { useCreateTransfer } from '../api';
import { todayISO, toCents } from '../format';
import { btnGhost, btnPrimary, input, label } from './ui';

export function TransferForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const transfer = useCreateTransfer();
  const [fromId, setFromId] = useState(accounts[0]?.id ?? 0);
  const [toId, setToId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = toCents(Number(amount));
    if (cents <= 0 || fromId === toId) return;
    transfer.mutate(
      { date, fromAccountId: fromId, toAccountId: toId, amountCents: cents, note: note.trim() || null },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="from">From</label>
        <select id="from" className={input} value={fromId} onChange={(e) => setFromId(Number(e.target.value))}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="to">To</label>
        <select id="to" className={input} value={toId} onChange={(e) => setToId(Number(e.target.value))}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {fromId === toId && <p className="text-sm text-amber-600">Pick two different accounts.</p>}
      <div>
        <label className={label} htmlFor="tamount">Amount (€)</label>
        <input id="tamount" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
      </div>
      <div>
        <label className={label} htmlFor="tdate">Date</label>
        <input id="tdate" className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div>
        <label className={label} htmlFor="tnote">Note</label>
        <input id="tnote" className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
      </div>

      {transfer.error && <p className="text-sm text-red-600">{transfer.error.message}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="submit" className={btnPrimary} disabled={transfer.isPending || fromId === toId}>Transfer</button>
      </div>
    </form>
  );
}

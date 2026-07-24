import { useState } from 'react';
import type { Account, Category } from '@wallet/shared';
import { parseReceipt, type ReceiptParse } from '@wallet/shared/receipt';
import { fetchSuggestedCategory, useCreateReceipt } from '../api';
import { imageToText, dataUrlToBase64 } from '../lib/ocr';
import { todayISO, toCents } from '../format';
import { btnGhost, btnPrimary, input, label } from './ui';

type Step = 'pick' | 'reading' | 'confirm' | 'done';

export function ReceiptCapture({
  accounts,
  categories,
  onClose,
}: {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
}) {
  const create = useCreateReceipt();

  const [step, setStep] = useState<Step>('pick');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [image, setImage] = useState<{ dataUrl: string; mime: string; ocrText: string } | null>(null);
  const [parsed, setParsed] = useState<ReceiptParse | null>(null);

  // draft fields (prefilled from OCR, user confirms)
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const catOptions = categories
    .filter((c) => c.parentId === null)
    .flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setStep('reading');
    setProgress(0);
    try {
      const { text, dataUrl, mime } = await imageToText(file, setProgress);
      const p = parseReceipt(text);
      setImage({ dataUrl, mime, ocrText: text });
      setParsed(p);
      if (p.totalCents !== null) setAmount((p.totalCents / 100).toFixed(2));
      if (p.date) setDate(p.date);
      if (p.merchant) {
        setDescription(p.merchant);
        // Best-effort: suggest a category from the merchant without blocking the draft. A failure
        // must not fail the scan, and it only fills a still-blank category.
        void fetchSuggestedCategory(p.merchant)
          .then((cat) => {
            if (cat !== null) setCategoryId((cur) => (cur === '' ? cat : cur));
          })
          .catch(() => {});
      }
      setStep('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the image.');
      setStep('pick');
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = -Math.abs(toCents(Number(amount))); // receipts are expenses
    if (!cents || !accountId || !image) return;
    create.mutate(
      {
        date,
        amountCents: cents,
        accountId,
        categoryId: categoryId === '' ? null : categoryId,
        description,
        imageBase64: dataUrlToBase64(image.dataUrl),
        mime: image.mime,
        ocrText: image.ocrText,
        parsedJson: parsed ? JSON.stringify(parsed) : null,
      },
      { onSuccess: () => setStep('done') },
    );
  }

  if (step === 'done') {
    return (
      <div className="space-y-4">
        <p className="text-sm">Saved the transaction with its receipt attached.</p>
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  if (step === 'reading') {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-sm text-slate-500">Reading receipt on your device…</p>
        <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    );
  }

  if (step === 'confirm' && image) {
    const missing = [
      parsed?.totalCents === null ? 'total' : null,
      !parsed?.date ? 'date' : null,
      !parsed?.merchant ? 'merchant' : null,
    ].filter(Boolean);
    return (
      <form onSubmit={submit} className="space-y-4">
        <img src={image.dataUrl} alt="Receipt" className="mx-auto max-h-40 rounded-lg border border-slate-200 dark:border-slate-700" />
        {missing.length > 0 && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            Couldn’t read the {missing.join(', ')} — enter {missing.length > 1 ? 'them' : 'it'} manually.
          </p>
        )}
        <div>
          <label className={label} htmlFor="r-amount">Amount (€)</label>
          <input id="r-amount" className={input} type="number" inputMode="decimal" step="0.01" min="0.01"
            value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
        </div>
        <div>
          <label className={label} htmlFor="r-account">Account</label>
          <select id="r-account" className={input} value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="r-category">Category</label>
          <select id="r-category" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Uncategorized</option>
            {catOptions.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="r-date">Date</label>
          <input id="r-date" className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className={label} htmlFor="r-desc">Description</label>
          <input id="r-desc" className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Merchant" />
        </div>
        {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={create.isPending}>Save</button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={label} htmlFor="r-file">Receipt photo</label>
        <input id="r-file" className={input} type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
        <p className="mt-1 text-xs text-slate-400">Read on your device — nothing is uploaded until you confirm.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

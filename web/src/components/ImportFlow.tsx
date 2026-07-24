import { useMemo, useState } from 'react';
import type { Account, Category, ImportPreview } from '@wallet/shared';
import { parseStatement, type ParsedStatement } from '@wallet/shared/parsers';
import { guessMapping, parseCsv, rowsFromCsv, type CsvMapping } from '@wallet/shared/csv';
import { useCommitImport, usePreviewImport } from '../api';
import { extractPdfText } from '../lib/extractPdf';
import { money } from '../format';
import { btnGhost, btnPrimary, input, label } from './ui';

type Step = 'pick' | 'map' | 'review' | 'done';

export function ImportFlow({
  accounts,
  categories,
  onClose,
}: {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
}) {
  const preview = usePreviewImport();
  const commit = useCommitImport();

  const [step, setStep] = useState<Step>('pick');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [source, setSource] = useState<'pdf' | 'csv'>('pdf');
  const [csvTable, setCsvTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({ date: -1, amount: -1, description: -1 });
  const [staged, setStaged] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cats, setCats] = useState<Record<number, number | ''>>({});
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const catOptions = useMemo(
    () =>
      categories
        .filter((c) => c.parentId === null)
        .flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)]),
    [categories],
  );

  async function stage(rows: { date: string; amountCents: number; description: string; externalRef?: string | null }[]) {
    const p = await preview.mutateAsync({ accountId, rows });
    setStaged(p);
    setSelected(new Set(p.rows.map((_, i) => i).filter((i) => p.rows[i].status === 'new')));
    setCats(Object.fromEntries(p.rows.map((r, i) => [i, r.suggestedCategoryId ?? ''])));
    setStep('review');
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    try {
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
      setSource(isCsv ? 'csv' : 'pdf'); // drives the "Reading …" label below
      if (isCsv) {
        // Any bank: parse, guess the columns, let the user confirm before staging.
        const table = parseCsv(await file.text());
        if (table.length < 2) {
          setError('That CSV has no data rows.');
          return;
        }
        setCsvTable(table);
        setMapping(guessMapping(table[0]));
        setStep('map');
        return;
      }
      const text = await extractPdfText(file);
      const st = parseStatement(text);
      if (!st || st.rows.length === 0) {
        setError('Could not detect a supported bank in this PDF. (Only Caixa Geral de Depósitos is supported so far.) You can export a CSV from your bank and import that instead.');
        return;
      }
      setParsed(st);
      await stage(st.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read the file.');
    } finally {
      setBusy(false);
    }
  }

  async function onMappingConfirmed() {
    if (!csvTable) return;
    setError(undefined);
    setBusy(true);
    try {
      const rows = rowsFromCsv(csvTable, mapping);
      if (rows.length === 0) {
        setError('No rows could be read with those columns — check the date and amount selections.');
        return;
      }
      await stage(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read the CSV.');
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    if (!staged) return; // `parsed` is only set on the PDF path — CSV imports have none
    const rows = [...selected].map((i) => ({ ...staged.rows[i], categoryId: cats[i] === '' ? null : (cats[i] as number) }));
    if (rows.length === 0) return;
    const res = await commit.mutateAsync({ accountId, source, description: parsed?.bankName ?? 'CSV import', rows });
    setResult(res);
    setStep('done');
  }

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  if (step === 'done') {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Imported <b>{result?.inserted ?? 0}</b> transaction(s)
          {result && result.skipped > 0 ? `, skipped ${result.skipped} duplicate(s)` : ''}.
        </p>
        <p className="text-xs text-slate-400">Undo removes this whole batch. You can also edit rows in Transactions.</p>
        <div className="flex justify-end">
          <button className={btnPrimary} onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  if (step === 'map' && csvTable) {
    const header = csvTable[0];
    // Same column for both would parse every row as unreadable — catch it before staging.
    const distinct = mapping.date !== mapping.amount;
    const ready = mapping.date >= 0 && mapping.amount >= 0 && distinct;
    const colSelect = (key: 'date' | 'amount' | 'description', text: string) => (
      <div>
        <label className={label} htmlFor={`map-${key}`}>{text}</label>
        <select
          id={`map-${key}`}
          className={input}
          value={mapping[key]}
          onChange={(e) => setMapping((m) => ({ ...m, [key]: Number(e.target.value) }))}
        >
          <option value={-1}>— none —</option>
          {header.map((h, i) => (
            <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
          ))}
        </select>
      </div>
    );
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          {csvTable.length - 1} data row(s). Confirm which columns to use — we guessed from the header.
        </p>
        {colSelect('date', 'Date column')}
        {colSelect('amount', 'Amount column')}
        {colSelect('description', 'Description column')}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={!!mapping.invertSign} onChange={(e) => setMapping((m) => ({ ...m, invertSign: e.target.checked }))} />
          Expenses are listed as positive (flip signs)
        </label>

        <div className="max-h-40 overflow-auto rounded-lg border border-slate-200 text-xs dark:border-slate-700">
          <table className="w-full">
            <tbody>
              {csvTable.slice(0, 4).map((r, i) => (
                <tr key={i} className={i === 0 ? 'text-slate-400' : ''}>
                  {r.map((c, j) => (
                    <td key={j} className="max-w-[8rem] truncate border-b border-slate-100 p-1 dark:border-slate-800">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!distinct && mapping.date >= 0 && <p className="text-sm text-amber-600">Date and amount must be different columns.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={!ready || busy} onClick={onMappingConfirmed}>Continue</button>
        </div>
      </div>
    );
  }

  if (step === 'review' && staged) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">
          <p><b>{parsed?.bankName ?? 'CSV import'}</b>{parsed?.accountRef ? ` · account …${parsed.accountRef.slice(-4)}` : ''}</p>
          <p className="mt-1 text-slate-500">
            {staged.newCount} new · {staged.duplicateCount} duplicate (already recorded). Confirm the account is correct.
          </p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <tbody>
              {staged.rows.map((r, i) => (
                <tr key={i} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${r.status === 'duplicate' ? 'opacity-50' : ''}`}>
                  <td className="p-2 align-top">
                    <input type="checkbox" className="h-4 w-4" checked={selected.has(i)} onChange={() => toggle(i)} />
                  </td>
                  <td className="p-2 align-top text-xs text-slate-400">{r.date.slice(5)}</td>
                  <td className="p-2 align-top">
                    <p className="truncate">{r.description || '—'}</p>
                    {selected.has(i) && (
                      <select
                        className="mt-1 w-full rounded border border-slate-300 bg-transparent px-1 py-0.5 text-xs dark:border-slate-600"
                        value={cats[i]}
                        onChange={(e) => setCats((c) => ({ ...c, [i]: e.target.value === '' ? '' : Number(e.target.value) }))}
                      >
                        <option value="">Uncategorized</option>
                        {catOptions.map((c) => (
                          <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className={`p-2 text-right align-top tabular-nums ${r.amountCents < 0 ? 'text-red-600' : 'text-green-600'}`}>{money(r.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {commit.error && <p className="text-sm text-red-600">{commit.error.message}</p>}
        <div className="flex items-center justify-between">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={selected.size === 0 || commit.isPending} onClick={doCommit}>
            Import {selected.size}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={label} htmlFor="imp-account">Import into account</label>
        <select id="imp-account" className={input} value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="imp-file">Statement (PDF or CSV)</label>
        <input id="imp-file" className={input} type="file" accept="application/pdf,text/csv,.csv" disabled={!accountId || busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
        <p className="mt-1 text-xs text-slate-400">
          Read on your device — nothing is uploaded until you confirm. PDF works for supported banks (CGD); CSV works for any
          bank — you pick which columns are the date, amount and description.
        </p>
      </div>
      {busy && <p className="text-sm text-slate-400">{source === 'csv' ? 'Reading CSV…' : 'Reading PDF…'}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

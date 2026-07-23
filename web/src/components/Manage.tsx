import { useState } from 'react';
import type { Account, BackupData, Category } from '@wallet/shared';
import { downloadExport, useAccounts, useCategories, useImportBackup, useImports, useRevertImport } from '../api';
import { money } from '../format';
import { btnDanger, btnGhost, btnPrimary, card } from './ui';

export function Manage({
  onAddAccount,
  onEditAccount,
  onTransfer,
  onAddCategory,
  onEditCategory,
  onImport,
}: {
  onAddAccount: () => void;
  onEditAccount: (a: Account) => void;
  onTransfer: () => void;
  onAddCategory: () => void;
  onEditCategory: (c: Category) => void;
  onImport: () => void;
}) {
  const accounts = useAccounts();
  const cats = useCategories();
  const imports = useImports();
  const revert = useRevertImport();
  const restore = useImportBackup();
  const [dataMsg, setDataMsg] = useState<string>();
  const list = accounts.data ?? [];
  const catList = cats.data ?? [];
  const importList = imports.data ?? [];

  async function onRestoreFile(file: File | undefined) {
    if (!file) return;
    setDataMsg(undefined);
    if (!confirm('Restore this backup? It REPLACES all your current data with the file contents.')) return;
    try {
      const data = JSON.parse(await file.text()) as BackupData;
      const res = await restore.mutateAsync(data);
      const n = Object.values(res.restored).reduce((a, b) => a + b, 0);
      setDataMsg(`Restored ${n} rows.`);
    } catch (e) {
      setDataMsg(e instanceof Error ? e.message : 'Import failed.');
    }
  }

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
          <h3 className="text-sm font-semibold text-slate-500">Bank import</h3>
          <button className={btnPrimary} onClick={onImport} disabled={list.length === 0}>Import PDF</button>
        </div>
        {importList.length === 0 ? (
          <p className="text-sm text-slate-400">No imports yet. Import a statement PDF to bring in transactions.</p>
        ) : (
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
            {importList.map((b) => (
              <li key={b.id} className="flex items-center gap-3 p-3">
                <div className="flex-1">
                  <p className="truncate text-sm">{b.description || 'Import'}</p>
                  <p className="text-xs text-slate-400">{b.rowCount} rows · {b.createdAt.slice(0, 10)}</p>
                </div>
                <button className={btnDanger} disabled={revert.isPending} onClick={() => revert.mutate(b.id)}>Undo</button>
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

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Data</h3>
        <div className={`${card} space-y-3 p-3`}>
          <div className="flex flex-wrap gap-2">
            <button className={btnGhost} onClick={() => downloadExport('json')}>Export backup (JSON)</button>
            <button className={btnGhost} onClick={() => downloadExport('csv')}>Export transactions (CSV)</button>
            <label className={`${btnPrimary} cursor-pointer`}>
              Restore backup
              <input type="file" accept="application/json" className="hidden" disabled={restore.isPending} onChange={(e) => onRestoreFile(e.target.files?.[0])} />
            </label>
          </div>
          <p className="text-xs text-slate-400">Restore replaces all your data with the backup file. Export first if unsure.</p>
          {dataMsg && <p className="text-xs text-slate-500">{dataMsg}</p>}
        </div>
      </section>
    </div>
  );
}

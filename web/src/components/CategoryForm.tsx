import { useState } from 'react';
import type { Category, CategoryKind } from '@wallet/shared';
import { useDeleteCategory, useSaveCategory } from '../api';
import { btnDanger, btnGhost, btnPrimary, input, label } from './ui';

export function CategoryForm({
  category,
  categories,
  onClose,
}: {
  category?: Category;
  categories: Category[];
  onClose: () => void;
}) {
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const editing = !!category;

  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? '#3b82f6');
  const [parentId, setParentId] = useState<number | ''>(category?.parentId ?? '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { id: category?.id, name: name.trim(), kind, color, parentId: parentId === '' ? null : parentId },
      { onSuccess: onClose },
    );
  };

  const parents = categories.filter((c) => c.parentId === null && c.id !== category?.id);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="cname">Name</label>
        <input id="cname" className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </div>
      <div>
        <label className={label} htmlFor="ckind">Kind</label>
        <select id="ckind" className={input} value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="cparent">Parent</label>
        <select id="cparent" className={input} value={parentId} onChange={(e) => setParentId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">None (top-level)</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <label className={label} htmlFor="ccolor">Color</label>
        <input id="ccolor" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-14 rounded" />
      </div>

      {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}

      <div className="flex items-center justify-between pt-2">
        {editing ? (
          <button type="button" className={btnDanger} onClick={() => del.mutate(category.id, { onSuccess: onClose })}>
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

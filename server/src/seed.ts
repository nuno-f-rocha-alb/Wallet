import type { DatabaseSync } from 'node:sqlite';

// Default category taxonomy per new user (from the friend's xlsx). Parents first,
// then children referencing them.
const TAXONOMY: { name: string; kind: 'expense' | 'income'; color: string; children?: { name: string; kind?: 'expense' | 'income' }[] }[] = [
  { name: 'Housing', kind: 'expense', color: '#f59e0b' },
  {
    name: 'Food & Drinks',
    kind: 'expense',
    color: '#ef4444',
    children: [{ name: 'Groceries' }, { name: 'Eating out' }],
  },
  {
    name: 'Car',
    kind: 'expense',
    color: '#3b82f6',
    children: [
      { name: 'Fuel' },
      { name: 'Road tax' },
      { name: 'Insurance' },
      { name: 'Repairs' },
      { name: 'Reimbursement', kind: 'income' },
      { name: 'Other' },
    ],
  },
  { name: 'Subscriptions', kind: 'expense', color: '#8b5cf6' },
  { name: 'Flights', kind: 'expense', color: '#06b6d4' },
  { name: 'Other', kind: 'expense', color: '#94a3b8' },
  { name: 'Salary', kind: 'income', color: '#22c55e' },
  { name: 'Business', kind: 'income', color: '#10b981' },
  { name: 'Investments', kind: 'income', color: '#84cc16' },
  { name: 'Other income', kind: 'income', color: '#a3e635' },
];

export function seedDefaults(db: DatabaseSync, userId: number): void {
  const insert = db.prepare(
    'INSERT INTO categories(user_id, name, parent_id, kind, color, sort) VALUES(?,?,?,?,?,?)',
  );
  let sort = 0;
  for (const cat of TAXONOMY) {
    const info = insert.run(userId, cat.name, null, cat.kind, cat.color, sort++);
    const parentId = Number(info.lastInsertRowid);
    for (const child of cat.children ?? []) {
      insert.run(userId, child.name, parentId, child.kind ?? cat.kind, cat.color, sort++);
    }
  }
}

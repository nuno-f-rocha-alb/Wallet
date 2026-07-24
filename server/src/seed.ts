import type { DatabaseSync } from 'node:sqlite';
import { normalizeDesc } from './bank.js';

// Default category taxonomy per new user (from the friend's xlsx). Parents first,
// then children referencing them.
const TAXONOMY: { name: string; kind: 'expense' | 'income'; color: string; key?: string; children?: { name: string; kind?: 'expense' | 'income' }[] }[] = [
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
    key: 'car',
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
    'INSERT INTO categories(user_id, name, parent_id, kind, color, sort, system_key) VALUES(?,?,?,?,?,?,?)',
  );
  let sort = 0;
  for (const cat of TAXONOMY) {
    const info = insert.run(userId, cat.name, null, cat.kind, cat.color, sort++, cat.key ?? null);
    const parentId = Number(info.lastInsertRowid);
    for (const child of cat.children ?? []) {
      insert.run(userId, child.name, parentId, child.kind ?? cat.kind, cat.color, sort++, null);
    }
  }
  seedCommonRules(db, userId); // give new users a head start on import auto-categorization
}

// Starter merchant→category rules so a first import isn't all "Uncategorized". Patterns are
// substring-matched (case/space-insensitive), so "KFC" catches "KFC COIMBRA". Kept conservative
// — distinctive brand names only, no short/ambiguous tokens that could mis-tag.
const COMMON_RULES: { category: string; patterns: string[] }[] = [
  { category: 'Groceries', patterns: ['CONTINENTE', 'PINGO DOCE', 'LIDL', 'ALDI', 'AUCHAN', 'MINIPRECO', 'INTERMARCHE', 'MERCADONA', 'JUMBO', 'MEU SUPER'] },
  { category: 'Eating out', patterns: ['KFC', 'MCDONALD', 'BURGER KING', 'TELEPIZZA', 'DOMINOS', 'STARBUCKS', 'UBER EATS', 'GLOVO', 'BOLT FOOD'] },
  { category: 'Fuel', patterns: ['GALP', 'REPSOL', 'CEPSA', 'PRIO'] },
  { category: 'Subscriptions', patterns: ['NETFLIX', 'SPOTIFY', 'YOUTUBE', 'DISNEY', 'PATREON', 'OPENAI', 'ANTHROPIC', 'MICROSOFT'] },
  { category: 'Flights', patterns: ['RYANAIR', 'EASYJET', 'VUELING', 'WIZZ', 'TAP AIR'] },
];

/**
 * Add the common merchant rules. Idempotent: skips patterns the user already has and categories
 * they don't (renamed/deleted), so it's safe to call again from the "Add common rules" button.
 * Returns how many rules were inserted.
 */
export function seedCommonRules(db: DatabaseSync, userId: number): number {
  // node:sqlite is synchronous, so this whole function runs to completion before any other
  // request's DB work — there is no read-then-insert interleaving to guard against. Dedup uses
  // the SAME normalization the matcher does, so a case/spacing variant of an existing rule
  // (e.g. "galp" vs "GALP") is treated as already present, and so are repeats within this batch.
  const seen = new Set(
    (db.prepare('SELECT pattern FROM category_rules WHERE user_id=?').all(userId) as { pattern: string }[]).map((r) => normalizeDesc(r.pattern)),
  );
  const insert = db.prepare('INSERT INTO category_rules(user_id,pattern,category_id,sort) VALUES(?,?,?,?)');
  let added = 0;
  let sort = 1000; // after any user-made rules
  for (const group of COMMON_RULES) {
    const cat = db.prepare('SELECT id FROM categories WHERE user_id=? AND name=? LIMIT 1').get(userId, group.category) as { id: number } | undefined;
    if (!cat) continue;
    for (const pattern of group.patterns) {
      const key = normalizeDesc(pattern);
      if (!key || seen.has(key)) continue;
      insert.run(userId, pattern, cat.id, sort++);
      seen.add(key);
      added++;
    }
  }
  return added;
}

// Shared DTOs between server and web. Type-only for now (no runtime code),
// so both sides consume it without a build step.

export interface User {
  id: number;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  fyStartMonth: number; // 1-12, fiscal-year start month
  baseCurrency: string; // ISO 4217, e.g. "EUR"
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

// --- Phase 1: ledger ---

export type AccountType = 'cash' | 'bank' | 'credit_card' | 'loan';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceCents: number;
  creditLimitCents: number | null;
  archived: boolean;
  sort: number;
  /** Computed (opening + Σ transactions); present in list/dashboard responses. */
  balanceCents?: number;
}

export type CategoryKind = 'expense' | 'income';

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  kind: CategoryKind;
  color: string | null;
  icon: string | null;
  archived: boolean;
  sort: number;
}

export type TxSource = 'manual' | 'receipt' | 'bank' | 'recurring';

export interface Transaction {
  id: number;
  date: string; // YYYY-MM-DD
  amountCents: number; // signed: - expense, + income
  accountId: number;
  categoryId: number | null;
  description: string;
  note: string | null;
  source: TxSource;
  /** Non-null when this row is one leg of a transfer (excluded from income/expense). */
  transferId: number | null;
}

export interface Transfer {
  id: number;
  date: string;
  fromAccountId: number;
  toAccountId: number;
  amountCents: number; // positive
  note: string | null;
}

export interface CategoryTotal {
  categoryId: number | null;
  name: string;
  kind: CategoryKind;
  totalCents: number; // signed sum
}

export interface DashboardResponse {
  month: string; // YYYY-MM
  incomeCents: number;
  expenseCents: number; // negative
  netCents: number;
  byCategory: CategoryTotal[];
  accounts: Account[]; // each with balanceCents
}

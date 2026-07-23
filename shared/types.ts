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

// --- Phase 2: car module ---

export interface Vehicle {
  id: number;
  name: string;
  make: string | null;
  plate: string | null;
  archived: boolean;
  sort: number;
}

export interface FuelEntry {
  id: number;
  vehicleId: number;
  date: string; // YYYY-MM-DD
  odometerKm: number; // integer km
  litersMl: number; // integer millilitres
  totalPriceCents: number;
  isFull: boolean; // full tank (used for L/100km intervals)
  note: string | null;
}

/** One trend point per fuel entry. l100km is null unless this is a full fill closing an interval. */
export interface FuelPoint {
  date: string;
  odometerKm: number;
  eurPerL: number; // this fill's price / litres
  l100km: number | null; // consumption over the interval since the previous full fill
}

export interface FuelSummary {
  avgL100km: number | null;
  eurPerL: number | null; // overall consumed cost / consumed litres
  eurPerKm: number | null;
  totalDistanceKm: number; // distance covered by full-fill intervals
  totalLiters: number; // litres consumed over those intervals
  totalCostCents: number; // cost of that fuel
}

/** Car spend for one month = fuel log + non-reimbursed Car-category costs − reimbursements. */
export interface MonthlyCarCost {
  month: string; // YYYY-MM
  fuelCents: number; // from the fuel log (this vehicle)
  otherCents: number; // Car-category expense transactions (all vehicles share the category)
  reimbursedCents: number; // Car-category income (reimbursements)
  totalCents: number; // fuel + other − reimbursed
}

export interface CarStatsResponse {
  vehicleId: number;
  entries: FuelEntry[]; // newest first
  points: FuelPoint[]; // oldest first (by odometer)
  summary: FuelSummary;
  monthlyCosts: MonthlyCarCost[]; // newest first
}

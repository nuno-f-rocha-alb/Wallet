import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  Account,
  BackupData,
  CarStatsResponse,
  Category,
  CommitResult,
  DashboardResponse,
  ForecastPoint,
  FuelEntry,
  ImportBatch,
  ImportPreview,
  Occurrence,
  ParsedRow,
  RecurringRule,
  RuleSuggestion,
  StatsResponse,
  Transaction,
  Transfer,
  User,
  Vehicle,
} from '@wallet/shared';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error((msg as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const jsonBody = (data: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(data) });
const patchBody = (data: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(data) });

// ---- queries ----

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me'), retry: false });

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });

export const useDashboard = (month: string) =>
  useQuery({ queryKey: ['dashboard', month], queryFn: () => api<DashboardResponse>(`/dashboard?month=${month}`) });

export const useTransactions = (month: string) =>
  useQuery({
    queryKey: ['transactions', month],
    queryFn: () => api<Transaction[]>(`/transactions?month=${month}`),
  });

// ---- mutations ----

function invalidateLedger(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['accounts'] });
  qc.invalidateQueries({ queryKey: ['transactions'] });
}

export function useSaveTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: Partial<Transaction> & { id?: number }) =>
      t.id ? api<Transaction>(`/transactions/${t.id}`, patchBody(t)) : api<Transaction>('/transactions', jsonBody(t)),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useSaveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Partial<Account> & { id?: number }) =>
      a.id ? api<Account>(`/accounts/${a.id}`, patchBody(a)) : api<Account>('/accounts', jsonBody(a)),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: { date: string; fromAccountId: number; toAccountId: number; amountCents: number; note: string | null }) =>
      api<Transfer>('/transfers', jsonBody(t)),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Partial<Category> & { id?: number }) =>
      c.id ? api<Category>(`/categories/${c.id}`, patchBody(c)) : api<Category>('/categories', jsonBody(c)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ---- car ----

export const useVehicles = () =>
  useQuery({ queryKey: ['vehicles'], queryFn: () => api<Vehicle[]>('/vehicles') });

export const useCarStats = (vehicleId: number | undefined) =>
  useQuery({
    queryKey: ['carStats', vehicleId],
    queryFn: () => api<CarStatsResponse>(`/vehicles/${vehicleId}/stats`),
    enabled: !!vehicleId,
  });

function invalidateCar(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['vehicles'] });
  qc.invalidateQueries({ queryKey: ['carStats'] });
}

export function useSaveVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<Vehicle> & { id?: number }) =>
      v.id ? api<Vehicle>(`/vehicles/${v.id}`, patchBody(v)) : api<Vehicle>('/vehicles', jsonBody(v)),
    onSuccess: () => invalidateCar(qc),
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateCar(qc),
  });
}

export function useSaveFuel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: Partial<FuelEntry> & { id?: number }) =>
      f.id ? api<FuelEntry>(`/fuel/${f.id}`, patchBody(f)) : api<FuelEntry>('/fuel', jsonBody(f)),
    onSuccess: () => invalidateCar(qc),
  });
}

export function useDeleteFuel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/fuel/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateCar(qc),
  });
}

// ---- recurring & predictions ----

export const useRecurring = () =>
  useQuery({ queryKey: ['recurring'], queryFn: () => api<RecurringRule[]>('/recurring') });

export const useUpcoming = (days = 60) =>
  useQuery({ queryKey: ['upcoming', days], queryFn: () => api<Occurrence[]>(`/recurring/upcoming?days=${days}`) });

export const useForecast = (months = 6) =>
  useQuery({ queryKey: ['forecast', months], queryFn: () => api<ForecastPoint[]>(`/forecast?months=${months}`) });

export const useSuggestions = () =>
  useQuery({ queryKey: ['suggestions'], queryFn: () => api<RuleSuggestion[]>('/recurring/suggestions') });

function invalidatePlan(qc: QueryClient) {
  for (const k of ['recurring', 'upcoming', 'forecast', 'suggestions']) qc.invalidateQueries({ queryKey: [k] });
}

export function useSaveRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: Partial<RecurringRule> & { id?: number }) =>
      r.id ? api<RecurringRule>(`/recurring/${r.id}`, patchBody(r)) : api<RecurringRule>('/recurring', jsonBody(r)),
    onSuccess: () => invalidatePlan(qc),
  });
}

export function useDeleteRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/recurring/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePlan(qc),
  });
}

export function useRunAutoPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ posted: number }>('/recurring/run', { method: 'POST' }),
    onSuccess: (res) => {
      invalidatePlan(qc);
      if (res.posted > 0) invalidateLedger(qc); // posted transactions changed balances
    },
  });
}

// ---- bank import ----

export const useImports = () =>
  useQuery({ queryKey: ['imports'], queryFn: () => api<ImportBatch[]>('/import') });

export function usePreviewImport() {
  return useMutation({
    mutationFn: (body: { accountId: number; rows: ParsedRow[] }) => api<ImportPreview>('/import/preview', jsonBody(body)),
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: number; source: 'pdf' | 'csv'; description: string; rows: (ParsedRow & { categoryId: number | null })[] }) =>
      api<CommitResult>('/import/commit', jsonBody(body)),
    onSuccess: () => {
      invalidateLedger(qc);
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}

export function useRevertImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/import/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateLedger(qc);
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}

// ---- receipts ----

export interface ReceiptBody {
  date: string;
  amountCents: number;
  accountId: number;
  categoryId: number | null;
  description: string;
  imageBase64: string;
  mime: string;
  ocrText: string | null;
  parsedJson: string | null;
}

export function useCreateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReceiptBody) => api<Transaction>('/receipts', jsonBody(body)),
    onSuccess: () => invalidateLedger(qc),
  });
}

// ---- stats & portability ----

export const useStats = (months = 12) =>
  useQuery({ queryKey: ['stats', months], queryFn: () => api<StatsResponse>(`/stats?months=${months}`) });

/** Fetch an export and trigger a browser download (blob, not JSON-parsed). */
export async function downloadExport(kind: 'json' | 'csv'): Promise<void> {
  const path = kind === 'csv' ? '/api/export.csv' : '/api/export';
  const res = await fetch(path);
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = kind === 'csv' ? 'wallet-transactions.csv' : 'wallet-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function useImportBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BackupData) => api<{ restored: Record<string, number> }>('/import/backup', jsonBody(data)),
    onSuccess: () => qc.invalidateQueries(), // a full restore changes everything
  });
}

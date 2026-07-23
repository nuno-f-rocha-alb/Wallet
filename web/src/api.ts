import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  Account,
  CarStatsResponse,
  Category,
  DashboardResponse,
  FuelEntry,
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

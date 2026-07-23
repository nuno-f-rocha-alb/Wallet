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

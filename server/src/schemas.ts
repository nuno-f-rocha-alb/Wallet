import { z } from 'zod';

const cents = z.number().int();
// Format + calendar validity, so 2026-02-31 (regex-valid but impossible) is rejected.
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, 'invalid calendar date');

export const accountCreate = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['cash', 'bank', 'credit_card', 'loan']),
  currency: z.string().trim().length(3).toUpperCase().default('EUR'),
  openingBalanceCents: cents.default(0),
  creditLimitCents: cents.nonnegative().nullable().default(null),
  sort: z.number().int().default(0),
});
export const accountUpdate = accountCreate.partial();

export const categoryCreate = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['expense', 'income']),
  parentId: z.number().int().nullable().default(null),
  color: z.string().trim().max(20).nullable().default(null),
  icon: z.string().trim().max(40).nullable().default(null),
  sort: z.number().int().default(0),
});
export const categoryUpdate = categoryCreate.partial();

export const transactionCreate = z.object({
  date,
  amountCents: cents.refine((v) => v !== 0, 'amount cannot be zero'),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().default(null),
  description: z.string().trim().max(200).default(''),
  note: z.string().trim().max(500).nullable().default(null),
  source: z.enum(['manual', 'receipt', 'bank', 'recurring']).default('manual'),
});
export const transactionUpdate = transactionCreate.partial();

export const transferCreate = z
  .object({
    date,
    fromAccountId: z.number().int().positive(),
    toAccountId: z.number().int().positive(),
    amountCents: cents.positive(),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'from and to accounts must differ',
    path: ['toAccountId'],
  });

export const dashboardQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM')
    .default(() => new Date().toISOString().slice(0, 7)),
});

// --- Phase 2: car ---

export const vehicleCreate = z.object({
  name: z.string().trim().min(1).max(100),
  make: z.string().trim().max(100).nullable().default(null),
  plate: z.string().trim().max(20).nullable().default(null),
  sort: z.number().int().default(0),
});
export const vehicleUpdate = vehicleCreate.partial().extend({ archived: z.boolean().optional() });

export const fuelCreate = z.object({
  vehicleId: z.number().int().positive(),
  date,
  odometerKm: z.number().int().positive(),
  litersMl: z.number().int().positive(),
  totalPriceCents: cents.nonnegative(),
  isFull: z.boolean().default(true),
  note: z.string().trim().max(500).nullable().default(null),
});
export const fuelUpdate = fuelCreate.partial().omit({ vehicleId: true });

export const fuelListQuery = z.object({ vehicleId: z.coerce.number().int().positive() });

export const txListQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

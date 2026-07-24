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

const accountBase = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['cash', 'bank', 'credit_card', 'loan']),
  currency: z.string().trim().length(3).toUpperCase().default('EUR'),
  openingBalanceCents: cents.default(0),
  creditLimitCents: cents.nonnegative().nullable().default(null),
  sort: z.number().int().default(0),
  interestRateBps: cents.nonnegative().max(1_000_000).nullable().default(null), // basis points
  monthlyPaymentCents: cents.nonnegative().nullable().default(null),
  rateVariableFrom: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
    .nullable()
    .default(null),
  variableRateBps: cents.nonnegative().max(1_000_000).nullable().default(null),
  termEndMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
    .nullable()
    .default(null),
});

// A rate switch needs BOTH the month and the rate — half of it would be silently ignored by
// the projection, quietly leaving the loan on its fixed rate. Reject it instead.
export const bothOrNeitherVariable = (v: { rateVariableFrom?: string | null; variableRateBps?: number | null }): boolean =>
  (v.rateVariableFrom == null) === (v.variableRateBps == null);
const variableRateMsg = { message: 'set both the variable-from month and the variable rate, or neither', path: ['variableRateBps'] };

export const accountCreate = accountBase.refine(bothOrNeitherVariable, variableRateMsg);
// PATCH is partial, so the pair is validated against the merged result in updateAccount.
export const accountUpdate = accountBase.partial();

export const categoryCreate = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['expense', 'income']),
  parentId: z.number().int().nullable().default(null),
  color: z.string().trim().max(20).nullable().default(null),
  icon: z.string().trim().max(40).nullable().default(null),
  sort: z.number().int().default(0),
});
export const categoryUpdate = categoryCreate.partial();

export const suggestCategoryQuery = z.object({ description: z.string().trim().min(1).max(200) });

export const categoryRuleCreate = z.object({
  pattern: z.string().trim().min(1).max(100),
  categoryId: z.number().int().positive(),
  sort: z.number().int().default(0),
});

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
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
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

// --- Phase 3: recurring & predictions ---

const recurringBase = z.object({
  cadence: z.enum(['monthly', 'yearly']),
  dayOfMonth: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12).nullable().default(null),
  amountCents: cents.refine((v) => v !== 0, 'amount cannot be zero'),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().default(null),
  description: z.string().trim().max(200).default(''),
  note: z.string().trim().max(500).nullable().default(null),
  autoPost: z.boolean().default(false),
  startDate: date,
  endDate: date.nullable().default(null),
});
export const recurringCreate = recurringBase
  .refine((r) => r.cadence !== 'yearly' || r.month !== null, {
    message: 'yearly rules need a month',
    path: ['month'],
  })
  .refine((r) => r.endDate === null || r.endDate >= r.startDate, {
    message: 'end date must be on or after start date',
    path: ['endDate'],
  });
export const recurringUpdate = recurringBase.partial().extend({ archived: z.boolean().optional() });

export const upcomingQuery = z.object({ days: z.coerce.number().int().positive().max(400).default(60) });
export const forecastQuery = z.object({ months: z.coerce.number().int().positive().max(24).default(6) });

// --- Phase 4: bank import ---

const parsedRow = z.object({
  date,
  amountCents: cents.refine((v) => v !== 0, 'amount cannot be zero'),
  description: z.string().trim().max(200).default(''),
  externalRef: z.string().trim().max(120).nullable().default(null),
});

export const importPreview = z.object({
  accountId: z.number().int().positive(),
  rows: z.array(parsedRow).min(1).max(5000),
});

export const importCommit = z.object({
  accountId: z.number().int().positive(),
  source: z.enum(['pdf', 'csv']).default('pdf'),
  description: z.string().trim().max(200).default(''),
  rows: z
    .array(parsedRow.extend({ categoryId: z.number().int().positive().nullable().default(null) }))
    .min(1)
    .max(5000),
});

// --- Phase 5: receipts ---

export const receiptCreate = z.object({
  date,
  amountCents: cents.refine((v) => v !== 0, 'amount cannot be zero'),
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().default(null),
  description: z.string().trim().max(200).default(''),
  imageBase64: z.string().min(1).max(16_000_000), // ~12 MB decoded; client downscales well below
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  ocrText: z.string().max(50_000).nullable().default(null),
  parsedJson: z.string().max(4000).nullable().default(null),
});

// --- Phase 6: statistics ---

export const statsQuery = z.object({ months: z.coerce.number().int().positive().max(60).default(12) });

// Validate the backup envelope shape before restore. Row column names are further filtered
// against the real schema in backup.ts, so no untrusted key reaches SQL.
export const backupImport = z.object({
  version: z.literal(1),
  exportedAt: z.string().default(''),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

export const txListQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

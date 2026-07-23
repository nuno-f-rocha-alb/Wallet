import { z } from 'zod';

const cents = z.number().int();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

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

export const txListQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

import type { DatabaseSync } from 'node:sqlite';
import type { DebtLine, DebtSummary } from '@wallet/shared';
import { amortize, monthPlus } from '@wallet/shared/debt';

type Row = Record<string, unknown>;
const rows = <T>(r: unknown[]): T[] => r as T[];

/** Loans & credit cards with a balance owed, each with its amortization projection. */
export function getDebts(db: DatabaseSync, userId: number): DebtSummary {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const raw = rows<Row>(
    db
      .prepare(
        `SELECT a.id, a.name, a.type, a.interest_rate_bps, a.monthly_payment_cents,
           a.rate_variable_from, a.variable_rate_bps,
           a.opening_balance_cents + COALESCE(
             (SELECT SUM(t.amount_cents) FROM transactions t
              WHERE t.account_id = a.id AND t.user_id = a.user_id), 0) AS balance_cents
         FROM accounts a
         WHERE a.user_id = ? AND a.archived = 0 AND a.type IN ('loan','credit_card')
         ORDER BY a.sort, a.id`,
      )
      .all(userId),
  );

  const lines: DebtLine[] = [];
  let totalOwed = 0;
  let totalMonthly = 0;
  for (const r of raw) {
    const balance = r.balance_cents as number;
    const outstanding = balance < 0 ? -balance : 0; // owed = negative balance
    if (outstanding === 0) continue; // nothing owed → not a live debt
    const rateBps = (r.interest_rate_bps as number | null) ?? null;
    const payment = (r.monthly_payment_cents as number | null) ?? null;
    const variableFrom = (r.rate_variable_from as string | null) ?? null;
    const variableRateBps = (r.variable_rate_bps as number | null) ?? null;
    totalOwed += outstanding;
    if (payment) totalMonthly += payment;

    let coversInterest = true;
    let payoffMonths: number | null = null;
    let totalInterestCents: number | null = null;
    let payoffDate: string | null = null;
    if (rateBps !== null && payment !== null) {
      const rateChange = variableFrom && variableRateBps !== null ? { fromMonth: variableFrom, annualRateBps: variableRateBps } : null;
      const a = amortize({ outstandingCents: outstanding, annualRateBps: rateBps, paymentCents: payment, startMonth: thisMonth, rateChange });
      coversInterest = a.coversInterest;
      payoffMonths = a.payoffMonths;
      totalInterestCents = a.totalInterestCents;
      payoffDate = a.payoffMonths !== null ? monthPlus(thisMonth, a.payoffMonths) : null;
    }

    lines.push({
      accountId: r.id as number,
      name: r.name as string,
      type: r.type as 'loan' | 'credit_card',
      outstandingCents: outstanding,
      interestRateBps: rateBps,
      monthlyPaymentCents: payment,
      rateVariableFrom: variableFrom,
      variableRateBps,
      coversInterest,
      payoffMonths,
      payoffDate,
      totalInterestCents,
    });
  }
  return { lines, totalOwedCents: totalOwed, totalMonthlyCents: totalMonthly };
}

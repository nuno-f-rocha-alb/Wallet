// Loan amortization. Pure integer-cents month-by-month simulation (no floats in the ledger,
// only in the rate factor), so both the server and vitest use it. A loan is an account of
// type `loan`/`credit_card` carrying an annual rate (basis points) + a fixed monthly payment.

/** A single rate switch (e.g. fixed → variable): from `fromMonth` on, use `annualRateBps`. */
export interface RateChange {
  fromMonth: string; // YYYY-MM
  annualRateBps: number;
}

export interface AmortizeInput {
  outstandingCents: number; // amount still owed (positive)
  annualRateBps: number; // annual interest, basis points (350 = 3.50%)
  paymentCents: number; // fixed monthly payment
  startMonth?: string; // YYYY-MM the projection starts (required when rateChange is set)
  rateChange?: RateChange | null; // one fixed→variable switch during the loan
}

export interface AmortizeResult {
  coversInterest: boolean; // false → payment doesn't even cover the first month's interest
  payoffMonths: number | null; // months until the balance hits 0
  totalInterestCents: number | null; // interest paid over the life of the loan
  firstInterestCents: number; // interest portion of the next payment (info)
}

export function amortize({ outstandingCents, annualRateBps, paymentCents, startMonth, rateChange }: AmortizeInput): AmortizeResult {
  if (rateChange && !startMonth) throw new Error('amortize: rateChange requires startMonth');
  // Annual rate (bps) applicable to month index i, honoring a single fixed→variable switch.
  const rateAt = (i: number): number =>
    rateChange && startMonth && monthPlus(startMonth, i) >= rateChange.fromMonth ? rateChange.annualRateBps : annualRateBps;
  const monthlyRate = (i: number): number => rateAt(i) / 10000 / 12;

  if (outstandingCents <= 0) return { coversInterest: true, payoffMonths: 0, totalInterestCents: 0, firstInterestCents: 0 };
  const firstInterest = Math.round(outstandingCents * monthlyRate(0));

  // Simulate month by month rather than pre-judging: a loan can grow under the fixed rate yet
  // clear once a lower variable rate begins (and vice-versa). The outcome decides everything.
  let bal = outstandingCents;
  let months = 0;
  let interestTotal = 0;
  const MAX = 1200; // 100-year projection horizon
  while (bal > 0 && months < MAX) {
    const interest = Math.round(bal * monthlyRate(months));
    let principal = paymentCents - interest;
    if (principal > bal) principal = bal; // final (smaller) payment
    bal -= principal; // grows when the payment can't cover the interest
    interestTotal += interest;
    months++;
  }
  if (bal <= 0) return { coversInterest: true, payoffMonths: months, totalInterestCents: interestTotal, firstInterestCents: firstInterest };
  // Not cleared within the horizon: distinguish "shrinking, just slow" from "growing, unpayable".
  return { coversInterest: bal < outstandingCents, payoffMonths: null, totalInterestCents: null, firstInterestCents: firstInterest };
}

/** month (YYYY-MM) that is `n` months after a start month — for the payoff date. */
export function monthPlus(startMonth: string, n: number): string {
  const [y, m] = startMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

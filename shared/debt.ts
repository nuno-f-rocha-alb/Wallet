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
  /**
   * Contractual final month (YYYY-MM). When set alongside a rateChange, model what lenders
   * actually do at a reset: keep the term and recompute the payment over the months left,
   * instead of holding the payment and letting the term drift.
   */
  holdTermTo?: string | null;
}

export interface AmortizeResult {
  coversInterest: boolean; // false → payment doesn't even cover the first month's interest
  payoffMonths: number | null; // months until the balance hits 0
  totalInterestCents: number | null; // interest paid over the life of the loan
  firstInterestCents: number; // interest portion of the next payment (info)
  /** Recomputed payment from the rate switch on, when holdTermTo keeps the term fixed. */
  paymentAfterChangeCents: number | null;
}

/** Whole months from `a` to `b` (YYYY-MM); negative when b precedes a. */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** Level payment that clears `balanceCents` over `months` at `monthlyRate` (annuity). */
export function annuityPayment(balanceCents: number, monthlyRate: number, months: number): number {
  if (months <= 0) return balanceCents;
  if (monthlyRate === 0) return Math.ceil(balanceCents / months);
  // Ceil, not round: rounding down leaves a few cents outstanding and spills an extra month
  // past the contractual end. The final payment absorbs the difference instead.
  return Math.ceil((balanceCents * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months)));
}

export function amortize({ outstandingCents, annualRateBps, paymentCents, startMonth, rateChange, holdTermTo }: AmortizeInput): AmortizeResult {
  if (rateChange && !startMonth) throw new Error('amortize: rateChange requires startMonth');
  if (holdTermTo && !startMonth) throw new Error('amortize: holdTermTo requires startMonth');
  // Annual rate (bps) applicable to month index i, honoring a single fixed→variable switch.
  const rateAt = (i: number): number =>
    rateChange && startMonth && monthPlus(startMonth, i) >= rateChange.fromMonth ? rateChange.annualRateBps : annualRateBps;
  const monthlyRate = (i: number): number => rateAt(i) / 10000 / 12;

  if (outstandingCents <= 0)
    return { coversInterest: true, payoffMonths: 0, totalInterestCents: 0, firstInterestCents: 0, paymentAfterChangeCents: null };
  const firstInterest = Math.round(outstandingCents * monthlyRate(0));

  // Simulate month by month rather than pre-judging: a loan can grow under the fixed rate yet
  // clear once a lower variable rate begins (and vice-versa). The outcome decides everything.
  let bal = outstandingCents;
  let months = 0;
  let interestTotal = 0;
  let payment = paymentCents;
  let paymentAfterChange: number | null = null;
  const MAX = 1200; // 100-year projection horizon
  while (bal > 0 && months < MAX) {
    // Re-level once, on the first projected month at or after the reset. Using >= (not ==) also
    // covers a reset that already took effect before this projection starts, and the remaining
    // term is measured from that month so the loan still lands on its contractual end.
    const currentMonth = startMonth ? monthPlus(startMonth, months) : null;
    if (holdTermTo && rateChange && currentMonth && paymentAfterChange === null && currentMonth >= rateChange.fromMonth) {
      const remaining = monthsBetween(currentMonth, holdTermTo) + 1; // inclusive of the last month
      // A term that has already elapsed can't be held: re-levelling would ask for the whole
      // balance in one payment, and the interest on it would still leave a residue — reporting
      // a "held" term it then overshoots. Keep the contractual payment and let the term run on.
      if (remaining > 0) {
        payment = annuityPayment(bal, monthlyRate(months), remaining);
        paymentAfterChange = payment;
      }
    }
    const interest = Math.round(bal * monthlyRate(months));
    let principal = payment - interest;
    if (principal > bal) principal = bal; // final (smaller) payment
    bal -= principal; // grows when the payment can't cover the interest
    interestTotal += interest;
    months++;
  }
  if (bal <= 0)
    return { coversInterest: true, payoffMonths: months, totalInterestCents: interestTotal, firstInterestCents: firstInterest, paymentAfterChangeCents: paymentAfterChange };
  // Not cleared within the horizon: distinguish "shrinking, just slow" from "growing, unpayable".
  return { coversInterest: bal < outstandingCents, payoffMonths: null, totalInterestCents: null, firstInterestCents: firstInterest, paymentAfterChangeCents: paymentAfterChange };
}

/** month (YYYY-MM) that is `n` months after a start month — for the payoff date. */
export function monthPlus(startMonth: string, n: number): string {
  const [y, m] = startMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

import { describe, expect, it } from 'vitest';
import { amortize, annuityPayment, monthPlus } from './debt.js';

describe('amortize', () => {
  it('0% interest: months = balance / payment, no interest', () => {
    const r = amortize({ outstandingCents: 100000, annualRateBps: 0, paymentCents: 25000 });
    expect(r).toMatchObject({ coversInterest: true, payoffMonths: 4, totalInterestCents: 0 });
  });

  it('with interest: hand-computed month-by-month payoff and total interest', () => {
    // €100 owed, 120%/yr = 10%/mo, €50/mo:
    // M1 int 1000, prin 4000 → bal 6000 (int 1000)
    // M2 int  600, prin 4400 → bal 1600 (int 1600)
    // M3 int  160, prin capped to 1600 → bal 0 (int 1760)
    const r = amortize({ outstandingCents: 10000, annualRateBps: 120_00, paymentCents: 5000 });
    expect(r.coversInterest).toBe(true);
    expect(r.payoffMonths).toBe(3);
    expect(r.totalInterestCents).toBe(1760);
    expect(r.firstInterestCents).toBe(1000);
  });

  it('payment below the first interest never pays off', () => {
    const r = amortize({ outstandingCents: 20000000, annualRateBps: 600, paymentCents: 5000 }); // €200k @6%, €50/mo
    expect(r).toMatchObject({ coversInterest: false, payoffMonths: null, totalInterestCents: null });
    expect(r.firstInterestCents).toBe(100000); // €1000 interest > €50 payment
  });

  it('nothing owed → 0 months, 0 interest', () => {
    expect(amortize({ outstandingCents: 0, annualRateBps: 500, paymentCents: 1000 }).payoffMonths).toBe(0);
  });

  it('applies a fixed→variable rate switch mid-loan', () => {
    // €300 owed, €100/mo, start 2026-01. Fixed 0% until the switch, then 120%/yr (10%/mo) from 2026-02.
    // (cents) M0 2026-01  (0%): int    0, prin 10000        → bal 20000
    //         M1 2026-02 (10%): int 2000, prin  8000        → bal 12000
    //         M2 2026-03 (10%): int 1200, prin  8800        → bal  3200
    //         M3 2026-04 (10%): int  320, prin capped 3200  → bal     0
    const r = amortize({
      outstandingCents: 30000,
      annualRateBps: 0,
      paymentCents: 10000,
      startMonth: '2026-01',
      rateChange: { fromMonth: '2026-02', annualRateBps: 120_00 },
    });
    expect(r.payoffMonths).toBe(4);
    expect(r.totalInterestCents).toBe(3520); // 0 + 2000 + 1200 + 320
  });

  it('a loan underwater at the fixed rate can still clear after a lower variable rate', () => {
    // €100 owed, €50/mo. Fixed 1200%/yr (100%/mo) → month 0 interest €100 > payment, balance grows
    // to €150. Then 0% from 2026-02: €50/mo clears €150 in 3 more months → 4 total, €100 interest.
    const r = amortize({
      outstandingCents: 10000,
      annualRateBps: 1200_00,
      paymentCents: 5000,
      startMonth: '2026-01',
      rateChange: { fromMonth: '2026-02', annualRateBps: 0 },
    });
    expect(r.payoffMonths).toBe(4);
    expect(r.totalInterestCents).toBe(10000);
  });

  it('holdTermTo re-levels the payment at the reset and keeps the contractual end month', () => {
    // €1000 over 10 months at 0%, so €100/mo. At month 5 the rate jumps; holding the term to
    // 2026-10 must raise the payment so it still clears exactly then (not drift past it).
    const held = amortize({
      outstandingCents: 100000,
      annualRateBps: 0,
      paymentCents: 10000,
      startMonth: '2026-01',
      rateChange: { fromMonth: '2026-06', annualRateBps: 120_00 },
      holdTermTo: '2026-10',
    });
    expect(held.payoffMonths).toBe(10); // 2026-01 … 2026-10 — term preserved
    expect(held.paymentAfterChangeCents).toBeGreaterThan(10000); // payment went up

    // Same loan without holdTermTo: payment stays put, so the higher rate drags the term out.
    const drifted = amortize({
      outstandingCents: 100000,
      annualRateBps: 0,
      paymentCents: 10000,
      startMonth: '2026-01',
      rateChange: { fromMonth: '2026-06', annualRateBps: 120_00 },
    });
    expect(drifted.payoffMonths).toBeGreaterThan(10);
    expect(drifted.paymentAfterChangeCents).toBeNull();
  });

  it('re-levels even when the reset already took effect before the projection starts', () => {
    // Reset was 2026-06; we only start projecting in 2026-08. The payment must still be
    // re-levelled over the months left, not left stale at the pre-reset figure.
    const r = amortize({
      outstandingCents: 100000,
      annualRateBps: 0,
      paymentCents: 10000,
      startMonth: '2026-08',
      rateChange: { fromMonth: '2026-06', annualRateBps: 120_00 },
      holdTermTo: '2026-12',
    });
    expect(r.paymentAfterChangeCents).not.toBeNull();
    expect(r.payoffMonths).toBe(5); // 2026-08 … 2026-12, the contractual end
  });

  it('annuityPayment matches the standard formula (and 0% divides evenly)', () => {
    expect(annuityPayment(100000, 0, 10)).toBe(10000);
    // €7,065.78 at 9.5%/yr over 120 months → €91.43 (a real lender quote)
    expect(annuityPayment(706578, 0.095 / 12, 120)).toBe(9143);
  });

  it('rateChange without startMonth is rejected', () => {
    expect(() => amortize({ outstandingCents: 1000, annualRateBps: 300, paymentCents: 100, rateChange: { fromMonth: '2027-06', annualRateBps: 400 } })).toThrow();
  });

  it('payoff beyond the 100-year horizon reports unknown, not the guard value', () => {
    // 0% interest, 120100¢ owed, 100¢/mo → needs 1201 months, past the 1200 guard.
    const r = amortize({ outstandingCents: 120100, annualRateBps: 0, paymentCents: 100 });
    expect(r.coversInterest).toBe(true); // the payment does chip away at it…
    expect(r.payoffMonths).toBeNull(); // …but not within the horizon, so: unknown (not 1200)
    expect(r.totalInterestCents).toBeNull();
  });
});

it('monthPlus rolls the year over', () => {
  expect(monthPlus('2026-07', 6)).toBe('2027-01');
  expect(monthPlus('2026-01', 0)).toBe('2026-01');
});

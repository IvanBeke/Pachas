/**
 * Money helpers. Amounts are persisted as integer cents; the HTTP API and the
 * UI use decimal major units. Every conversion goes through here so there is
 * exactly one rounding rule.
 */

/** Largest amount (in major units) accepted for a single expense or payment. */
export const MAX_AMOUNT = 1_000_000_000;

/**
 * Decimal major units to integer cents. `toPrecision(15)` strips binary float
 * noise first, so `1.005 * 100 = 100.49999…` rounds to 101 as a person would.
 */
export function toCents(amount: number): number {
  return Math.round(Number((amount * 100).toPrecision(15)));
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Round to cents in decimal units. */
export function round2(n: number): number {
  return fromCents(toCents(n));
}

/**
 * Splits `totalCents` across `weights` proportionally, using the largest
 * remainder method so the parts always sum to the total exactly. Ties are
 * broken by input order, so the result is deterministic.
 */
export function allocateCents(
  totalCents: number,
  weights: number[],
): number[] {
  const out = weights.map(() => 0);
  const wSum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!(wSum > 0) || totalCents === 0) return out;
  const sign = totalCents < 0 ? -1 : 1;
  const total = Math.abs(totalCents);
  const remainders: { i: number; r: number }[] = [];
  let assigned = 0;
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    const exact = (total * w) / wSum;
    const base = Math.floor(exact);
    out[i] = base;
    assigned += base;
    remainders.push({ i, r: exact - base });
  });
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < total - assigned; k++) {
    const target = remainders[k % remainders.length];
    if (target) out[target.i] = (out[target.i] ?? 0) + 1;
  }
  return sign < 0 ? out.map((v) => -v) : out;
}

/**
 * Money helpers. There are two precisions, and mixing them up is the main way to
 * get this wrong:
 *
 * - **Cents (2 decimals)** are what people type: amounts, item prices, tax and
 *   exact-split values. Use `toCents` / `fromCents` / `round2` to validate and
 *   combine input.
 * - **Mills (3 decimals, thousandths)** are what is stored and computed on the
 *   server: base-currency amounts, shares, balances and settlements. Use
 *   `toMills` / `fromMills` / `round3`. The extra decimal lets the rounding
 *   remainders of equal splits even out over time.
 *
 * The HTTP API and the UI use decimal major units; every conversion goes
 * through here so there is exactly one rounding rule per precision.
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

/** Decimal major units to integer mills (thousandths); same float-noise handling as `toCents`. */
export function toMills(amount: number): number {
  return Math.round(Number((amount * 1000).toPrecision(15)));
}

export function fromMills(mills: number): number {
  return mills / 1000;
}

/** Round to mills in decimal units. */
export function round3(n: number): number {
  return fromMills(toMills(n));
}

/**
 * Splits an integer total (cents or mills) across `weights` proportionally, using the largest
 * remainder method so the parts always sum to the total exactly. Ties are
 * broken by input order, so the result is deterministic.
 */
export function allocateMinor(
  totalMinor: number,
  weights: number[],
): number[] {
  const out = weights.map(() => 0);
  const wSum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!(wSum > 0) || totalMinor === 0) return out;
  const sign = totalMinor < 0 ? -1 : 1;
  const total = Math.abs(totalMinor);
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

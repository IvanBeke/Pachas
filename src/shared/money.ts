/**
 * Money helpers. Amounts are integer **cents** (2 decimals) everywhere: what people
 * type, what the database stores, and what the server derives (base-currency
 * amounts, shares, balances, settlements). The HTTP API and the UI use decimal
 * major units; every conversion goes through here so there is exactly one rounding
 * rule.
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
 * Who gets the leftover unit when remainders tie. `order` is the fixed ring of
 * member ids (the same on the client and the server); `cursor` is the ring
 * position whose turn it is.
 */
export interface RoundingRing {
  order: string[];
  cursor: number;
}

/** Remainders closer than this are a tie; it only has to absorb float noise. */
const REMAINDER_EPSILON = 1e-9;

/**
 * Splits a total in cents across `weights`, handing the leftover cents to the
 * largest remainders. Remainders that tie (all of an equal split) are awarded
 * round-robin: the person closest to the ring cursor first. `nextCursor` moves
 * just past the last person who won a tie, and stays put when no tie decided
 * anything.
 *
 * Parts always sum to the total exactly. `ids` lines up with `weights`.
 */
export function allocateRoundRobin(
  totalCents: number,
  weights: number[],
  ids: string[],
  ring?: RoundingRing,
): { cents: number[]; nextCursor: number } {
  const len = ring?.order.length ?? 0;
  const cursor = len ? ((Math.trunc(ring!.cursor) % len) + len) % len : 0;
  const out = weights.map(() => 0);
  const wSum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!(wSum > 0) || totalCents === 0) return { cents: out, nextCursor: cursor };

  const sign = totalCents < 0 ? -1 : 1;
  const total = Math.abs(totalCents);

  const candidates: { i: number; r: number; distance: number }[] = [];
  let assigned = 0;
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    const exact = Math.round(((total * w) / wSum) * 1e9) / 1e9;
    const base = Math.floor(exact);
    out[i] = base;
    assigned += base;
    const pos = len ? ring!.order.indexOf(ids[i] ?? "") : -1;
    candidates.push({
      i,
      r: exact - base,
      distance: pos >= 0 ? (pos - cursor + len) % len : len + i,
    });
  });
  candidates.sort((a, b) =>
    Math.abs(a.r - b.r) > REMAINDER_EPSILON
      ? b.r - a.r
      : a.distance - b.distance || a.i - b.i,
  );

  const leftover = total - assigned;
  for (let k = 0; k < leftover; k++) {
    const target = candidates[k % candidates.length];
    if (target) out[target.i] = (out[target.i] ?? 0) + 1;
  }

  let nextCursor = cursor;
  const boundary = candidates[leftover];
  if (len && leftover > 0 && boundary) {
    const winners = candidates
      .slice(0, leftover)
      .filter((c) => Math.abs(c.r - boundary.r) <= REMAINDER_EPSILON);
    const last = winners[winners.length - 1];
    if (last && last.distance < len) nextCursor = (cursor + last.distance + 1) % len;
  }
  return { cents: out.map((v) => (v === 0 ? 0 : sign * v)), nextCursor };
}

/**
 * Splits an integer total in cents across `weights` proportionally, using the largest
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

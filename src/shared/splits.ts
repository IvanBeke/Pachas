/**
 * Canonical split maths, shared by the client and the server.
 *
 * The server is authoritative: it recomputes every split from the selection
 * the user made, and never trusts a client-supplied amount. The client runs
 * this same code purely to render a live preview.
 *
 * All arithmetic happens in integer cents (see `money.ts`), so every successful
 * result sums to the total exactly — there is no tolerance to tune. Leftover
 * cents go to the largest remainders and ties are handed out round-robin. The
 * values people type (exact amounts, item prices) only serve as weights. Inputs and outputs stay in
 * decimal units because that is what the API and the forms speak.
 */
import {
  allocateCents,
  allocateRoundRobin,
  fromCents,
  round2,
  toCents,
  type RoundingRing,
} from "./money";

export { round2, type RoundingRing } from "./money";

export const SPLIT_TYPES = ["equal", "exact", "percent", "shares", "items"] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export function isSplitType(value: unknown): value is SplitType {
  return typeof value === "string" && (SPLIT_TYPES as readonly string[]).includes(value);
}

export interface ExpenseItem {
  name: string;
  price: number;
  members: string[];
}

export interface SplitInput {
  splitType: SplitType;
  /** Amount in the group's base currency. */
  amountBase: number;
  /**
   * Amount in the expense currency. Exact splits are typed in this currency,
   * so they must add up to it. Defaults to `amountBase`.
   */
  amount?: number;
  /** Members taking part in the split. */
  participants: string[];
  /** Every group member — `items` mode assigns a share to all of them. */
  memberIds: string[];
  /** Per-member input values (exact amount, percent, or share weight). */
  values: Record<string, number>;
  /** Itemised bill, used when splitType is "items". */
  items?: ExpenseItem[];
  /**
   * Whose turn it is to get a leftover cent. Without it, ties go to the first
   * participant, which is only fit for tests.
   */
  rounding?: RoundingRing;
}

export type SplitFailure =
  | "exact_mismatch"
  | "percent_mismatch"
  | "no_shares"
  | "no_participants"
  | "bad_items"
  | "bad_amount";

export type SplitResult =
  | { ok: true; splits: Record<string, number>; nextCursor: number }
  | { ok: false; reason: SplitFailure };

/** Percentages are not money, so they get a small tolerance for 33.33 × 3. */
const PERCENT_TOLERANCE = 0.011;

export const sumSplits = (splits: Record<string, number>): number =>
  fromCents(
    Object.values(splits).reduce((a, b) => a + toCents(b ?? 0), 0),
  );

function zipCents(ids: string[], cents: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    out[id] = fromCents(cents[i] ?? 0);
  });
  return out;
}

/** Per-item shares in cents of the expense currency, keyed by member. */
function itemsTotalsCents(
  items: ExpenseItem[],
  memberIds: string[],
): Map<string, number> {
  const totals = new Map<string, number>(memberIds.map((id) => [id, 0]));
  for (const it of items) {
    const enabled = (Array.isArray(it.members) ? it.members : []).filter((id) =>
      totals.has(id),
    );
    if (!enabled.length || !(it.price > 0)) continue;
    const parts = allocateCents(toCents(it.price), enabled.map(() => 1));
    enabled.forEach((id, i) => {
      totals.set(id, (totals.get(id) ?? 0) + (parts[i] ?? 0));
    });
  }
  return totals;
}

/**
 * Per-person totals in expense currency: each item split evenly over its
 * enabled members. Members in no item get 0.
 */
export function itemsTotals(
  items: ExpenseItem[],
  memberIds: string[],
): Record<string, number> {
  const totals = itemsTotalsCents(items, memberIds);
  return zipCents(memberIds, memberIds.map((id) => totals.get(id) ?? 0));
}

/**
 * Turns a split selection into concrete per-member amounts.
 *
 * Every successful branch returns shares summing to `amountBase` exactly,
 * because the ledger is only balanced if it does.
 */
export function computeSplits(input: SplitInput): SplitResult {
  const { splitType, amountBase, participants, memberIds, values } = input;

  // A non-finite total is refused here rather than downstream, because it is
  // unrecoverable once it reaches the ledger: `Infinity - Infinity` is `NaN`,
  // and every comparison against `NaN` is false. This is the shared
  // implementation, so the guard protects the server and the preview alike.
  const amount = input.amount ?? amountBase;
  if (!Number.isFinite(amountBase) || !Number.isFinite(amount)) {
    return { ok: false, reason: "bad_amount" };
  }
  const totalCents = toCents(amountBase);
  // Every branch hands out a total over some weights; this is the one place
  // that does it, so the rounding rule cannot differ between split types.
  const allocate = (ids: string[], weights: number[]): SplitResult => {
    const { cents, nextCursor } = allocateRoundRobin(totalCents, weights, ids, input.rounding);
    return { ok: true, splits: zipCents(ids, cents), nextCursor };
  };
  const weightsOf = (fallback: number) =>
    participants.map((id) => values[id] ?? fallback);
  const weightsValid = (w: number[]) => w.every((v) => Number.isFinite(v) && v >= 0);

  if (splitType === "items") {
    const items = input.items ?? [];
    if (!items.length) return { ok: false, reason: "bad_items" };
    // Items are priced in the expense currency. Allocating the base total in
    // proportion to each person's item subtotal converts currency in one exact step.
    const totals = itemsTotalsCents(items, memberIds);
    const weights = memberIds.map((id) => totals.get(id) ?? 0);
    if (!weights.some((w) => w > 0)) return { ok: false, reason: "bad_items" };
    return allocate(memberIds, weights);
  }

  if (!participants.length) return { ok: false, reason: "no_participants" };

  if (splitType === "equal") {
    return allocate(participants, participants.map(() => 1));
  }

  if (splitType === "exact") {
    const typed = weightsOf(0);
    if (!weightsValid(typed)) return { ok: false, reason: "bad_amount" };
    const typedCents = typed.map(toCents);
    const typedSum = typedCents.reduce((a, b) => a + b, 0);
    if (typedSum !== toCents(amount) || typedSum <= 0) {
      return { ok: false, reason: "exact_mismatch" };
    }
    // Typed in the expense currency; proportional allocation converts to base.
    return allocate(participants, typedCents);
  }

  if (splitType === "percent") {
    const pct = weightsOf(0);
    if (!weightsValid(pct)) return { ok: false, reason: "bad_amount" };
    const pctSum = pct.reduce((a, b) => a + b, 0);
    if (Math.abs(pctSum - 100) > PERCENT_TOLERANCE) {
      return { ok: false, reason: "percent_mismatch" };
    }
    return allocate(participants, pct);
  }

  // shares: each member's weight is a fraction of the total.
  const shares = weightsOf(1);
  if (!weightsValid(shares) || !(shares.reduce((a, b) => a + b, 0) > 0)) {
    return { ok: false, reason: "no_shares" };
  }
  return allocate(participants, shares);
}

/**
 * The round-robin ring for a group: its members in a fixed order, so the
 * client and the server agree on whose turn the stored `cursor` points to.
 */
export function roundingRing(memberIds: string[], cursor: number): RoundingRing {
  return { order: [...memberIds].sort(), cursor };
}

export type PreviewSplitType = "equal" | "percent" | "shares";

export function hasSplitPreview(splitType: SplitType): splitType is PreviewSplitType {
  return splitType === "equal" || splitType === "percent" || splitType === "shares";
}

/**
 * What each checked participant gets, for the live preview next to the split
 * inputs. `amount` is in the expense currency.
 *
 * When the inputs are valid this is exactly `computeSplits`, so the preview shows
 * the amounts that will really be stored (spare cents included). While they
 * are incomplete — percentages that do not total 100, shares that are all zero —
 * it falls back to what was typed so far, unscaled, so the preview still moves
 * as the user types; the form's "remaining" message says what is wrong.
 */
export function previewSplits(input: {
  splitType: PreviewSplitType;
  amount: number;
  participants: string[];
  memberIds: string[];
  values: Record<string, number>;
  rounding?: RoundingRing;
}): Record<string, number> {
  const { splitType, amount, participants, memberIds, values, rounding } = input;
  const result = computeSplits({
    splitType,
    amount,
    amountBase: amount,
    participants,
    memberIds,
    values,
    rounding,
  });
  if (result.ok) return result.splits;
  const out: Record<string, number> = {};
  for (const id of participants) {
    const typed = values[id] ?? 0;
    out[id] =
      splitType === "percent" && Number.isFinite(amount) && Number.isFinite(typed) && typed > 0
        ? round2((amount * typed) / 100)
        : 0;
  }
  return out;
}

/**
 * Turns stored shares back into the numbers the `exact` / `percent` inputs
 * expect, so editing an expense pre-fills the form.
 *
 * The database only stores resulting amounts in base currency, so `percent`
 * has to be reconstructed by dividing through by the total, and `exact` is
 * converted back into the expense currency.
 */
export function splitsToInputValues(
  splits: Record<string, number>,
  amountBase: number,
  splitType: SplitType,
  amount: number = amountBase,
): Record<string, number> {
  const ids = Object.keys(splits);
  const shares = ids.map((id) => toCents(splits[id] ?? 0));
  if (splitType === "percent" && amountBase > 0) {
    // Hundredths of a percent, allocated so the reconstruction totals 100.
    return zipCents(ids, allocateCents(10_000, shares));
  }
  if (splitType === "exact" && amountBase > 0 && toCents(amount) !== toCents(amountBase)) {
    return zipCents(ids, allocateCents(toCents(amount), shares));
  }
  const out: Record<string, number> = {};
  ids.forEach((id) => {
    out[id] = round2(splits[id] ?? 0);
  });
  return out;
}

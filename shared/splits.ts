/**
 * Canonical split maths, shared by the client and the server.
 *
 * The server is authoritative: it recomputes every split from the selection
 * the user made, and never trusts a client-supplied amount. The client runs
 * this same code purely to render a live preview.
 *
 * Lives in `shared/` so the two copies physically cannot drift.
 */

export type SplitType = "equal" | "exact" | "percent" | "shares" | "items";

export interface ExpenseItem {
  name: string;
  price: number;
  members: string[];
}

export interface SplitInput {
  splitType: SplitType;
  /** Amount in the group's base currency. */
  amountBase: number;
  /** Exchange rate applied to convert the expense into base currency. */
  rate?: number;
  /** Members taking part in the split. */
  participants: string[];
  /** Every group member — `items` mode assigns a share to all of them. */
  memberIds: string[];
  /** Per-member input values (exact amount, percent, or share weight). */
  values: Record<string, number>;
  /** Itemised bill, used when splitType is "items". */
  items?: ExpenseItem[];
}

export type SplitFailure =
  | "exact_mismatch"
  | "percent_mismatch"
  | "no_shares"
  | "no_participants"
  | "bad_items"
  | "bad_amount";

export type SplitResult =
  | { ok: true; splits: Record<string, number> }
  | { ok: false; reason: SplitFailure };

/** Round to cents, avoiding float drift. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const sumSplits = (splits: Record<string, number>): number =>
  round2(Object.values(splits).reduce((a, b) => a + (b ?? 0), 0));

// Per-person totals in expense currency: each item split evenly over its
// enabled members. Members in no item get 0.
export function itemsTotals(
  items: ExpenseItem[],
  memberIds: string[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  memberIds.forEach((id) => {
    totals[id] = 0;
  });
  items.forEach((it) => {
    const enabled = it.members.filter((id) => id in totals);
    if (!enabled.length || !(it.price > 0)) return;
    const each = round2(it.price / enabled.length);
    let running = 0;
    enabled.forEach((id, i) => {
      // The last member absorbs the item's remainder so the per-item total
      // is exact.
      const v = i === enabled.length - 1 ? round2(it.price - running) : each;
      running = round2(running + v);
      totals[id] = round2((totals[id] ?? 0) + v);
    });
  });
  return totals;
}

/**
 * Fold penny drift into one participant so shares always reconcile to the
 * total. `pick` is injected so the caller decides who absorbs it (the server
 * is deterministic, the client randomises) and so this stays testable.
 */
export function assignRemainder(
  splits: Record<string, number>,
  target: number,
  pick: (ids: string[]) => string | undefined,
): void {
  const diff = round2(target - sumSplits(splits));
  if (Math.abs(diff) < 0.005) return;
  const lucky = pick(Object.keys(splits));
  if (!lucky) return;
  splits[lucky] = round2((splits[lucky] ?? 0) + diff);
}

/**
 * Turns a split selection into concrete per-member amounts.
 *
 * Every successful branch returns shares summing to `amountBase` exactly,
 * because the ledger is only balanced if it does.
 */
export function computeSplits(input: SplitInput): SplitResult {
  const { splitType, amountBase, participants, memberIds, values } = input;
  const rate = input.rate ?? 1;
  const splits: Record<string, number> = {};

  // A non-finite total is refused here rather than downstream, because it is
  // unrecoverable once it reaches the ledger: `Infinity - Infinity` is `NaN`,
  // and every comparison against `NaN` is false, so the caller's reconciliation
  // check would pass it through. This is the shared implementation, so the guard
  // protects the server and the client preview alike.
  if (!Number.isFinite(amountBase) || !Number.isFinite(rate)) {
    return { ok: false, reason: "bad_amount" };
  }

  if (splitType === "equal") {
    if (!participants.length) return { ok: false, reason: "no_participants" };
    const each = round2(amountBase / participants.length);
    let running = 0;
    participants.forEach((id, i) => {
      // The last participant absorbs the remainder so the total is exact
      // even when the amount doesn't divide evenly.
      const v =
        i === participants.length - 1 ? round2(amountBase - running) : each;
      running = round2(running + v);
      splits[id] = v;
    });
    return { ok: true, splits };
  }

  if (splitType === "exact") {
    if (!participants.length) return { ok: false, reason: "no_participants" };
    participants.forEach((id) => {
      splits[id] = round2(values[id] ?? 0);
    });
    if (Math.abs(sumSplits(splits) - amountBase) > 0.02) {
      return { ok: false, reason: "exact_mismatch" };
    }
    assignRemainder(splits, amountBase, (ids) => ids[0]);
    return { ok: true, splits };
  }

  if (splitType === "percent") {
    if (!participants.length) return { ok: false, reason: "no_participants" };
    const pctSum = participants.reduce((a, id) => a + (values[id] ?? 0), 0);
    if (Math.abs(pctSum - 100) > 0.2) {
      return { ok: false, reason: "percent_mismatch" };
    }
    participants.forEach((id) => {
      splits[id] = round2((amountBase * (values[id] ?? 0)) / 100);
    });
    assignRemainder(splits, amountBase, (ids) => ids[0]);
    return { ok: true, splits };
  }

  if (splitType === "items") {
    const items = input.items ?? [];
    if (!items.length) return { ok: false, reason: "bad_items" };
    // Items are priced in the expense currency, so convert into base.
    const totals = itemsTotals(items, memberIds);
    memberIds.forEach((id) => {
      splits[id] = round2((totals[id] ?? 0) * rate);
    });
    // Fold drift into the largest share.
    const diff = round2(amountBase - sumSplits(splits));
    if (Math.abs(diff) >= 0.005) {
      const target = memberIds.reduce((a, b) =>
        (splits[a] ?? 0) >= (splits[b] ?? 0) ? a : b,
      );
      if (target) splits[target] = round2((splits[target] ?? 0) + diff);
    }
    return { ok: true, splits };
  }

  // shares: each member's weight is a fraction of the total.
  const shareSum = participants.reduce((a, id) => a + (values[id] ?? 1), 0);
  if (shareSum <= 0) {
    return { ok: false, reason: "no_shares" };
  }
  participants.forEach((id) => {
    splits[id] = round2((amountBase * (values[id] ?? 1)) / shareSum);
  });
  assignRemainder(splits, amountBase, (ids) => ids[0]);
  return { ok: true, splits };
}

/**
 * Turns stored shares back into the numbers the `exact` / `percent` inputs
 * expect, so editing an expense pre-fills the form.
 *
 * The database only stores resulting amounts, so `percent` has to be
 * reconstructed by dividing through by the total. Getting this wrong makes the
 * form show "2.05%" for a €30 expense and then fail its own 100% check.
 */
export function splitsToInputValues(
  splits: Record<string, number>,
  amountBase: number,
  splitType: SplitType,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [uid, share] of Object.entries(splits)) {
    if (splitType === "percent" && amountBase > 0) {
      out[uid] = round2(((share ?? 0) / amountBase) * 100);
    } else {
      out[uid] = share ?? 0;
    }
  }
  return out;
}

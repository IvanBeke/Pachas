import { describe, expect, it } from "vitest";
import {
  assignRemainder,
  computeSplits,
  splitsToInputValues,
  sumSplits,
  type SplitInput,
} from "../app/utils/splits";

const A = "a";
const B = "b";
const C = "c";

const base = (over: Partial<SplitInput> = {}): SplitInput => ({
  splitType: "equal",
  amountBase: 10,
  participants: [A, B],
  memberIds: [A, B],
  values: {},
  ...over,
});

/** Every branch must reconcile to the total or the server rejects the row. */
const reconciles = (r: { ok: true; splits: Record<string, number> }, total: number) =>
  Math.abs(sumSplits(r.splits) - total) < 0.005;

describe("equal", () => {
  it("divides evenly", () => {
    const r = computeSplits(base({ amountBase: 10, participants: [A, B] }));
    expect(r).toEqual({ ok: true, splits: { a: 5, b: 5 } });
  });

  it("absorps the remainder on a total that won't divide", () => {
    // €10 across 3 people cannot split evenly. The remainder lands on the last
    // participant so the total stays exact.
    const r = computeSplits(base({ amountBase: 10, participants: [A, B, C], memberIds: [A, B, C] }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.splits).toEqual({ a: 3.33, b: 3.33, c: 3.34 });
    expect(reconciles(r as { ok: true; splits: Record<string, number> }, 10)).toBe(true);
  });

  it("splits only among participants, not all members", () => {
    const r = computeSplits(
      base({ amountBase: 9, participants: [A], memberIds: [A, B, C] }),
    );
    expect(r.ok && r.splits).toEqual({ a: 9 });
  });

  it("refuses an equal split with no participants", () => {
    // Rejecting is safer than dividing by zero and storing an empty split.
    const r = computeSplits(base({ participants: [], memberIds: [A] }));
    expect(r).toEqual({ ok: false, reason: "no_participants" });
  });
});

describe("exact", () => {
  it("uses the amounts the user typed", () => {
    const r = computeSplits(
      base({ splitType: "exact", amountBase: 30, values: { a: 25, b: 5 } }),
    );
    expect(r.ok && r.splits).toEqual({ a: 25, b: 5 });
  });

  it("rejects amounts that miss the total", () => {
    const r = computeSplits(
      base({ splitType: "exact", amountBase: 30, values: { a: 10, b: 5 } }),
    );
    expect(r).toEqual({ ok: false, reason: "exact_mismatch" });
  });

  it("rejects amounts that exceed the total", () => {
    const r = computeSplits(
      base({ splitType: "exact", amountBase: 30, values: { a: 40, b: 5 } }),
    );
    expect(r).toEqual({ ok: false, reason: "exact_mismatch" });
  });

  it("tolerates a cent of drift and folds it back in", () => {
    // Within the 0.02 tolerance, so it is accepted and reconciled.
    const r = computeSplits(
      base({ splitType: "exact", amountBase: 30, values: { a: 25, b: 4.99 } }),
    );
    expect(r.ok).toBe(true);
    expect(reconciles(r as { ok: true; splits: Record<string, number> }, 30)).toBe(true);
  });
});

describe("percent", () => {
  it("converts percentages to amounts", () => {
    const r = computeSplits(
      base({ splitType: "percent", amountBase: 100, values: { a: 70, b: 30 } }),
    );
    expect(r.ok && r.splits).toEqual({ a: 70, b: 30 });
  });

  it("requires the percentages to total 100", () => {
    const r = computeSplits(
      base({ splitType: "percent", amountBase: 100, values: { a: 50, b: 20 } }),
    );
    expect(r).toEqual({ ok: false, reason: "percent_mismatch" });
  });

  it("reconciles thirds that do not divide exactly", () => {
    const r = computeSplits(
      base({ splitType: "percent", amountBase: 10, values: { a: 33.34, b: 33.33, c: 33.33 }, participants: [A, B, C], memberIds: [A, B, C] }),
    );
    expect(r.ok).toBe(true);
    expect(reconciles(r as { ok: true; splits: Record<string, number> }, 10)).toBe(true);
  });
});

describe("shares", () => {
  it("weights each member by their share count", () => {
    // 1 share and 3 shares of €100.
    const r = computeSplits(
      base({ splitType: "shares", amountBase: 100, values: { a: 1, b: 3 } }),
    );
    expect(r.ok && r.splits).toEqual({ a: 25, b: 75 });
  });

  it("defaults a missing weight to one share", () => {
    const r = computeSplits(base({ splitType: "shares", amountBase: 10, values: { a: 1 } }));
    expect(r.ok && r.splits).toEqual({ a: 5, b: 5 });
  });

  it("rejects a zero total weight", () => {
    const r = computeSplits(
      base({ splitType: "shares", amountBase: 10, values: { a: 0, b: 0 } }),
    );
    expect(r).toEqual({ ok: false, reason: "no_shares" });
  });
});

describe("items", () => {
  const items = [
    { name: "Ramen", price: 20, members: [A, B] },
    { name: "Gyoza", price: 6, members: [B] },
  ];

  it("gives each member only the items they were assigned", () => {
    const r = computeSplits(
      base({ splitType: "items", amountBase: 26, items, memberIds: [A, B] }),
    );
    expect(r.ok && r.splits).toEqual({ a: 10, b: 16 });
  });

  it("assigns a zero share to members in no item", () => {
    const r = computeSplits(
      base({ splitType: "items", amountBase: 26, items, memberIds: [A, B, C] }),
    );
    expect(r.ok && r.splits.c).toBe(0);
  });

  it("applies the exchange rate to convert into base currency", () => {
    // €26 of items recorded at a rate of 2 => base amount 52.
    const r = computeSplits(
      base({ splitType: "items", amountBase: 52, rate: 2, items, memberIds: [A, B] }),
    );
    expect(r.ok && r.splits).toEqual({ a: 20, b: 32 });
    expect(reconciles(r as { ok: true; splits: Record<string, number> }, 52)).toBe(true);
  });

  it("still reconciles when rounding leaves drift", () => {
    const odd = [
      { name: "x", price: 10, members: [A, B, C] },
      { name: "y", price: 0.01, members: [A] },
    ];
    const r = computeSplits(
      base({ splitType: "items", amountBase: 10.01, items: odd, memberIds: [A, B, C] }),
    );
    expect(r.ok).toBe(true);
    expect(reconciles(r as { ok: true; splits: Record<string, number> }, 10.01)).toBe(true);
  });
});

describe("every split type reconciles to the total", () => {
  const cases: SplitInput[] = [
    base({ splitType: "equal", amountBase: 10, participants: [A, B, C], memberIds: [A, B, C] }),
    base({ splitType: "equal", amountBase: 0.03, participants: [A, B, C], memberIds: [A, B, C] }),
    base({ splitType: "exact", amountBase: 99.99, values: { a: 50, b: 49.99 } }),
    base({ splitType: "percent", amountBase: 77.77, values: { a: 50, b: 50 } }),
    base({ splitType: "shares", amountBase: 7.77, values: { a: 1, b: 2, c: 3 }, participants: [A, B, C], memberIds: [A, B, C] }),
    base({ splitType: "items", amountBase: 26, items: [{ name: "r", price: 26, members: [A, B, C] }], memberIds: [A, B, C] }),
  ];

  it.each(cases.map((c, i) => [i, c] as const))(
    "case %i produces shares summing to the total",
    (i, input) => {
      const r = computeSplits(input);
      expect(r.ok, `case ${i} unexpectedly failed`).toBe(true);
      if (!r.ok) return;
      expect(sumSplits(r.splits)).toBeCloseTo(input.amountBase, 2);
      for (const v of Object.values(r.splits)) {
        expect(Number.isFinite(v)).toBe(true);
      }
    },
  );
});

describe("assignRemainder", () => {
  it("is a no-op when the shares already add up", () => {
    const s = { a: 5, b: 5 };
    assignRemainder(s, 10, (ids) => ids[0]);
    expect(s).toEqual({ a: 5, b: 5 });
  });

  it("folds drift into the chosen participant", () => {
    const s = { a: 3.33, b: 3.33 };
    assignRemainder(s, 10, (ids) => ids[0]);
    expect(s.a).toBe(6.67);
    expect(sumSplits(s)).toBe(10);
  });

  it("can subtract as well as add", () => {
    const s = { a: 5, b: 5 };
    assignRemainder(s, 9.5, (ids) => ids[1]);
    expect(s.b).toBe(4.5);
  });

  it("does nothing when there is nobody to absorb it", () => {
    const s = {};
    assignRemainder(s, 10, () => undefined);
    expect(s).toEqual({});
  });
});

describe("splitsToInputValues (edit pre-fill)", () => {
  it("returns amounts unchanged for exact", () => {
    expect(splitsToInputValues({ a: 25, b: 5 }, 30, "exact")).toEqual({ a: 25, b: 5 });
  });

  it("converts stored amounts back into percentages", () => {
    // The regression that shipped once: a 50/50 split of €30 is stored as
    // 15/15, and pasting those straight into the percent inputs would show
    // "15%" — summing to 30 and failing the form's own 100% check.
    expect(splitsToInputValues({ a: 15, b: 15 }, 30, "percent")).toEqual({
      a: 50,
      b: 50,
    });
  });

  it("makes the reconstructed percentages total 100", () => {
    const splits = { a: 32.83, b: 32.82 };
    const pct = splitsToInputValues(splits, 65.65, "percent");
    const sum = Object.values(pct).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it("survives a zero total without producing NaN", () => {
    const pct = splitsToInputValues({ a: 0, b: 0 }, 0, "percent");
    for (const v of Object.values(pct)) expect(Number.isFinite(v)).toBe(true);
  });

  it("round-trips a percent split back to the same amounts", () => {
    const original = { a: 32.83, b: 32.82 };
    const pct = splitsToInputValues(original, 65.65, "percent");
    const rebuilt = computeSplits({
      splitType: "percent",
      amountBase: 65.65,
      participants: [A, B],
      memberIds: [A, B],
      values: pct,
    });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.splits.a).toBeCloseTo(original.a, 1);
    expect(rebuilt.splits.b).toBeCloseTo(original.b, 1);
  });
});

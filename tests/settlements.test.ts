import { describe, expect, it } from "vitest";
import {
  pairwiseTransfers,
  simplifyDebts,
  type Balance,
} from "../server/utils/groups";

/** Convenience: creditors positive, debtors negative, as stored. */
function bal(...amounts: number[]): Balance[] {
  return amounts.map((amount, i) => ({ memberId: `m${i}`, amount }));
}

/** Every member's balance after applying the transfers. */
function residual(balances: Balance[], transfers: { from: string; to: string; amount: number }[]) {
  const left: Record<string, number> = {};
  for (const b of balances) left[b.memberId] = b.amount;
  for (const t of transfers) {
    left[t.from] = (left[t.from] ?? 0) + t.amount;
    left[t.to] = (left[t.to] ?? 0) - t.amount;
  }
  return Object.fromEntries(
    Object.entries(left).map(([k, v]) => [k, Math.round(v * 100) / 100]),
  );
}

const key = (t: { from: string; to: string; amount: number }) =>
  `${t.from}->${t.to}:${t.amount}`;

describe("simplifyDebts (greedy, the default)", () => {
  it("returns nothing when everyone is settled", () => {
    expect(simplifyDebts(bal(0, 0))).toEqual([]);
  });

  it("nets a single debt into one transfer", () => {
    expect(simplifyDebts(bal(-20.26, 20.26))).toEqual([
      { from: "m0", to: "m1", amount: 20.26 },
    ]);
  });

  it("ignores sub-cent noise instead of emitting €0.00 transfers", () => {
    // 0.004 rounds to 0.00 and must be treated as settled.
    expect(simplifyDebts(bal(-0.004, 0.004))).toEqual([]);
  });

  it("collapses a 3-way cycle into the minimum 2 transfers", () => {
    // 1 creditor owed 60, split across 2 debtors of 25 and 35.
    const balances = bal(60, -25, -35);
    const t = simplifyDebts(balances);
    expect(t).toHaveLength(2);
    expect(t).toEqual([
      { from: "m2", to: "m0", amount: 35 },
      { from: "m1", to: "m0", amount: 25 },
    ]);
    expect(residual(balances, t)).toEqual({ m0: 0, m1: 0, m2: 0 });
  });

  it("never emits more than n-1 transfers", () => {
    // 5 creditors / 5 debtors: the theoretical minimum is 9, not 25.
    const balances = bal(50, 40, 30, 20, 10, -50, -40, -30, -20, -10);
    const t = simplifyDebts(balances);
    expect(t.length).toBeLessThanOrEqual(9);
    expect(residual(balances, t)).toEqual(
      Object.fromEntries(balances.map((b) => [b.memberId, 0])),
    );
  });

  it("preserves the total: transfers sum to the total debt", () => {
    const balances = bal(90, 60, -100, -50);
    const t = simplifyDebts(balances);
    const totalOwed = balances.filter((b) => b.amount > 0).reduce((a, b) => a + b.amount, 0);
    expect(t.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(totalOwed, 2);
  });

  it("matches pairwiseTransfers on small ledgers, but see the property suite", () => {
    // With only a few members on each side the two often coincide. That stops
    // being true as the group grows — tests/settlement-properties.test.ts
    // generates 7-user ledgers where the pairings clearly diverge.
    const cases = [
      bal(90, 60, -100, -50),
      bal(40, 30, 20, -35, -30, -25),
      bal(100, 10, -60, -50),
    ];
    for (const balances of cases) {
      expect(simplifyDebts(balances).map(key)).toEqual(
        pairwiseTransfers(balances).map(key),
      );
    }
  });
});

describe("pairwiseTransfers (simplify off)", () => {
  it("settles every debtor against the creditors", () => {
    const balances = bal(90, 60, -100, -50);
    const t = pairwiseTransfers(balances);
    expect(residual(balances, t)).toEqual({ m0: 0, m1: 0, m2: 0, m3: 0 });
  });

  it("splits one debt across two creditors", () => {
    // m0 owes 100; m1 is owed 60, m2 40.
    const t = pairwiseTransfers(bal(-100, 60, 40));
    expect(t).toEqual([
      { from: "m0", to: "m1", amount: 60 },
      { from: "m0", to: "m2", amount: 40 },
    ]);
  });

  it("returns nothing when everyone is settled", () => {
    expect(pairwiseTransfers(bal(0, 0, 0))).toEqual([]);
  });

  it("rounds to cents and never leaves a residual", () => {
    const balances = bal(0.1, 0.2, -0.1, -0.2);
    const t = pairwiseTransfers(balances);
    for (const x of t) {
      expect(Math.round(x.amount * 100) / 100).toBe(x.amount);
    }
    expect(residual(balances, t)).toEqual({ m0: 0, m1: 0, m2: 0, m3: 0 });
  });
});

describe("both modes agree on the outcome", () => {
  const cases = [
    bal(20.26, -20.26),
    bal(90, 60, -100, -50),
    bal(40, 30, 20, -35, -30, -25),
    bal(-10, -20, -30, 25, 20, 15),
    bal(100, 100, -100, -100),
  ];

  it.each(cases.map((c, i) => [i, c] as const))(
    "case %i fully settles to zero under both algorithms",
    (_i, balances) => {
      const zero = Object.fromEntries(balances.map((b) => [b.memberId, 0]));
      expect(residual(balances, simplifyDebts(balances))).toEqual(zero);
      expect(residual(balances, pairwiseTransfers(balances))).toEqual(zero);
    },
  );
});

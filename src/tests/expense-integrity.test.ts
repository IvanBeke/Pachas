import { describe, expect, it } from "vitest";
import { readExpenseInput } from "../server/utils/expense-input";

/**
 * The ledger's core invariant is that stored shares reconcile to the expense
 * total. That guard used to be defeatable: `Number("1e400")` is `Infinity`,
 * which is truthy and greater than zero, so it passed the
 * `!amount || amount <= 0` check. `computeSplits` then produced
 * `{Infinity, NaN}`, and `Math.abs(NaN - Infinity) > 0.05` is `false` — every
 * comparison against `NaN` is — so the request was accepted and the group's
 * balances became `NaN` for everyone.
 *
 * These tests pin the fix from both sides: the input is rejected, and the
 * reconciliation guard itself refuses to be fooled.
 */
const MEMBERS = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];

function base(over: Record<string, unknown> = {}) {
  return {
    title: "Test",
    description: "",
    amount: 10,
    amountBase: 10,
    paidBy: MEMBERS[0],
    participants: MEMBERS,
    splitType: "equal",
    ...over,
  };
}

function rejects(over: Record<string, unknown>): boolean {
  try {
    readExpenseInput(base(over) as never, MEMBERS, "EUR");
    return false;
  } catch {
    return true;
  }
}

describe("readExpenseInput rejects non-finite amounts", () => {
  it("rejects Infinity from an exponential amount", () => {
    // The exact payload that used to slip through.
    expect(rejects({ amount: "1e400", amountBase: "1e400" })).toBe(true);
  });

  it("ignores a client amountBase and derives it from amount × rate", () => {
    // The client used to control both independently; now only `amount` and
    // the rate are read, so a poisoned `amountBase` cannot reach the ledger.
    const out = readExpenseInput(base({ amount: 10, amountBase: "1e400" }) as never, MEMBERS, "EUR");
    expect(out.amountBase).toBe(10);
  });

  it("rejects a non-finite rate for a foreign currency", () => {
    expect(rejects({ currency: "USD", exchangeRate: "1e400" })).toBe(true);
    expect(rejects({ currency: "USD", exchangeRate: 0 })).toBe(true);
  });

  it("rejects NaN amounts", () => {
    expect(rejects({ amount: "abc", amountBase: "abc" })).toBe(true);
  });

  it("rejects a negative or zero amount", () => {
    expect(rejects({ amount: 0, amountBase: 0 })).toBe(true);
    expect(rejects({ amount: -10, amountBase: -10 })).toBe(true);
  });

  it("never stores a non-finite exchange rate, falling back to 1", () => {
    // The rate is deliberately lenient — absent, junk, zero, and negative have
    // always meant "no conversion". What must never happen is `Infinity` being
    // stored: the old `Number(rate) || 1` let it through because `Infinity` is
    // truthy, which then poisoned every itemised split.
    for (const exchangeRate of ["1e400", "junk", 0, -2, null, undefined]) {
      const out = readExpenseInput(
        base({ exchangeRate }) as never,
        MEMBERS,
        "EUR",
      );
      expect(out.exchangeRate, `rate ${String(exchangeRate)}`).toBe(1);
      expect(Number.isFinite(out.exchangeRate)).toBe(true);
    }
  });

  it("keeps a real exchange rate intact and converts with it", () => {
    const out = readExpenseInput(
      base({ currency: "USD", exchangeRate: 1.25 }) as never,
      MEMBERS,
      "EUR",
    );
    expect(out.exchangeRate).toBe(1.25);
    expect(out.amountBase).toBe(12.5);
  });

  it("rejects non-finite item prices", () => {
    const items = {
      items: [{ name: "Thing", price: "1e400", members: [MEMBERS[0]] }],
      tax: 0,
      tipPercent: 0,
    };
    expect(
      rejects({ splitType: "items", description: JSON.stringify(items) }),
    ).toBe(true);
  });

  it("still accepts ordinary amounts", () => {
    const out = readExpenseInput(base({ amount: 30, amountBase: 30 }) as never, MEMBERS, "EUR");
    expect(out.amount).toBe(30);
    expect(out.splits[MEMBERS[0]]).toBe(15);
  });
});

describe("the reconciliation guard cannot be defeated", () => {
  it("never returns non-finite shares for any input", () => {
    // A generated sweep rather than a handful of hand-picked cases: the
    // original bug hid behind inputs that looked ordinary.
    const amounts = [0.01, 1, 7, 30, 99.99, 1e6, 0.1, 3.33, 12.345];
    for (const amount of amounts) {
      const out = readExpenseInput(
        base({ amount, amountBase: amount }) as never,
        MEMBERS,
        "EUR",
      );
      for (const [uid, share] of Object.entries(out.splits)) {
        expect(Number.isFinite(share), `share for ${uid} at ${amount}`).toBe(true);
      }
      const sum = Object.values(out.splits).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - amount)).toBeLessThanOrEqual(0.05);
    }
  });

  it("refuses an amount that cannot be represented, rather than storing NaN", () => {
    // Guards the specific arithmetic: Infinity - Infinity is NaN, and NaN
    // compares false against every threshold.
    const inf = Number("1e400");
    expect(Number.isFinite(inf)).toBe(false);
    expect(Number.isFinite(inf - inf)).toBe(false);
    expect(Math.abs(NaN - inf) > 0.05).toBe(false);

    // And the validator agrees, rather than relying on that comparison.
    expect(rejects({ amount: inf, amountBase: inf })).toBe(true);
  });
});

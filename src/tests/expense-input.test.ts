import { describe, expect, it } from "vitest";
import { readExpenseInput } from "../server/utils/expense-input";
import { computeSplits, sumSplits } from "../shared/splits";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";
const MEMBERS = [A, B];

/**
 * The client sends a SELECTION — split type, who takes part, and their input
 * values. It never sends the final amounts; the server computes them.
 */
const body = (over: Record<string, unknown> = {}) => ({
  title: "Dinner",
  amount: 10,
  amountBase: 10,
  paidBy: A,
  date: "2026-09-26",
  splitType: "equal",
  participants: [A, B],
  ...over,
});

const err = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a throw");
};

describe("the server computes the splits, it does not accept them", () => {
  it("derives an equal split from the participant list alone", () => {
    const out = readExpenseInput(body(), MEMBERS, "EUR");
    expect(out.splits).toEqual({ [A]: 5, [B]: 5 });
  });

  it("ignores any client-supplied splits and recomputes", () => {
    // A tampered client sending bogus amounts must not be believed.
    const out = readExpenseInput(
      body({ splits: { [A]: 10, [B]: 0 } }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits).toEqual({ [A]: 5, [B]: 5 });
  });

  it("ignores a forged split for a non-member", () => {
    const out = readExpenseInput(
      body({ splits: { [A]: 10, [B]: 0, ghost: -50 } }),
      MEMBERS,
      "EUR",
    );
    expect(Object.keys(out.splits).sort()).toEqual([A, B].sort());
    expect(sumSplits(out.splits)).toBe(10);
  });

  it("computes an exact split from the entered amounts", () => {
    const out = readExpenseInput(
      body({ splitType: "exact", participants: [A, B], values: { [A]: 7, [B]: 3 } }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits).toEqual({ [A]: 7, [B]: 3 });
  });

  it("computes a percent split from the entered percentages", () => {
    const out = readExpenseInput(
      body({
        splitType: "percent",
        amount: 100,
        amountBase: 100,
        values: { [A]: 70, [B]: 30 },
      }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits).toEqual({ [A]: 70, [B]: 30 });
  });

  it("computes a shares split from the entered weights", () => {
    const out = readExpenseInput(
      body({ splitType: "shares", values: { [A]: 1, [B]: 3 } }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits).toEqual({ [A]: 2.5, [B]: 7.5 });
  });

  it("computes an items split from the submitted bill", () => {
    const items = [
      { name: "Ramen", price: 20, members: [A, B] },
      { name: "Gyoza", price: 6, members: [B] },
    ];
    const out = readExpenseInput(
      body({
        splitType: "items",
        amount: 26,
        amountBase: 26,
        items,
        participants: [A, B],
        description: JSON.stringify({ items, tax: 0, tipPercent: 0 }),
      }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits).toEqual({ [A]: 10, [B]: 16 });
  });

  it("splits from the stored bill, ignoring a separate items field", () => {
    // The stored description is the bill. A different `items` array in the
    // body used to drive the split, so stored bill and shares could disagree.
    const bill = [{ name: "Ramen", price: 26, members: [A] }];
    const out = readExpenseInput(
      body({
        splitType: "items",
        amount: 26,
        items: [{ name: "Ramen", price: 26, members: [B] }],
        description: JSON.stringify({ items: bill, tax: 0, tipPercent: 0 }),
      }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits[A]).toBe(26);
    expect(out.splits[B]).toBe(0);
  });

  it("recomputes identically to the client preview", () => {
    // The client previews with the same shared code, so what the user saw is
    // what gets stored. This is the guarantee the shared/ module exists for.
    const input = {
      splitType: "percent" as const,
      amountBase: 65.65,
      participants: [A, B],
      memberIds: [...MEMBERS],
      values: { [A]: 50, [B]: 50 },
    };
    const preview = computeSplits(input);
    expect(preview.ok).toBe(true);
    const stored = readExpenseInput(
      body({
        splitType: "percent",
        amount: 65.65,
        amountBase: 65.65,
        values: input.values,
      }),
      MEMBERS,
      "EUR",
    );
    expect(stored.splits).toEqual(preview.ok ? preview.splits : {});
  });
});

describe("required fields", () => {
  it("accepts a minimal valid payload", () => {
    const out = readExpenseInput(body(), MEMBERS, "EUR");
    expect(out.title).toBe("Dinner");
    expect(out.amount).toBe(10);
    expect(out.splitType).toBe("equal");
  });

  it("rejects a blank title", () => {
    expect(err(() => readExpenseInput(body({ title: "   " }), MEMBERS, "EUR"))).toBe(
      "A title is required.",
    );
  });

  it("rejects a zero or negative amount", () => {
    expect(err(() => readExpenseInput(body({ amount: 0 }), MEMBERS, "EUR"))).toContain(
      "greater than zero",
    );
    expect(err(() => readExpenseInput(body({ amount: -5 }), MEMBERS, "EUR"))).toContain(
      "greater than zero",
    );
  });

  it("rejects an amount that converts to less than a cent", () => {
    expect(
      err(() =>
        readExpenseInput(body({ currency: "JPY", exchangeRate: 0.001, amount: 1 }), MEMBERS, "EUR"),
      ),
    ).toContain("Invalid converted amount");
  });

  it("rejects an unknown split type instead of storing it", () => {
    expect(err(() => readExpenseInput(body({ splitType: "foo" }), MEMBERS, "EUR"))).toContain(
      "Unknown split type",
    );
  });

  it("rejects a payer who is not a group member", () => {
    expect(
      err(() => readExpenseInput(body({ paidBy: "not-a-member" }), MEMBERS, "EUR")),
    ).toContain("Payer must be a group member");
  });

  it("rejects an empty participant list", () => {
    expect(
      err(() => readExpenseInput(body({ participants: [] }), MEMBERS, "EUR")),
    ).toBe("At least one participant is required.");
  });

  it("rejects a missing participant list", () => {
    expect(
      err(() => readExpenseInput({ ...body(), participants: undefined }, MEMBERS, "EUR")),
    ).toBe("At least one participant is required.");
  });

  it("drops participants who are not group members", () => {
    // If the only remaining valid participant is none, it must reject.
    expect(
      err(() =>
        readExpenseInput(body({ participants: ["ghost"] }), MEMBERS, "EUR"),
      ),
    ).toBe("At least one participant is required.");
  });
});

describe("split validation happens server-side", () => {
  it("rejects exact amounts that miss the total", () => {
    expect(
      err(() =>
        readExpenseInput(
          body({ splitType: "exact", values: { [A]: 5, [B]: 1 } }),
          MEMBERS,
          "EUR",
        ),
      ),
    ).toBe("Exact amounts must add up to the total.");
  });

  it("rejects exact amounts that exceed the total", () => {
    expect(
      err(() =>
        readExpenseInput(
          body({ splitType: "exact", values: { [A]: 50, [B]: 50 } }),
          MEMBERS,
          "EUR",
        ),
      ),
    ).toBe("Exact amounts must add up to the total.");
  });

  it("rejects percentages that do not total 100", () => {
    expect(
      err(() =>
        readExpenseInput(
          body({ splitType: "percent", values: { [A]: 50, [B]: 20 } }),
          MEMBERS,
          "EUR",
        ),
      ),
    ).toBe("Percentages must add up to 100.");
  });

  it("rejects a shares selection with no weight", () => {
    expect(
      err(() =>
        readExpenseInput(
          body({ splitType: "shares", values: { [A]: 0, [B]: 0 } }),
          MEMBERS,
          "EUR",
        ),
      ),
    ).toBe("Shares must add up to more than zero.");
  });

  it("rejects an items selection with no items", () => {
    // The description must also carry the items JSON; the server validates
    // both the submitted bill and the stored description.
    expect(
      err(() =>
        readExpenseInput(
          body({
            splitType: "items",
            items: [],
            description: JSON.stringify({ items: [], tax: 0, tipPercent: 0 }),
          }),
          MEMBERS,
          "EUR",
        ),
      ),
    ).toBe("At least one item is required.");
  });

  it("rejects items mode when the description is not items JSON", () => {
    expect(
      err(() =>
        readExpenseInput(
          body({
            splitType: "items",
            items: [{ name: "x", price: 10, members: [A] }],
            description: "just text",
            amount: 10,
            amountBase: 10,
          }),
          MEMBERS,
          "EUR",
        ),
      ),
    ).toBe("Invalid items payload.");
  });

  it("ignores value entries for non-members", () => {
    const out = readExpenseInput(
      body({ splitType: "shares", values: { [A]: 1, [B]: 1, ghost: 99 } }),
      MEMBERS,
      "EUR",
    );
    expect(out.splits).toEqual({ [A]: 5, [B]: 5 });
  });
});

describe("normalisation", () => {
  it("uppercases the currency code and rejects anything that isn't ISO 4217-shaped", () => {
    expect(
      readExpenseInput(body({ currency: "usd", exchangeRate: 1 }), MEMBERS, "EUR").currency,
    ).toBe("USD");
    expect(err(() => readExpenseInput(body({ currency: "dollars" }), MEMBERS, "EUR"))).toContain(
      "Currency",
    );
  });

  it("falls back to the group currency when none is given", () => {
    expect(readExpenseInput(body(), MEMBERS, "GBP").currency).toBe("GBP");
  });

  it("defaults a missing exchange rate to 1", () => {
    expect(readExpenseInput(body({ exchangeRate: "junk" }), MEMBERS, "EUR").exchangeRate).toBe(1);
  });

  it("substitutes today for a malformed date", () => {
    const out = readExpenseInput(body({ date: "not-a-date" }), MEMBERS, "EUR");
    expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("truncates a long title to 80 characters", () => {
    expect(readExpenseInput(body({ title: "x".repeat(200) }), MEMBERS, "EUR").title).toHaveLength(80);
  });

  it("truncates a plain description to 500 characters", () => {
    expect(
      readExpenseInput(body({ description: "y".repeat(2000) }), MEMBERS, "EUR").description,
    ).toHaveLength(500);
  });

  it("defaults the category to general", () => {
    expect(readExpenseInput(body(), MEMBERS, "EUR").category).toBe("general");
  });

  it("always produces splits summing to amountBase", () => {
    for (const type of ["equal", "exact", "percent", "shares"]) {
      const values: Record<string, number> =
        type === "exact" ? { [A]: 4, [B]: 6 }
        : type === "percent" ? { [A]: 40, [B]: 60 }
        : type === "shares" ? { [A]: 1, [B]: 3 }
        : {};
      const out = readExpenseInput(body({ splitType: type, values }), MEMBERS, "EUR");
      expect(
        Math.abs(sumSplits(out.splits) - out.amountBase),
        `${type} did not reconcile`,
      ).toBeLessThan(0.005);
    }
  });
});

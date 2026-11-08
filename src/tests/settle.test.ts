import { describe, expect, it } from "vitest";
import { feedItems, transferKey, visibleTransfers } from "../app/utils/settle";
import type { Expense, Settlement } from "../app/utils/format";

const transfers = [
  { from: "ben", to: "ana", amount: 10 },
  { from: "carla", to: "ben", amount: 5 },
  { from: "carla", to: "ana", amount: 2 },
];

describe("visibleTransfers", () => {
  it("shows everything to creators and admins", () => {
    expect(visibleTransfers(transfers, "dave", true)).toEqual(transfers);
  });

  it("shows members the payments they owe or are owed", () => {
    expect(visibleTransfers(transfers, "ben", false)).toEqual([transfers[0], transfers[1]]);
    expect(visibleTransfers(transfers, "ana", false)).toEqual([transfers[0], transfers[2]]);
  });

  it("hides payments between other people", () => {
    expect(visibleTransfers(transfers, "dave", false)).toEqual([]);
  });
});

describe("transferKey", () => {
  it("identifies a pair by direction", () => {
    expect(transferKey({ from: "a", to: "b" })).toBe("a:b");
    expect(transferKey({ from: "b", to: "a" })).not.toBe(transferKey({ from: "a", to: "b" }));
  });
});

describe("feedItems", () => {
  const expense = (id: string, date: string, createdAt: number) =>
    ({ id, date, createdAt }) as unknown as Expense;
  const settlement = (id: string, createdAt: number) =>
    ({ id, createdAt }) as unknown as Settlement;
  const ids = (items: ReturnType<typeof feedItems>) =>
    items.map((i) => (i.kind === "expense" ? i.expense.id : i.settlement.id));

  it("puts a payment under the day it was recorded, newest first", () => {
    const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
    const items = feedItems(
      [expense("e-new", "2026-11-05", day("2026-11-05")), expense("e-old", "2026-11-01", day("2026-11-01"))],
      [settlement("s", day("2026-11-03"))],
    );
    expect(ids(items)).toEqual(["e-new", "s", "e-old"]);
    expect(items[1]!.date).toBe("2026-11-03");
  });

  it("orders items of the same day by creation time", () => {
    const base = Date.parse("2026-11-05T08:00:00Z");
    const items = feedItems(
      [expense("e1", "2026-11-05", base), expense("e2", "2026-11-05", base + 2000)],
      [settlement("s", base + 1000)],
    );
    expect(ids(items)).toEqual(["e2", "s", "e1"]);
  });

  it("works with no payments", () => {
    expect(feedItems([expense("e", "2026-11-05", 1)], [])).toHaveLength(1);
    expect(feedItems([], [])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  balancesAfter,
  canRecordPayment,
  feedItems,
  payerOptions,
  receiverOptions,
  transferKey,
  visibleTransfers,
  type PaymentContext,
} from "../app/utils/settle";
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

describe("canRecordPayment", () => {
  it("lets elevated members record any pair of different people", () => {
    expect(canRecordPayment("a", "b", "dave", true)).toBe(true);
    expect(canRecordPayment("a", "a", "dave", true)).toBe(false);
  });

  it("lets members record only payments they make or receive", () => {
    expect(canRecordPayment("dave", "b", "dave", false)).toBe(true);
    expect(canRecordPayment("a", "dave", "dave", false)).toBe(true);
    expect(canRecordPayment("a", "b", "dave", false)).toBe(false);
  });
});

describe("payer and receiver options", () => {
  // ana is owed 30; ben and carla owe her 22.75 and 7.25.
  const ctx = (meId: string, isElevated: boolean): PaymentContext => ({
    memberIds: ["ana", "ben", "carla"],
    balances: [
      { memberId: "ana", amount: 30 },
      { memberId: "ben", amount: -22.75 },
      { memberId: "carla", amount: -7.25 },
    ],
    transfers: [
      { from: "ben", to: "ana", amount: 22.75 },
      { from: "carla", to: "ana", amount: 7.25 },
    ],
    meId,
    isElevated,
  });

  it("offers everyone who owes as payer to an elevated member, and only people who are owed as receiver", () => {
    expect(payerOptions(ctx("ana", true))).toEqual(["ben", "carla"]);
    expect(receiverOptions(ctx("ana", true), "ben")).toEqual(["ana"]);
    expect(receiverOptions(ctx("ana", true), "ana")).toEqual([]);
  });

  it("offers a member only themselves, or payers they could receive from", () => {
    expect(payerOptions(ctx("carla", false))).toEqual(["carla"]);
    expect(payerOptions(ctx("ana", false))).toEqual(["ben", "carla"]);
    expect(receiverOptions(ctx("carla", false), "carla")).toEqual(["ana"]);
  });

  it("offers a member who is not involved nothing", () => {
    expect(receiverOptions(ctx("carla", false), "ben")).toEqual([]);
  });
});

describe("balancesAfter", () => {
  const balances = [
    { memberId: "ana", amount: 30 },
    { memberId: "ben", amount: -22.75 },
  ];

  it("moves exactly the amount from the receiver's balance to the payer's", () => {
    expect(balancesAfter(balances, "ben", "ana", 5)).toEqual([
      { id: "ben", before: -22.75, after: -17.75 },
      { id: "ana", before: 30, after: 25 },
    ]);
  });

  it("goes past zero on an over-payment and treats a missing member as settled", () => {
    expect(balancesAfter(balances, "ben", "ana", 30)[0]!.after).toBe(7.25);
    expect(balancesAfter(balances, "carla", "ana", 1)[0]).toEqual({ id: "carla", before: 0, after: 1 });
  });

  it("is exact in cents", () => {
    expect(balancesAfter([{ memberId: "a", amount: 0.3 }], "b", "a", 0.1 + 0.2)[1]!.after).toBe(0);
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

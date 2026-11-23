import { describe, expect, it } from "vitest";
import { maxPaymentCents, owesMoney } from "../shared/payment-rules";

const balances = [
  { memberId: "ana", amount: 30 },
  { memberId: "ben", amount: -22.75 },
  { memberId: "carla", amount: -7.25 },
];

describe("maxPaymentCents", () => {
  it("is what the receiver is owed", () => {
    expect(maxPaymentCents(balances, [], "ben", "ana")).toBe(3000);
  });

  it("is zero for a receiver who is settled or owes", () => {
    expect(maxPaymentCents(balances, [], "ana", "ben")).toBe(0);
    expect(maxPaymentCents(balances, [], "ana", "carla")).toBe(0);
    expect(maxPaymentCents(balances, [], "ana", "nobody")).toBe(0);
  });

  it("allows the suggested payment even to a net debtor (pairwise mode)", () => {
    const transfers = [{ from: "ben", to: "carla", amount: 12.75 }];
    expect(maxPaymentCents(balances, transfers, "ben", "carla")).toBe(1275);
    expect(maxPaymentCents(balances, transfers, "ana", "carla")).toBe(0);
  });

  it("takes the larger of the two", () => {
    const transfers = [{ from: "ben", to: "ana", amount: 40 }];
    expect(maxPaymentCents(balances, transfers, "ben", "ana")).toBe(4000);
  });
});

describe("owesMoney", () => {
  it("is true for a net debtor", () => {
    expect(owesMoney(balances, [], "ben")).toBe(true);
    expect(owesMoney(balances, [], "carla")).toBe(true);
  });

  it("is false for a net creditor, a settled or an unknown member", () => {
    expect(owesMoney(balances, [], "ana")).toBe(false);
    expect(owesMoney([{ memberId: "dan", amount: 0 }], [], "dan")).toBe(false);
    expect(owesMoney(balances, [], "nobody")).toBe(false);
  });

  it("is true for someone with a suggested payment, even a net creditor", () => {
    expect(owesMoney(balances, [{ from: "ana", to: "carla", amount: 2 }], "ana")).toBe(true);
  });
});

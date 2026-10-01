import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  balancesFromPairwiseDebts,
  buildPairwiseDebts,
  suggestPairwiseTransfers,
  suggestSimplifiedTransfers,
} from "../server/utils/settlement-ledger";

const expense = (paidBy: string, splits: Record<string, number>) => ({ paidBy, splits });

describe("pairwise settlement ledger", () => {
  it("derives debts to each expense payer and nets reciprocal amounts", () => {
    const debts = buildPairwiseDebts(
      [
        expense("a", { a: 10, b: 20 }),
        expense("b", { a: 15, b: 5 }),
      ],
      [],
    );
    expect(debts).toEqual([{ debtorId: "b", creditorId: "a", amount: 5 }]);
    expect(balancesFromPairwiseDebts(debts)).toEqual([
      { memberId: "a", amount: 5 },
      { memberId: "b", amount: -5 },
    ]);
  });

  it("suggests one payment per outstanding pair, not an arbitrary debtor-creditor match", () => {
    const debts = buildPairwiseDebts(
      [expense("a", { a: 0, b: 10 }), expense("b", { b: 0, c: 10 })],
      [],
    );
    expect(suggestPairwiseTransfers(debts)).toEqual([
      { from: "b", to: "a", amount: 10 },
      { from: "c", to: "b", amount: 10 },
    ]);
  });

  it("nets an intermediary out in simplified mode and allocates that payment across the debt path", () => {
    const debts = buildPairwiseDebts(
      [expense("a", { a: 0, b: 10 }), expense("b", { b: 0, c: 10 })],
      [],
    );
    const suggestions = suggestSimplifiedTransfers(debts);
    expect(suggestions).toEqual([{ from: "c", to: "a", amount: 10 }]);

    const allocation = allocatePayment(debts, "c", "a", 10);
    expect(allocation).toEqual({
      debts: [],
      allocations: [
        { debtorId: "b", creditorId: "a", amount: 10 },
        { debtorId: "c", creditorId: "b", amount: 10 },
      ],
    });
    // A path allocation records each debt edge cleared; two $10 edges can be
    // cleared by one $10 cash transfer, so edge amounts do not sum to cash.
    expect(allocation?.allocations.reduce((sum, row) => sum + row.amount, 0)).toBe(20);
  });

  it("nets reciprocal obligations and settlement allocations correctly", () => {
    const expenses = [
      expense("a", { a: 0, b: 10 }),
      expense("b", { b: 0, a: 4 }),
    ];
    const before = buildPairwiseDebts(expenses, []);
    expect(before).toEqual([{ debtorId: "b", creditorId: "a", amount: 6 }]);
    const after = buildPairwiseDebts(expenses, [
      { debtorId: "b", creditorId: "a", amount: 3 },
    ]);
    expect(after).toEqual([{ debtorId: "b", creditorId: "a", amount: 3 }]);
  });

  it("preserves a genuine zero-net cycle in pairwise mode", () => {
    const debts = buildPairwiseDebts(
      [
        expense("a", { a: 0, b: 5 }),
        expense("b", { b: 0, c: 5 }),
        expense("c", { c: 0, a: 5 }),
      ],
      [],
    );
    expect(balancesFromPairwiseDebts(debts)).toEqual([
      { memberId: "a", amount: 0 },
      { memberId: "b", amount: 0 },
      { memberId: "c", amount: 0 },
    ]);
    expect(suggestPairwiseTransfers(debts)).toHaveLength(3);
    expect(suggestSimplifiedTransfers(debts)).toEqual([]);
  });

  it("uses deterministic paths and rejects an unrouteable payment", () => {
    const debts = [
      { debtorId: "a", creditorId: "c", amount: 4 },
      { debtorId: "a", creditorId: "b", amount: 4 },
      { debtorId: "b", creditorId: "d", amount: 4 },
      { debtorId: "c", creditorId: "d", amount: 4 },
    ];
    expect(allocatePayment(debts, "a", "d", 4)?.allocations).toEqual([
      { debtorId: "a", creditorId: "b", amount: 4 },
      { debtorId: "b", creditorId: "d", amount: 4 },
    ]);
    expect(allocatePayment(debts, "d", "a", 1)).toBeNull();
  });
});

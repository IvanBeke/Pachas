import { describe, expect, it } from "vitest";
import { computeSplits, sumSplits } from "../app/utils/splits";
import {
  allocatePayment,
  balancesFromPairwiseDebts,
  buildPairwiseDebts,
  suggestPairwiseTransfers,
  suggestSimplifiedTransfers,
  type ExpenseDebtInput,
  type PairwiseDebt,
} from "../server/utils/settlement-ledger";
import type { SuggestedTransfer } from "../server/utils/groups";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = ["u0", "u1", "u2", "u3", "u4", "u5", "u6"];
const EXPENSES = 30;

function makeExpenses(rand: () => number): (ExpenseDebtInput & { amountBase: number })[] {
  const expenses: (ExpenseDebtInput & { amountBase: number })[] = [];
  for (let index = 0; index < EXPENSES; index++) {
    const paidBy = USERS[Math.floor(rand() * USERS.length)]!;
    const n = 1 + Math.floor(rand() * USERS.length);
    const pool = [...USERS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const participants = pool.slice(0, n);
    const amountBase = (100 + Math.floor(rand() * 50_000)) / 100;
    const result = computeSplits({
      splitType: "equal",
      amountBase,
      participants,
      memberIds: [...USERS],
      values: {},
    });
    if (!result.ok) throw new Error("equal split unexpectedly failed");
    expenses.push({ paidBy, splits: result.splits, amountBase });
  }
  return expenses;
}

function applyTransfers(
  debts: PairwiseDebt[],
  transfers: SuggestedTransfer[],
): PairwiseDebt[] | null {
  let current = debts;
  for (const transfer of transfers) {
    const result = allocatePayment(current, transfer.from, transfer.to, transfer.amount);
    if (!result) return null;
    current = result.debts;
  }
  return current;
}

function residual(
  balances: { memberId: string; amount: number }[],
  transfers: SuggestedTransfer[],
): Record<string, number> {
  const cents = new Map(balances.map((balance) => [balance.memberId, Math.round(balance.amount * 100)]));
  for (const transfer of transfers) {
    const amount = Math.round(transfer.amount * 100);
    cents.set(transfer.from, (cents.get(transfer.from) ?? 0) + amount);
    cents.set(transfer.to, (cents.get(transfer.to) ?? 0) - amount);
  }
  return Object.fromEntries(
    [...cents.entries()].map(([memberId, amount]) => [memberId, amount / 100]),
  );
}

function assertSettles(
  debts: PairwiseDebt[],
  transfers: SuggestedTransfer[],
  label: string,
) {
  const balances = balancesFromPairwiseDebts(debts);
  const after = residual(balances, transfers);
  for (const [memberId, amount] of Object.entries(after)) {
    expect(
      Math.abs(amount),
      `${label}: ${memberId} net; balances=${JSON.stringify(balances)} transfers=${JSON.stringify(transfers)}`,
    ).toBeLessThan(0.005);
  }
  for (const transfer of transfers) {
    expect(transfer.from, `${label}: self payment`).not.toBe(transfer.to);
    expect(transfer.amount, `${label}: amount`).toBeGreaterThan(0);
    expect(Math.round(transfer.amount * 100) / 100).toBe(transfer.amount);
  }
}

describe("generated expense ledgers: settlement strategies", () => {
  it("both strategies settle the same group-wide balances across 200 ledgers", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const debts = buildPairwiseDebts(makeExpenses(mulberry32(seed)), []);
      assertSettles(debts, suggestSimplifiedTransfers(debts), `net seed=${seed}`);
      assertSettles(debts, suggestPairwiseTransfers(debts), `pairwise seed=${seed}`);
    }
  });

  it("pairwise suggestions are exactly the debts remaining between pairs", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const debts = buildPairwiseDebts(makeExpenses(mulberry32(seed)), []);
      const suggestions = suggestPairwiseTransfers(debts);
      expect(suggestions).toEqual(
        debts.map(({ debtorId, creditorId, amount }) => ({
          from: debtorId,
          to: creditorId,
          amount,
        })),
      );
      expect(applyTransfers(debts, suggestions), `seed=${seed}`).toEqual([]);
    }
  });

  it("simplified suggestions can be allocated along debt paths without changing net results", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const debts = buildPairwiseDebts(makeExpenses(mulberry32(seed)), []);
      const balances = balancesFromPairwiseDebts(debts);
      const transfers = suggestSimplifiedTransfers(debts);
      const after = applyTransfers(debts, transfers);
      expect(after, `seed=${seed} allocation path`).not.toBeNull();
      const afterBalances = balancesFromPairwiseDebts(after ?? []);
      for (const balance of afterBalances) {
        expect(Math.abs(balance.amount), `seed=${seed} ${balance.memberId}`).toBeLessThan(0.005);
      }
      assertSettles(debts, transfers, `simplified seed=${seed}`);
    }
  });

  it("keeps source expense splits reconciled to their totals", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const expenses = makeExpenses(mulberry32(seed));
      for (const expense of expenses) {
        expect(sumSplits(expense.splits)).toBeCloseTo(expense.amountBase, 2);
      }
    }
  });
});

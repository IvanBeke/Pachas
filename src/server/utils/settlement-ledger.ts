import { fromCents, toCents } from "../../shared/money";
import type { Balance, SuggestedTransfer } from "./groups";

export interface ExpenseDebtInput {
  paidBy: string;
  splits: Record<string, number>;
}

export interface SettlementAllocationInput {
  debtorId: string;
  creditorId: string;
  amount: number;
}

export interface PairwiseDebt {
  debtorId: string;
  creditorId: string;
  amount: number;
}

export interface SettlementAllocation extends PairwiseDebt {}


function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function buildPairwiseDebts(
  expenses: ExpenseDebtInput[],
  allocations: SettlementAllocationInput[],
): PairwiseDebt[] {
  const signedPairs = new Map<string, { a: string; b: string; cents: number }>();
  const add = (debtorId: string, creditorId: string, cents: number) => {
    if (debtorId === creditorId || cents === 0) return;
    const a = debtorId < creditorId ? debtorId : creditorId;
    const b = debtorId < creditorId ? creditorId : debtorId;
    const direction = debtorId === a ? 1 : -1;
    const key = pairKey(a, b);
    const row = signedPairs.get(key) ?? { a, b, cents: 0 };
    row.cents += direction * cents;
    signedPairs.set(key, row);
  };

  for (const expense of expenses) {
    for (const [debtorId, amount] of Object.entries(expense.splits)) {
      if (!Number.isFinite(amount)) continue;
      add(debtorId, expense.paidBy, toCents(amount));
    }
  }
  for (const allocation of allocations) {
    if (!Number.isFinite(allocation.amount)) continue;
    add(
      allocation.creditorId,
      allocation.debtorId,
      toCents(allocation.amount),
    );
  }

  return [...signedPairs.values()]
    .filter((row) => Math.abs(row.cents) > 0)
    .map((row) =>
      row.cents > 0
        ? { debtorId: row.a, creditorId: row.b, amount: fromCents(row.cents) }
        : { debtorId: row.b, creditorId: row.a, amount: fromCents(-row.cents) },
    )
    .sort(
      (left, right) =>
        left.debtorId.localeCompare(right.debtorId) ||
        left.creditorId.localeCompare(right.creditorId),
    );
}

export function balancesFromPairwiseDebts(debts: PairwiseDebt[]): Balance[] {
  const centsByMember = new Map<string, number>();
  for (const debt of debts) {
    const cents = toCents(debt.amount);
    centsByMember.set(
      debt.debtorId,
      (centsByMember.get(debt.debtorId) ?? 0) - cents,
    );
    centsByMember.set(
      debt.creditorId,
      (centsByMember.get(debt.creditorId) ?? 0) + cents,
    );
  }
  return [...centsByMember.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([memberId, cents]) => ({ memberId, amount: fromCents(cents) }));
}

export function suggestSimplifiedTransfers(
  debts: PairwiseDebt[],
): SuggestedTransfer[] {
  let remainingDebts = debts.map((debt) => ({ ...debt }));
  const transfers: SuggestedTransfer[] = [];

  // Only net debtor-to-creditor pairs connected by actual outstanding debt
  // paths can be recorded without inventing a new bilateral obligation.
  // Allocating each chosen payment along its path removes intermediaries from
  // the suggested transaction while preserving the underlying ledger.
  while (true) {
    const balances = balancesFromPairwiseDebts(remainingDebts);
    const debtors = balances
      .filter((balance) => balance.amount < -0.004)
      .map((balance) => ({ id: balance.memberId, cents: toCents(-balance.amount) }))
      .sort((left, right) => right.cents - left.cents || left.id.localeCompare(right.id));
    const creditors = balances
      .filter((balance) => balance.amount > 0.004)
      .map((balance) => ({ id: balance.memberId, cents: toCents(balance.amount) }))
      .sort((left, right) => right.cents - left.cents || left.id.localeCompare(right.id));
    if (!debtors.length || !creditors.length) break;

    let applied = false;
    for (const debtor of debtors) {
      for (const creditor of creditors) {
        const requestedCents = Math.min(debtor.cents, creditor.cents);
        let cents = requestedCents;
        let allocation = allocatePayment(
          remainingDebts,
          debtor.id,
          creditor.id,
          fromCents(cents),
        );
        if (!allocation && requestedCents > 1) {
          let low = 1;
          let high = requestedCents - 1;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = allocatePayment(
              remainingDebts,
              debtor.id,
              creditor.id,
              fromCents(middle),
            );
            if (candidate) {
              cents = middle;
              allocation = candidate;
              low = middle + 1;
            } else {
              high = middle - 1;
            }
          }
        }
        if (!allocation) continue;
        remainingDebts = allocation.debts;
        transfers.push({
          from: debtor.id,
          to: creditor.id,
          amount: fromCents(cents),
        });
        applied = true;
        break;
      }
      if (applied) break;
    }
    if (!applied) break;
  }

  return transfers;
}

export function suggestPairwiseTransfers(
  debts: PairwiseDebt[],
): SuggestedTransfer[] {
  return debts.map((debt) => ({
    from: debt.debtorId,
    to: debt.creditorId,
    amount: debt.amount,
  }));
}

export function allocatePayment(
  debts: PairwiseDebt[],
  from: string,
  to: string,
  amount: number,
): { debts: PairwiseDebt[]; allocations: SettlementAllocation[] } | null {
  const requested = toCents(amount);
  if (from === to || requested <= 0) return null;

  interface ResidualEdge {
    to: string;
    reverseIndex: number;
    capacity: number;
  }
  const graph = new Map<string, ResidualEdge[]>();
  const originalEdges: {
    debtorId: string;
    creditorId: string;
    capacity: number;
    forward: ResidualEdge;
  }[] = [];
  const edgesFor = (id: string) => {
    const edges = graph.get(id) ?? [];
    graph.set(id, edges);
    return edges;
  };

  for (const debt of debts) {
    const capacity = toCents(debt.amount);
    if (capacity <= 0) continue;
    const fromEdges = edgesFor(debt.debtorId);
    const toEdges = edgesFor(debt.creditorId);
    const forward: ResidualEdge = {
      to: debt.creditorId,
      reverseIndex: toEdges.length,
      capacity,
    };
    const reverse: ResidualEdge = {
      to: debt.debtorId,
      reverseIndex: fromEdges.length,
      capacity: 0,
    };
    fromEdges.push(forward);
    toEdges.push(reverse);
    originalEdges.push({
      debtorId: debt.debtorId,
      creditorId: debt.creditorId,
      capacity,
      forward,
    });
  }

  let flow = 0;
  while (flow < requested) {
    const parent = new Map<string, { from: string; edgeIndex: number }>();
    const visited = new Set([from]);
    const queue = [from];
    for (let cursor = 0; cursor < queue.length && !visited.has(to); cursor++) {
      const current = queue[cursor];
      if (current === undefined) continue;
      const edges = graph.get(current) ?? [];
      const ordered = edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => edge.capacity > 0)
        .sort((left, right) => left.edge.to.localeCompare(right.edge.to));
      for (const { edge, index } of ordered) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        parent.set(edge.to, { from: current, edgeIndex: index });
        queue.push(edge.to);
      }
    }
    if (!visited.has(to)) break;

    let pathCapacity = requested - flow;
    let node = to;
    while (node !== from) {
      const step = parent.get(node);
      const edge = step && graph.get(step.from)?.[step.edgeIndex];
      if (!step || !edge) return null;
      pathCapacity = Math.min(pathCapacity, edge.capacity);
      node = step.from;
    }
    if (pathCapacity <= 0) break;

    node = to;
    while (node !== from) {
      const step = parent.get(node);
      const edge = step && graph.get(step.from)?.[step.edgeIndex];
      if (!step || !edge) return null;
      edge.capacity -= pathCapacity;
      const reverse = graph.get(edge.to)?.[edge.reverseIndex];
      if (!reverse) return null;
      reverse.capacity += pathCapacity;
      node = step.from;
    }
    flow += pathCapacity;
  }
  if (flow !== requested) return null;

  const allocations = originalEdges
    .map((edge) => ({
      debtorId: edge.debtorId,
      creditorId: edge.creditorId,
      amount: fromCents(edge.capacity - edge.forward.capacity),
    }))
    .filter((edge) => edge.amount > 0)
    .sort(
      (left, right) =>
        left.debtorId.localeCompare(right.debtorId) ||
        left.creditorId.localeCompare(right.creditorId),
    );

  const allocationsByPair = new Map(
    allocations.map((allocation) => [
      `${allocation.debtorId}\0${allocation.creditorId}`,
      toCents(allocation.amount),
    ]),
  );
  const nextDebts = debts.flatMap((debt) => {
    const cents = toCents(debt.amount) -
      (allocationsByPair.get(`${debt.debtorId}\0${debt.creditorId}`) ?? 0);
    return cents > 0
      ? [{ ...debt, amount: fromCents(cents) }]
      : [];
  });
  return { debts: nextDebts, allocations };
}


import type { Balance, SuggestedTransfer } from "../composables/useGroupDetail";
import { fromCents, toCents } from "../../shared/money";
import { maxPaymentCents, owesMoney } from "../../shared/payment-rules";
import type { Expense, Settlement } from "./format";

/**
 * The payments a person may see and record: group creators and admins see all
 * of them; everyone else only the ones they owe or are owed. Mirrors the
 * server's `settlement.create` rule, which stays the authority.
 */
export function visibleTransfers(
  transfers: SuggestedTransfer[],
  meId: string,
  isElevated: boolean,
): SuggestedTransfer[] {
  return isElevated
    ? transfers
    : transfers.filter((transfer) => transfer.from === meId || transfer.to === meId);
}

export function transferKey(transfer: Pick<SuggestedTransfer, "from" | "to">): string {
  return `${transfer.from}:${transfer.to}`;
}

/** Mirrors the server's `settlement.create` rule, which stays the authority. */
export function canRecordPayment(
  from: string,
  to: string,
  meId: string,
  isElevated: boolean,
): boolean {
  return from !== to && (isElevated || from === meId || to === meId);
}

export interface PaymentContext {
  memberIds: string[];
  balances: Balance[];
  transfers: SuggestedTransfer[];
  meId: string;
  isElevated: boolean;
}

/** Who can pay: people who owe money, and for a member only those they could receive from (or themselves). */
export function payerOptions(ctx: PaymentContext): string[] {
  return ctx.memberIds.filter(
    (id) =>
      owesMoney(ctx.balances, ctx.transfers, id) &&
      (ctx.isElevated ||
        id === ctx.meId ||
        maxPaymentCents(ctx.balances, ctx.transfers, id, ctx.meId) > 0),
  );
}

/** Who `from` can pay: people who are owed, within what the person recording may do. */
export function receiverOptions(ctx: PaymentContext, from: string): string[] {
  return ctx.memberIds.filter(
    (id) =>
      canRecordPayment(from, id, ctx.meId, ctx.isElevated) &&
      maxPaymentCents(ctx.balances, ctx.transfers, from, id) > 0,
  );
}

/**
 * The payer's and receiver's net balances before and after a payment of
 * `amount`. A payment moves exactly that much from the receiver's balance to the
 * payer's, whatever debts it clears, so this is the real result, not an estimate.
 */
export function balancesAfter(
  balances: Balance[],
  from: string,
  to: string,
  amount: number,
): { id: string; before: number; after: number }[] {
  const cents = toCents(amount);
  const row = (id: string, delta: number) => {
    const before = toCents(balances.find((balance) => balance.memberId === id)?.amount ?? 0);
    return { id, before: fromCents(before), after: fromCents(before + delta) };
  };
  return [row(from, cents), row(to, -cents)];
}

export type FeedItem =
  | { kind: "expense"; date: string; ts: number; expense: Expense }
  | { kind: "settlement"; date: string; ts: number; settlement: Settlement };

/**
 * Expenses and recorded payments in one list, newest first. A settlement has no
 * date of its own, so it sits under the day it was recorded (UTC, like the
 * expense dates); within a day, the most recently created comes first.
 */
export function feedItems(expenses: Expense[], settlements: Settlement[]): FeedItem[] {
  const items: FeedItem[] = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      date: expense.date,
      ts: expense.createdAt || 0,
      expense,
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      date: new Date(settlement.createdAt || 0).toISOString().slice(0, 10),
      ts: settlement.createdAt || 0,
      settlement,
    })),
  ];
  return items.sort((a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1));
}

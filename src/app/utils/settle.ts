import type { SuggestedTransfer } from "../composables/useGroupDetail";
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

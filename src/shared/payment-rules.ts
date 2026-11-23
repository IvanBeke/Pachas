import { toCents } from "./money";

// Who can pay whom, and how much. Shared so the payment form and the server apply the same rules.

interface BalanceLike {
  memberId: string;
  amount: number;
}

interface TransferLike {
  from: string;
  to: string;
  amount: number;
}

/**
 * The most `from` may pay `to`, in cents: what `to` is owed overall, or the
 * suggested payment between the two when that is larger (pairwise mode can
 * suggest paying someone who is a net debtor). Zero means `to` can't be paid.
 */
export function maxPaymentCents(
  balances: BalanceLike[],
  transfers: TransferLike[],
  from: string,
  to: string,
): number {
  const owed = balances.find((balance) => balance.memberId === to)?.amount ?? 0;
  const suggested =
    transfers.find((transfer) => transfer.from === from && transfer.to === to)?.amount ?? 0;
  return Math.max(0, toCents(owed), toCents(suggested));
}

/**
 * Whether `id` can pay at all: they owe money overall, or have a suggested
 * payment to make (pairwise mode can suggest one to a net creditor).
 */
export function owesMoney(
  balances: BalanceLike[],
  transfers: TransferLike[],
  id: string,
): boolean {
  const net = balances.find((balance) => balance.memberId === id)?.amount ?? 0;
  return toCents(net) < 0 || transfers.some((transfer) => transfer.from === id);
}

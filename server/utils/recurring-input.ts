import { createError, type H3Event } from "h3";
import { readExpenseInput } from "./expense-input";
import type { RecurringExpensePayload } from "./groups";

const RECURRENCES = ["week", "month", "year"];

/**
 * Validates a recurring-expense body. Recurring expenses are stored with a
 * JSONB split snapshot rather than `expense_splits` rows, so it reuses the
 * expense validator for the amounts (server-computed) and adds the recurrence
 * fields on top.
 */
export async function readRecurringInput(
  event: H3Event,
  memberIds: string[],
  baseCurrency: string,
): Promise<RecurringExpensePayload> {
  const b = await readBody(event).catch(() => ({}));
  const recurrence = String(b.recurrence || "");
  const startDate = String(b.startDate || "");
  if (!RECURRENCES.includes(recurrence)) {
    throw createError({
      statusCode: 400,
      message: "Recurrence must be week, month, or year.",
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw createError({
      statusCode: 400,
      message: "A valid start date is required.",
    });
  }
  // Same authoritative path as a one-off expense: the server computes splits.
  const base = readExpenseInput(b, memberIds, baseCurrency);
  return {
    title: base.title,
    description: base.description,
    amount: base.amount,
    currency: base.currency,
    exchangeRate: base.exchangeRate,
    amountBase: base.amountBase,
    paidBy: base.paidBy,
    category: base.category,
    splitType: base.splitType,
    splits: base.splits,
    recurrence,
    startDate,
  };
}

import { createError } from "h3";
import { isDateOnly, readExpenseInput } from "./expense-input";
import type { RecurringExpensePayload } from "./groups";

export const RECURRENCES = ["week", "month", "year"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export function readRecurringDates(
  startInput: unknown,
  endInput: unknown,
): { startDate: string; endDate: string | null } {
  const startDate = isDateOnly(startInput) ? startInput : "";
  if (!startDate) {
    throw createError({
      statusCode: 400,
      message: "A valid start date is required.",
    });
  }

  let endDate: string | null = null;
  if (endInput !== undefined && endInput !== null && endInput !== "") {
    if (!isDateOnly(endInput)) {
      throw createError({ statusCode: 400, message: "A valid end date is required." });
    }
    if (endInput < startDate) {
      throw createError({
        statusCode: 400,
        message: "The end date cannot be before the start date.",
      });
    }
    endDate = endInput;
  }

  return { startDate, endDate };
}

/**
 * Validates a recurring-expense body. Recurring templates store a JSON split
 * snapshot rather than `expense_splits` rows, so it reuses the expense
 * validator for the amounts (server-computed) and adds the recurrence fields
 * on top.
 */
export function readRecurringInput(
  b: Record<string, unknown>,
  memberIds: string[],
  baseCurrency: string,
): RecurringExpensePayload {
  const recurrence = String(b.recurrence || "") as Recurrence;
  const { startDate, endDate } = readRecurringDates(b.startDate, b.endDate);
  if (!RECURRENCES.includes(recurrence)) {
    throw createError({
      statusCode: 400,
      message: "Recurrence must be week, month, or year.",
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
    endDate,
  };
}

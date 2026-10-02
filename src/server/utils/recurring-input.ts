import { createError, type H3Event } from "h3";
import { readExpenseInput } from "./expense-input";
import type { RecurringExpensePayload } from "./groups";

const RECURRENCES = ["week", "month", "year"];

export function readRecurringDates(
  startInput: unknown,
  endInput: unknown,
): { startDate: string; endDate: string | null } {
  const startDate = typeof startInput === "string" ? startInput : "";
  if (!isDateOnly(startDate)) {
    throw createError({
      statusCode: 400,
      message: "A valid start date is required.",
    });
  }

  let endDate: string | null = null;
  if (endInput !== undefined && endInput !== null && endInput !== "") {
    if (typeof endInput !== "string" || !isDateOnly(endInput)) {
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

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

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

import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { runtimeDb as db } from "./client";
import {
  expenseSplits,
  expenses,
  groupMembers,
  recurringExpenses,
} from "../db/schema";
import { lockGroup, writeTransaction } from "./sqlite-writes";
import type { Recurrence } from "./recurring-input";
import { dueOccurrences, todayUtc } from "./recurring-schedule";

/**
 * Turns recurring templates into real expenses.
 *
 * Runs at startup and then hourly (see `plugins/recurring.ts`). Dates are
 * calendar dates in UTC. For each template, every occurrence after
 * `generated_through` and up to today is created, then `generated_through`
 * advances to the last occurrence handled. A unique index on `(recurring_id, date)` makes a
 * double run harmless.
 *
 * An occurrence whose payer or participants are no longer group members is
 * skipped (and logged) rather than retried forever: balances must only ever
 * reference current members at the time of the write.
 */

async function generateForTemplate(rid: string, today: string): Promise<number> {
  return writeTransaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(recurringExpenses)
      .where(eq(recurringExpenses.id, rid))
      .limit(1);
    if (!template) return 0;
    const dates = dueOccurrences(
      { ...template, recurrence: template.recurrence as Recurrence },
      today,
    );
    if (!dates.length) {
      // Nothing due; still advance so finished templates stop being selected.
      if (template.endDate && template.endDate < today && template.generatedThrough !== template.endDate) {
        await tx
          .update(recurringExpenses)
          .set({ generatedThrough: template.endDate })
          .where(eq(recurringExpenses.id, rid));
      }
      return 0;
    }

    await lockGroup(tx, template.groupId);
    const members = new Set(
      (
        await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, template.groupId))
      ).map((m) => m.userId),
    );
    const participants = [template.paidBy, ...Object.keys(template.splits)];
    const valid = participants.every((uid) => members.has(uid));
    const last = dates[dates.length - 1]!;

    let created = 0;
    if (valid) {
      for (const date of dates) {
        const id = randomUUID();
        const inserted = await tx
          .insert(expenses)
          .values({
            id,
            groupId: template.groupId,
            title: template.title,
            description: template.description,
            amount: template.amount,
            currency: template.currency,
            exchangeRate: template.exchangeRate,
            amountBase: template.amountBase,
            paidBy: template.paidBy,
            category: template.category,
            date,
            splitType: template.splitType,
            createdBy: template.createdBy,
            createdAt: Date.now(),
            recurringId: template.id,
          })
          .onConflictDoNothing()
          .returning({ id: expenses.id });
        if (!inserted.length) continue;
        const splitRows = Object.entries(template.splits).map(([userId, amount]) => ({
          expenseId: id,
          userId,
          amount,
        }));
        if (splitRows.length) await tx.insert(expenseSplits).values(splitRows);
        created++;
      }
    } else {
      console.warn(
        `[pachas] recurring expense ${template.id} skipped ${dates.length} occurrence(s): ` +
          "payer or participants are no longer group members",
      );
    }

    await tx
      .update(recurringExpenses)
      .set({ generatedThrough: last })
      .where(eq(recurringExpenses.id, rid));
    return created;
  });
}

/** Generates every due occurrence across all groups. Returns the count created. */
export async function generateRecurringExpenses(
  today = todayUtc(),
  onlyId?: string,
): Promise<number> {
  const candidates = await db
    .select({ id: recurringExpenses.id })
    .from(recurringExpenses)
    .where(
      and(
        onlyId ? eq(recurringExpenses.id, onlyId) : undefined,
        lte(recurringExpenses.startDate, today),
        or(
          isNull(recurringExpenses.generatedThrough),
          and(
            lt(recurringExpenses.generatedThrough, today),
            or(
              isNull(recurringExpenses.endDate),
              lt(recurringExpenses.generatedThrough, recurringExpenses.endDate),
            ),
          ),
        ),
      ),
    );
  let total = 0;
  for (const { id } of candidates) {
    try {
      total += await generateForTemplate(id, today);
    } catch (error) {
      console.error(`[pachas] recurring expense ${id} failed to generate`, error);
    }
  }
  return total;
}

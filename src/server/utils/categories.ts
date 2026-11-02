import { createError } from "h3";
import { eq } from "drizzle-orm";
import {
  categories,
  categoryTitleLinks,
  expenses,
  recurringExpenses,
} from "../db/schema";
import { writeTransaction } from "./sqlite-writes";

/**
 * Deletes a category, moving everything that pointed at it to `migrateTo`:
 * expenses, recurring templates (so future occurrences don't reference a
 * deleted category) and title links (which `ON DELETE CASCADE` would
 * otherwise silently drop).
 */
export function deleteCategoryMigrating(id: number, migrateTo: number): Promise<void> {
  return writeTransaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).limit(1),
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, migrateTo))
        .limit(1),
    ]);
    if (!source[0]) {
      throw createError({ statusCode: 404, message: "Category not found." });
    }
    if (!target[0]) {
      throw createError({ statusCode: 400, message: "Target category not found." });
    }
    await tx
      .update(expenses)
      .set({ category: String(migrateTo) })
      .where(eq(expenses.category, String(id)));
    await tx
      .update(recurringExpenses)
      .set({ category: String(migrateTo) })
      .where(eq(recurringExpenses.category, String(id)));
    await tx
      .update(categoryTitleLinks)
      .set({ categoryId: migrateTo })
      .where(eq(categoryTitleLinks.categoryId, id));
    await tx.delete(categories).where(eq(categories.id, id));
  });
}

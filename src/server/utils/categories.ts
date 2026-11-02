import { createError } from "h3";
import { asc, eq } from "drizzle-orm";
import { runtimeDb as db } from "./client";
import { defaultCategory } from "../../shared/categories";
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
      .set({ category: migrateTo })
      .where(eq(expenses.category, id));
    await tx
      .update(recurringExpenses)
      .set({ category: migrateTo })
      .where(eq(recurringExpenses.category, id));
    await tx
      .update(categoryTitleLinks)
      .set({ categoryId: migrateTo })
      .where(eq(categoryTitleLinks.categoryId, id));
    await tx.delete(categories).where(eq(categories.id, id));
  });
}

/** What expense input is validated against: which categories exist and the default. */
export interface CategoryContext {
  validIds: ReadonlySet<string>;
  /** The id (as stored on expenses) of the category used when none is given. */
  defaultId: string;
}

export async function loadCategoryContext(): Promise<CategoryContext> {
  const rows = await db
    .select({ id: categories.id, title: categories.title })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.id));
  const fallback = defaultCategory(rows);
  // The startup seed always recreates "General", so this cannot happen.
  if (!fallback) throw new Error("categories table is empty");
  return {
    validIds: new Set(rows.map((r) => String(r.id))),
    defaultId: String(fallback.id),
  };
}

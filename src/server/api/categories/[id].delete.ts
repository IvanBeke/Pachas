import { eq } from "drizzle-orm";
import { requireAdmin } from "../../utils/auth";
import { categories, expenses, recurringExpenses } from "../../db/schema";
import { writeTransaction } from "../../utils/sqlite-writes";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: "Invalid category id." });
  }
  const body = await readJsonObject(event);
  const migrateTo = Number(body.migrateTo);
  if (!Number.isInteger(migrateTo) || migrateTo === id) {
    throw createError({
      statusCode: 400,
      message: "Pick a different category to migrate expenses to.",
    });
  }
  await writeTransaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).limit(1),
      tx.select({ id: categories.id }).from(categories).where(eq(categories.id, migrateTo)).limit(1),
    ]);
    if (!source[0]) {
      throw createError({ statusCode: 404, message: "Category not found." });
    }
    if (!target[0]) {
      throw createError({ statusCode: 400, message: "Target category not found." });
    }
    // Recurring templates move too, so future occurrences don't reference the
    // deleted category.
    await tx
      .update(expenses)
      .set({ category: String(migrateTo) })
      .where(eq(expenses.category, String(id)));
    await tx
      .update(recurringExpenses)
      .set({ category: String(migrateTo) })
      .where(eq(recurringExpenses.category, String(id)));
    await tx.delete(categories).where(eq(categories.id, id));
  });
  return { ok: true, migratedTo: migrateTo };
});

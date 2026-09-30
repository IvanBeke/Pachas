import { and, eq } from "drizzle-orm";
import { requireAdmin } from "../../../../utils/auth";
import { db } from "../../../../utils/client";
import { expenses } from "../../../../db/schema";

// Admins can delete any expense, regardless of creator.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const gid = String(getRouterParam(event, "gid"));
  const eid = String(getRouterParam(event, "eid"));
  const deleted = await db
    .delete(expenses)
    .where(and(eq(expenses.id, eid), eq(expenses.groupId, gid)))
    .returning({ id: expenses.id });
  if (!deleted[0]) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  return { ok: true };
});

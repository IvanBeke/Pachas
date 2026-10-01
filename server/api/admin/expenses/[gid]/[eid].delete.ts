import { requireAdmin } from "../../../../utils/auth";
import { deleteExpenseById } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const gid = String(getRouterParam(event, "gid"));
  const eid = String(getRouterParam(event, "eid"));
  const deleted = await deleteExpenseById(gid, eid);
  if (!deleted) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  return { ok: true };
});

import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  deleteRecurringExpense,
} from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const rid = String(getRouterParam(event, "rid"));
  await requireMember(gid, me.id);

  const ok = await deleteRecurringExpense(gid, rid, me.id, me.role === "admin");
  if (!ok) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }
  return { ok: true };
});

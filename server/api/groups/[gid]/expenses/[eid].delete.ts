import { requireUser } from "../../../../utils/auth";
import { requireMember, deleteExpenseIfOwner } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const eid = String(getRouterParam(event, "eid"));
  await requireMember(gid, me.id);
  // Site admins may delete anyone's expense, matching the button the UI shows
  // them and the override updateExpenseIfOwner already has.
  const ok = await deleteExpenseIfOwner(gid, eid, me.id, me.role === "admin");
  if (!ok) {
    throw createError({
      statusCode: 404,
      message: "Expense not found.",
    });
  }
  return { ok: true };
});

import { requireUser } from "../../../../utils/auth";
import { requireMember, deleteRecurringExpenseIfAllowed } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const rid = requireParam(event, "rid");
  await requireMember(gid, me.id);
  if (!(await deleteRecurringExpenseIfAllowed(gid, rid, me.id))) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }
  return { ok: true };
});

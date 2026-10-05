import { requireUser } from "../../../../utils/auth";
import { requireMember, deleteExpenseIfAllowed } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const eid = requireParam(event, "eid");
  await requireMember(gid, me.id);
  if (!(await deleteExpenseIfAllowed(gid, eid, me.id))) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  return { ok: true };
});

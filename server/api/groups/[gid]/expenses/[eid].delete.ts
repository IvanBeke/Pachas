import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  deleteExpenseIfOwner,
  getExpenseOwner,
} from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const eid = String(getRouterParam(event, "eid"));
  const group = await requireMember(gid, me.id);
  const ownerId = await getExpenseOwner(gid, eid);
  if (
    !ownerId ||
    !canGroupAction(me, group, { type: "expense.delete", ownerId })
  ) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  const ok = await deleteExpenseIfOwner(
    gid,
    eid,
    me.id,
    canGroupAction(me, group, "expense.manage.any"),
  );
  if (!ok) {
    throw createError({
      statusCode: 404,
      message: "Expense not found.",
    });
  }
  return { ok: true };
});

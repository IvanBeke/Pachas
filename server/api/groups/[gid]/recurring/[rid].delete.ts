import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  deleteRecurringExpense,
  getRecurringExpenseOwner,
} from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const rid = String(getRouterParam(event, "rid"));
  const group = await requireMember(gid, me.id);
  const ownerId = await getRecurringExpenseOwner(gid, rid);
  if (
    !ownerId ||
    !canGroupAction(me, group, { type: "recurring.delete", ownerId })
  ) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }

  const ok = await deleteRecurringExpense(
    gid,
    rid,
    me.id,
    canGroupAction(me, group, "recurring.manage.any"),
  );
  if (!ok) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }
  return { ok: true };
});

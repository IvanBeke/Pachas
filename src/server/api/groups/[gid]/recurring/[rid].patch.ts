import { requireUser } from "../../../../utils/auth";
import {
  getRecurringExpenseOwner,
  requireMember,
  updateRecurringExpense,
} from "../../../../utils/groups";
import { readRecurringInput } from "../../../../utils/recurring-input";
import { canGroupAction } from "../../../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const rid = String(getRouterParam(event, "rid"));
  const group = await requireMember(gid, me.id);
  const ownerId = await getRecurringExpenseOwner(gid, rid);
  if (
    !ownerId ||
    !canGroupAction(me, group, { type: "recurring.update", ownerId })
  ) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }
  const payload = await readRecurringInput(event, group.memberIds, group.baseCurrency);

  const ok = await updateRecurringExpense(
    gid,
    rid,
    payload,
    me.id,
    canGroupAction(me, group, "recurring.manage.any"),
  );
  if (!ok) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }
  return { ok: true };
});

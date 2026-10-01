import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  getExpenseOwner,
  updateExpenseIfOwner,
  type ExpensePayload,
} from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";
import { readExpenseInput } from "../../../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const eid = String(getRouterParam(event, "eid"));
  const group = await requireMember(gid, me.id);
  const ownerId = await getExpenseOwner(gid, eid);
  if (
    !ownerId ||
    !canGroupAction(me, group, { type: "expense.update", ownerId })
  ) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  const b = await readBody(event).catch(() => ({}));
  const payload = readExpenseInput(b, group.memberIds, group.baseCurrency);

  const ok = await updateExpenseIfOwner(
    gid,
    eid,
    payload,
    me.id,
  );
  if (!ok) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  return { ok: true };
});

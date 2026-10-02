import { requireUser } from "../../../../utils/auth";
import { requireMember, createExpense } from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";
import { readExpenseInput } from "../../../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, "expense.create")) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }
  const b = await readBody(event).catch(() => ({}));
  const payload = readExpenseInput(b, group.memberIds, group.baseCurrency);
  const eid = await createExpense(gid, payload, me.id);
  return { id: eid };
});

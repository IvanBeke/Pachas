import { requireUser } from "../../../../utils/auth";
import { requireMember, createExpense } from "../../../../utils/groups";
import { readExpenseInput } from "../../../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const group = await requireMember(gid, me.id);
  const b = await readBody(event).catch(() => ({}));
  const payload = readExpenseInput(b, group.memberIds, group.baseCurrency);
  const eid = await createExpense(gid, payload, me.id);
  return { id: eid };
});

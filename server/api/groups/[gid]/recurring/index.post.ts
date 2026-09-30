import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  createRecurringExpense,
} from "../../../../utils/groups";
import { readRecurringInput } from "../../../../utils/recurring-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const group = await requireMember(gid, me.id);
  const payload = await readRecurringInput(event, group.memberIds, group.baseCurrency);
  return createRecurringExpense(gid, payload, me.id);
});

import { requireUser } from "../../../../utils/auth";
import { requireMember, updateRecurringExpense } from "../../../../utils/groups";
import { readRecurringInput } from "../../../../utils/recurring-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const rid = String(getRouterParam(event, "rid"));
  const group = await requireMember(gid, me.id);
  const payload = await readRecurringInput(event, group.memberIds, group.baseCurrency);

  const ok = await updateRecurringExpense(gid, rid, payload, me.id, me.role === "admin");
  if (!ok) {
    throw createError({ statusCode: 404, message: "Recurring expense not found." });
  }
  return { ok: true };
});

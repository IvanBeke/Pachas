import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  updateExpenseIfOwner,
  type ExpensePayload,
} from "../../../../utils/groups";
import { readExpenseInput } from "../../../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const eid = String(getRouterParam(event, "eid"));
  const group = await requireMember(gid, me.id);
  const b = await readBody(event).catch(() => ({}));
  const payload = readExpenseInput(b, group.memberIds, group.baseCurrency);

  const ok = await updateExpenseIfOwner(
    gid,
    eid,
    payload,
    me.id,
    me.role === "admin",
  );
  if (!ok) {
    throw createError({ statusCode: 404, message: "Expense not found." });
  }
  return { ok: true };
});

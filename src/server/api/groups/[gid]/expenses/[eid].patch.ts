import { requireUser } from "../../../../utils/auth";
import { requireMember, updateExpenseIfAllowed } from "../../../../utils/groups";
import { readExpenseInput } from "../../../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const eid = requireParam(event, "eid");
  await requireMember(gid, me.id);
  const body = await readJsonObject(event);
  // Validated against the member list inside the write transaction.
  const ok = await updateExpenseIfAllowed(
    gid,
    eid,
    (group) => readExpenseInput(body, group.memberIds, group.baseCurrency),
    me.id,
  );
  if (!ok) throw createError({ statusCode: 404, message: "Expense not found." });
  return { ok: true };
});

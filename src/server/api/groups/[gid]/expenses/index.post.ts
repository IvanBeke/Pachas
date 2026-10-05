import { requireUser } from "../../../../utils/auth";
import { requireMember, createExpense } from "../../../../utils/groups";
import { readExpenseInput } from "../../../../utils/expense-input";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  const payload = readExpenseInput(
    await readJsonObject(event),
    group.memberIds,
    group.baseCurrency,
  );
  return { id: await createExpense(gid, payload, me.id) };
});

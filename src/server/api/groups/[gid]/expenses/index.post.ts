import { requireUser } from "../../../../utils/auth";
import { requireMember, createExpense } from "../../../../utils/groups";
import { readExpenseInput } from "../../../../utils/expense-input";
import { loadCategoryContext } from "../../../../utils/categories";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  const payload = readExpenseInput(
    await readJsonObject(event),
    group.memberIds,
    group.baseCurrency,
    await loadCategoryContext(),
  );
  return { id: await createExpense(gid, payload, me.id) };
});

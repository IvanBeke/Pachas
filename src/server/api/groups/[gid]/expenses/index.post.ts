import { requireUser } from "../../../../utils/auth";
import { requireMember, createExpense } from "../../../../utils/groups";
import { readExpenseInput } from "../../../../utils/expense-input";
import { loadCategoryContext } from "../../../../utils/categories";
import { roundingRing } from "../../../../../shared/splits";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  await requireMember(gid, me.id);
  const body = await readJsonObject(event);
  const categories = await loadCategoryContext();
  // Computed inside the write transaction, against the group's current cursor.
  const id = await createExpense(
    gid,
    (group) =>
      readExpenseInput(
        body,
        group.memberIds,
        group.baseCurrency,
        categories,
        roundingRing(group.memberIds, group.roundingCursor),
      ),
    me.id,
  );
  return { id };
});

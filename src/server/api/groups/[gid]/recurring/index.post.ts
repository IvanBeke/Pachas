import { requireUser } from "../../../../utils/auth";
import { requireMember, createRecurringExpense } from "../../../../utils/groups";
import { readRecurringInput } from "../../../../utils/recurring-input";
import { generateRecurringExpenses } from "../../../../utils/recurring";
import { loadCategoryContext } from "../../../../utils/categories";
import { roundingRing } from "../../../../../shared/splits";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  const payload = readRecurringInput(
    await readJsonObject(event),
    group.memberIds,
    group.baseCurrency,
    await loadCategoryContext(),
    roundingRing(group.memberIds, group.roundingCursor),
  );
  const rid = await createRecurringExpense(gid, payload, me.id);
  // Occurrences already due (start date today or earlier) appear immediately
  // instead of waiting for the hourly run.
  await generateRecurringExpenses(undefined, rid);
  return rid;
});

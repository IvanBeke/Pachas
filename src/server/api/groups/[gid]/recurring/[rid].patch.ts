import { requireUser } from "../../../../utils/auth";
import { requireMember, updateRecurringExpenseIfAllowed } from "../../../../utils/groups";
import { readRecurringInput } from "../../../../utils/recurring-input";
import { loadCategoryContext } from "../../../../utils/categories";
import { roundingRing } from "../../../../../shared/splits";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const rid = requireParam(event, "rid");
  await requireMember(gid, me.id);
  const body = await readJsonObject(event);
  const categories = await loadCategoryContext();
  const ok = await updateRecurringExpenseIfAllowed(
    gid,
    rid,
    (group) =>
      readRecurringInput(
        body,
        group.memberIds,
        group.baseCurrency,
        categories,
        roundingRing(group.memberIds, group.roundingCursor),
      ),
    me.id,
  );
  if (!ok) throw createError({ statusCode: 404, message: "Recurring expense not found." });
  return { ok: true };
});

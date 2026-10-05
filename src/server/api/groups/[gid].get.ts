import { requireUser } from "../../utils/auth";
import { hasExpenses, requireMember } from "../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  return { ...group, hasExpenses: await hasExpenses(gid) };
});

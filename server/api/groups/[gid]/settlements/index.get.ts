import { requireUser } from "../../../../utils/auth";
import { requireMember, getSettlements } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  await requireMember(gid, me.id);
  return getSettlements(gid);
});

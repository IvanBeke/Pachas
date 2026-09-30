import { requireUser } from "../../../../utils/auth";
import { requireMember, getSettlementPlan } from "../../../../utils/groups";

/**
 * Authoritative balances and the transfers that would settle them. The client
 * renders these instead of computing its own, so what it displays always
 * matches what the server would accept.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  await requireMember(gid, me.id);
  return getSettlementPlan(gid);
});

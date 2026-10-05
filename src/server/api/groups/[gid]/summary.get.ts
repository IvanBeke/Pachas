import { requireUser } from "../../../utils/auth";
import {
  getExpenses,
  getSettlementPlan,
  getSettlements,
  requireMember,
} from "../../../utils/groups";

/**
 * Everything the group page shows, in one request.
 *
 * The ETag is the group's version, which every write bumps, so a client that
 * already has the current data gets a body-less 304 and the server does no
 * work beyond the membership check. This is what makes polling cheap.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const group = await requireMember(gid, me.id);
  const etag = `"g${group.version}"`;
  setResponseHeader(event, "cache-control", "private, no-cache");
  setResponseHeader(event, "etag", etag);
  if (getRequestHeader(event, "if-none-match") === etag) {
    setResponseStatus(event, 304);
    return null;
  }
  const [expenses, settlements, plan] = await Promise.all([
    getExpenses(gid),
    getSettlements(gid),
    getSettlementPlan(gid, group.version),
  ]);
  return { group, expenses, settlements, plan };
});

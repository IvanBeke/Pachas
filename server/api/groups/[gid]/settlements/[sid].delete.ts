import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  deleteSettlementIfOwner,
} from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const sid = String(getRouterParam(event, "sid"));
  await requireMember(gid, me.id);
  const ok = await deleteSettlementIfOwner(gid, sid, me.id);
  if (!ok) {
    throw createError({
      statusCode: 403,
      message:
        "Only the person who recorded this payment can delete it, or it doesn't exist.",
    });
  }
  return { ok: true };
});

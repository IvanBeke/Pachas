import { requireUser } from "../../../../utils/auth";
import {
  requireMember,
  deleteSettlementIfOwner,
  getSettlementRecorder,
} from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const sid = String(getRouterParam(event, "sid"));
  const group = await requireMember(gid, me.id);
  const recorderId = await getSettlementRecorder(gid, sid);
  if (
    !recorderId ||
    !canGroupAction(me, group, { type: "settlement.delete", recorderId })
  ) {
    throw createError({
      statusCode: 403,
      message: "Only the person who recorded this payment can delete it, or it doesn't exist.",
    });
  }
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

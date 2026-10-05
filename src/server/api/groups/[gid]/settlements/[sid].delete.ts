import { requireUser } from "../../../../utils/auth";
import { requireMember, deleteSettlementIfAllowed } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const sid = requireParam(event, "sid");
  await requireMember(gid, me.id);
  if (!(await deleteSettlementIfAllowed(gid, sid, me.id))) {
    throw createError({
      statusCode: 403,
      message: "Only the person who recorded this payment can delete it, or it doesn't exist.",
    });
  }
  return { ok: true };
});

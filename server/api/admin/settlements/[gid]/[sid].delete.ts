import { requireAdmin } from "../../../../utils/auth";
import { deleteSettlementById } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const gid = String(getRouterParam(event, "gid"));
  const sid = String(getRouterParam(event, "sid"));
  const deleted = await deleteSettlementById(gid, sid);
  if (!deleted) {
    throw createError({ statusCode: 404, message: "Settlement not found." });
  }
  return { ok: true };
});

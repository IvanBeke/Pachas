import { requireUser } from "../../utils/auth";
import { deleteGroup, requireMember } from "../../utils/groups";
import { canGroupAction } from "../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, "group.delete")) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }
  await deleteGroup(gid, me.id);
  return { ok: true };
});

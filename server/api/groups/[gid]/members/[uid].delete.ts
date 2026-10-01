import { requireUser } from "../../../../utils/auth";
import { requireMember, removeGroupMember } from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const uid = String(getRouterParam(event, "uid"));

  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, { type: "member.remove", targetUserId: uid })) {
    if (uid === me.id && group.members.find((member) => member.userId === me.id)?.role === "creator") {
      throw createError({ statusCode: 400, message: "cannot_remove_self" });
    }
    throw createError({ statusCode: 403, message: "forbidden" });
  }
  return removeGroupMember(gid, uid, me.id);
});

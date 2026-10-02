import { requireUser, findUserById } from "../../../utils/auth";
import { requireMember, addGroupMember } from "../../../utils/groups";
import { canGroupAction } from "../../../utils/group-permissions";

/**
 * Any group member may add another user. New memberships always start with the
 * member role; callers cannot choose a privileged role here.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));

  const group = await requireMember(gid, me.id);
  if (!canGroupAction(me, group, "member.add")) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }

  const body = await readBody(event).catch(() => ({}));
  const { userId } = body || {};
  if (!userId || !(await findUserById(userId))) {
    throw createError({ statusCode: 400, message: "Unknown user." });
  }
  return addGroupMember(gid, userId, me.id);
});

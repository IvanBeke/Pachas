import { GroupRole } from "../../../../../shared/group-roles";
import { requireUser } from "../../../../utils/auth";
import {
  changeGroupMemberRole,
  requireMember,
} from "../../../../utils/groups";
import { canGroupAction } from "../../../../utils/group-permissions";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const uid = String(getRouterParam(event, "uid"));
  const group = await requireMember(gid, me.id);
  const body = await readBody(event).catch(() => ({}));
  const role = body?.role as GroupRole;

  if (!Object.values(GroupRole).includes(role)) {
    throw createError({ statusCode: 400, message: "invalid_group_role" });
  }
  if (!canGroupAction(me, group, { type: "member.role.change", targetUserId: uid, role })) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }

  return changeGroupMemberRole(gid, uid, role, me.id);
});

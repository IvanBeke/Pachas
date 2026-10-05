import { GroupRole } from "../../../../../shared/group-roles";
import { requireUser } from "../../../../utils/auth";
import { changeGroupMemberRole, requireMember } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const uid = requireParam(event, "uid");
  await requireMember(gid, me.id);
  const { role } = await readJsonObject(event);
  if (!Object.values(GroupRole).includes(role as GroupRole)) {
    throw createError({ statusCode: 400, message: "invalid_group_role" });
  }
  return changeGroupMemberRole(gid, uid, role as GroupRole, me.id);
});

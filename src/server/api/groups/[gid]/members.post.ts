import { requireUser, findUserById } from "../../../utils/auth";
import { requireMember, addGroupMember } from "../../../utils/groups";

/**
 * The group creator and group admins may add an existing user. New memberships
 * always start with the member role; callers cannot choose a privileged role.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  await requireMember(gid, me.id);
  const { userId } = await readJsonObject(event);
  if (typeof userId !== "string" || !(await findUserById(userId))) {
    throw createError({ statusCode: 400, message: "Unknown user." });
  }
  return addGroupMember(gid, userId, me.id);
});

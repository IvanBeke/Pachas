import { requireUser, findUserById } from "../../../utils/auth";
import { getGroupById, addGroupMember } from "../../../utils/groups";

/**
 * Adding someone to a group grants them read access to its entire expense
 * history, so it is restricted to the group's creator or a site admin — the
 * same rule as removal. Ordinary members can still create their own group and
 * add people to it, which is how a household bootstraps the app.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));

  const group = await getGroupById(gid);
  if (!group) throw createError({ statusCode: 404, message: "not_found" });
  if (group.createdBy !== me.id && me.role !== "admin") {
    throw createError({ statusCode: 403, message: "forbidden" });
  }

  const body = await readBody(event).catch(() => ({}));
  const { userId } = body || {};
  if (!userId || !(await findUserById(userId))) {
    throw createError({ statusCode: 400, message: "Unknown user." });
  }
  return addGroupMember(gid, userId);
});

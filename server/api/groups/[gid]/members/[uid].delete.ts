import { requireUser } from "../../../../utils/auth";
import { getGroupById, removeGroupMember } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  const uid = String(getRouterParam(event, "uid"));

  const group = await getGroupById(gid);
  if (!group) throw createError({ statusCode: 404, message: "not_found" });

  const isCreator = group.createdBy === me.id;
  const isAdmin = me.role === "admin";
  const isSelf = uid === me.id;

  // Anyone may remove themselves, so a member is never trapped in a group. The
  // creator is the exception: a group with no creator cannot be administered
  // or edited by anyone, so it would be orphaned.
  if (!isCreator && !isAdmin && !isSelf) {
    throw createError({ statusCode: 403, message: "forbidden" });
  }

  if (isSelf && isCreator) {
    throw createError({ statusCode: 400, message: "cannot_remove_self" });
  }

  return removeGroupMember(gid, uid);
});

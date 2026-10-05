import { requireUser } from "../../../../utils/auth";
import { requireMember, removeGroupMember } from "../../../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  const uid = requireParam(event, "uid");
  await requireMember(gid, me.id);
  return removeGroupMember(gid, uid, me.id);
});

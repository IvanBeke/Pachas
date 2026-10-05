import { requireUser } from "../../utils/auth";
import { deleteGroup, requireMember } from "../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = requireParam(event, "gid");
  await requireMember(gid, me.id);
  await deleteGroup(gid, me.id);
  return { ok: true };
});

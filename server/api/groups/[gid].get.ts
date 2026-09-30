import { requireUser } from "../../utils/auth";
import { requireMember } from "../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const gid = String(getRouterParam(event, "gid"));
  return requireMember(gid, me.id);
});

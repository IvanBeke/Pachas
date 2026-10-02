import { requireUser } from "../../utils/auth";
import { getGroupsForUser } from "../../utils/groups";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  return getGroupsForUser(me.id);
});

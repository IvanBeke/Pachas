import { requireUser } from "../../utils/auth";
import { getVisibleUsersByIds } from "../../utils/groups";

const MAX_IDS = 100;

/**
 * Profiles for the requested ids. Only users who share a group with the
 * caller are resolved; any other id gets the same placeholder as an unknown
 * one, so this can't be used to probe accounts.
 */
export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const ids = [
    ...new Set(
      String(getQuery(event).ids || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length > MAX_IDS) {
    throw createError({ statusCode: 400, message: `At most ${MAX_IDS} ids per request.` });
  }
  const found = await getVisibleUsersByIds(me.id, ids);
  const byId = new Map(found.map((u) => [u.id, u]));
  return ids.map(
    (uid) => byId.get(uid) || { id: uid, name: "", username: "", color: "#8B978F" },
  );
});

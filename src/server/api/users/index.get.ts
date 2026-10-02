import { requireUser } from "../../utils/auth";
import { getUsersByIds } from "../../utils/groups";

export default defineEventHandler(async (event) => {
  await requireUser(event);
  const ids = String(getQuery(event).ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const found = await getUsersByIds(ids);
  const byId: Record<string, (typeof found)[number]> = {};
  for (const u of found) {
    if (u) byId[u.id] = u;
  }
  return ids.map(
    (uid) => byId[uid] || { id: uid, name: "", username: "", color: "#8B978F" },
  );
});

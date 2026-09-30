import { requireUser, findUserById } from "../../utils/auth";
import { getUsersByIds, createGroup } from "../../utils/groups";

/** Bounds the `IN (...)` list built below, so a huge array cannot be sent. */
const MAX_INITIAL_MEMBERS = 100;

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const body = await readBody(event).catch(() => ({}));
  const { name, emoji, baseCurrency, memberIds } = body || {};
  if (typeof name !== "string" || !name.trim()) {
    throw createError({
      statusCode: 400,
      message: "A group name is required.",
    });
  }
  if (Array.isArray(memberIds) && memberIds.length > MAX_INITIAL_MEMBERS) {
    throw createError({
      statusCode: 400,
      message: `A group can start with at most ${MAX_INITIAL_MEMBERS} members.`,
    });
  }
  const wanted = Array.isArray(memberIds)
    ? (await getUsersByIds(memberIds))
        .map((u) => u?.id)
        .filter((id): id is string => Boolean(id))
    : [];
  // Guard against forged member ids.
  const verified: string[] = [];
  for (const uid of wanted) {
    if (await findUserById(uid)) verified.push(uid);
  }
  return createGroup(
    name.trim().slice(0, 80),
    (emoji || "🧾").toString().slice(0, 4),
    (baseCurrency || "EUR").toString().toUpperCase().slice(0, 3),
    me.id,
    verified,
  );
});

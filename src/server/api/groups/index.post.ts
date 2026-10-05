import { requireUser } from "../../utils/auth";
import { createGroup, getUsersByIds } from "../../utils/groups";
import { readCurrency } from "../../utils/expense-input";

/** Bounds the `IN (...)` list built below, so a huge array cannot be sent. */
const MAX_INITIAL_MEMBERS = 100;

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const { name, emoji, baseCurrency, memberIds } = await readJsonObject(event);
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
  const requested = Array.isArray(memberIds)
    ? [...new Set(memberIds.filter((id): id is string => typeof id === "string"))]
    : [];
  // Only real accounts are added; unknown ids are dropped silently.
  const verified = (await getUsersByIds(requested)).map((u) => u.id);
  return createGroup(
    name.trim().slice(0, 80),
    String(emoji || "🧾").slice(0, 4),
    readCurrency(baseCurrency, "EUR"),
    me.id,
    verified,
  );
});


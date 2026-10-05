import { and, ne, or, sql } from "drizzle-orm";
import { runtimeDb as db } from "../../utils/client";
import { users } from "../../db/schema";
import { requireUser, publicUser } from "../../utils/auth";
import { hit } from "../../utils/rate-limit";

const MIN_QUERY = 3;
const PER_USER = { limit: 60, windowMs: 60_000 };

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const q = String(getQuery(event).q || "").trim().slice(0, 60);
  if (q.length < MIN_QUERY) return [];
  const check = hit(`search:${me.id}`, PER_USER.limit, PER_USER.windowMs);
  if (!check.ok) {
    throw createError({
      statusCode: 429,
      message: "Too many searches. Try again later.",
      data: { retryAfter: check.retryAfter },
    });
  }
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        ne(users.id, me.id),
        or(
          sql`instr(lower(${users.name}), lower(${q})) > 0`,
          sql`instr(lower(${users.username}), lower(${q})) > 0`,
        ),
      ),
    )
    .orderBy(users.name)
    .limit(8);
  return rows.map((row) => publicUser(row));
});

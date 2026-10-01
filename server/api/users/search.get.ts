import { and, ne, or, sql } from "drizzle-orm";
import { runtimeDb as db } from "../../utils/client";
import { users } from "../../db/schema";
import { requireUser, publicUser } from "../../utils/auth";

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const q = String(getQuery(event).q || "").trim();
  if (q.length < 2) return [];
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

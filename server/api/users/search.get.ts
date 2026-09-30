import { and, ilike, ne, or } from "drizzle-orm";
import { db } from "../../utils/client";
import { users } from "../../db/schema";
import { requireUser, publicUser } from "../../utils/auth";

/** Escapes LIKE wildcards so a user's query cannot become a pattern. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export default defineEventHandler(async (event) => {
  const me = await requireUser(event);
  const q = String(getQuery(event).q || "").trim();
  // Require a real prefix. Without this, `q=%` matched every user and the
  // endpoint became a complete user-directory dump, 8 at a time. A one-character
  // query is refused for the same reason: 26 single-letter queries would walk
  // the entire directory.
  if (q.length < 2) return [];
  const like = `%${escapeLike(q)}%`;
  const rows = await db
    .select()
    .from(users)
    .where(
      and(ne(users.id, me.id), or(ilike(users.name, like), ilike(users.username, like))),
    )
    .orderBy(users.name)
    .limit(8);
  return rows.map((row) => publicUser(row));
});

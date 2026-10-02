import { sql } from "drizzle-orm";
import { requireAdmin } from "../../utils/auth";
import { runtimeDb as db } from "../../utils/client";
import { expenses, groups, settlements, users } from "../../db/schema";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const [u, g, e, s] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(users),
    db.select({ n: sql<number>`count(*)` }).from(groups),
    db.select({ n: sql<number>`count(*)` }).from(expenses),
    db.select({ n: sql<number>`count(*)` }).from(settlements),
  ]);
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);
  const groupRows = await db
    .select({
      id: groups.id,
      name: groups.name,
      emoji: groups.emoji,
      baseCurrency: groups.baseCurrency,
      createdAt: groups.createdAt,
    })
    .from(groups)
    .orderBy(groups.createdAt);
  return {
    counts: {
      users: u[0]?.n ?? 0,
      groups: g[0]?.n ?? 0,
      expenses: e[0]?.n ?? 0,
      settlements: s[0]?.n ?? 0,
    },
    users: userRows,
    groups: groupRows,
  };
});

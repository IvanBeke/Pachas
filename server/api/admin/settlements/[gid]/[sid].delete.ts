import { and, eq } from "drizzle-orm";
import { requireAdmin } from "../../../../utils/auth";
import { runtimeDb as db } from "../../../../utils/client";
import { settlements } from "../../../../db/schema";

// Admins can delete any settlement, regardless of creator.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const gid = String(getRouterParam(event, "gid"));
  const sid = String(getRouterParam(event, "sid"));
  const deleted = await db
    .delete(settlements)
    .where(and(eq(settlements.id, sid), eq(settlements.groupId, gid)))
    .returning({ id: settlements.id });
  if (!deleted[0]) {
    throw createError({ statusCode: 404, message: "Settlement not found." });
  }
  return { ok: true };
});

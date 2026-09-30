import { sql } from "drizzle-orm";
import { db } from "../utils/client";

export default defineEventHandler(async () => {
  await db.execute(sql`SELECT 1`);
  return { ok: true };
});

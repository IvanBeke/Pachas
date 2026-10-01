import { sql } from "drizzle-orm";
import { runtimeDb as db } from "../utils/client";

export default defineEventHandler(async () => {
  await db.get(sql`SELECT 1`);
  return { ok: true };
});

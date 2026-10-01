import { sql } from "drizzle-orm";
import { runtimeDb as db } from "../utils/client";
import { users } from "../db/schema";

function allowRegistration(): boolean {
  const v =
    useRuntimeConfig().allowRegistration ??
    process.env.ALLOW_REGISTRATION ??
    "true";
  return String(v).toLowerCase() !== "false";
}

export default defineEventHandler(async () => {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(users);
  return { allowRegistration: allowRegistration(), hasUsers: (rows[0]?.n ?? 0) > 0 };
});

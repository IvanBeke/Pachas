import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

// Runtime drizzle client. @nuxthub/db remains the system of record for the
// schema (server/db/schema.ts) and migrations, but its generated client
// inlines DATABASE_URL at build time, which breaks credential-less Docker
// builds. This client resolves the URL lazily at runtime instead.
let _db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "[pachas] DATABASE_URL is not set. See compose.yaml / README.md.",
      );
    }
    _db = drizzle({
      client: postgres(url, { onnotice: () => {} }),
      schema,
      casing: "snake_case",
    });
  }
  return _db;
}

// Drop-in replacement for `db` from "@nuxthub/db".
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {},
  { get(_, prop) { return getDb()[prop as keyof object]; } },
) as PostgresJsDatabase<typeof schema>;

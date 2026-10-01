// Applies Drizzle SQL migrations at container startup (see entrypoint.sh).
// Journal-driven: each migration in meta/_journal.json is applied once and
// recorded in drizzle.__drizzle_migrations. Individual statements tolerate
// "already exists" errors so the baseline also lands on databases created by
// the pre-Drizzle app (whose CREATE TABLE IF NOT EXISTS bootstrap already
// created the same tables).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[pachas] DATABASE_URL is not set. See compose.yaml / README.md.");
  process.exit(1);
}

// Postgres error codes that mean "this step already had an effect":
// 42P07 duplicate_table/duplicate_index, 42701 duplicate_column,
// 42710 duplicate_object (constraints).
const TOLERATED = new Set(["42P07", "42701", "42710"]);
const GROUP_ROLE_BACKFILL = "0006_blue_hellfire_club";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "postgresql");
const journal = JSON.parse(
  readFileSync(join(dir, "meta", "_journal.json"), "utf8"),
);

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  const applied = new Set(
    (await sql`SELECT hash FROM drizzle.__drizzle_migrations`).map((r) => r.hash),
  );

  for (const entry of journal.entries) {
    const tag = entry.tag;
    const hash = `${entry.idx}_${tag}`;
    if (applied.has(tag) || applied.has(hash)) {
      continue;
    }
    const file = join(dir, `${tag}.sql`);
    if (!existsSync(file)) {
      console.error(`[pachas] migration file missing: ${tag}.sql`);
      process.exit(1);
    }
    const statements = readFileSync(file, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
      } catch (e) {
        if (e?.code && TOLERATED.has(String(e.code))) continue;
        throw e;
      }
    }
    // Data backfills live beside their schema version without hand-editing
    // Drizzle-generated SQL. This one maps existing group creators to their
    // new creator membership role (and repairs any legacy groups missing that
    // membership row) exactly once, when the role column is introduced.
    if (tag === GROUP_ROLE_BACKFILL) {
      await sql`
        UPDATE groups AS g
        SET created_by = (
          SELECT gm.user_id
          FROM group_members AS gm
          WHERE gm.group_id = g.id
          ORDER BY gm.user_id
          LIMIT 1
        )
        WHERE g.created_by IS NULL
          AND EXISTS (SELECT 1 FROM group_members AS gm WHERE gm.group_id = g.id)
      `;
      await sql`
        INSERT INTO group_members (group_id, user_id, role)
        SELECT g.id, g.created_by, 'creator'::group_role
        FROM groups AS g
        WHERE g.created_by IS NOT NULL
        ON CONFLICT (group_id, user_id)
        DO UPDATE SET role = 'creator'::group_role
      `;
    }
    await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${tag}, ${Date.now()})`;
    console.log(`[pachas] applied migration ${tag}`);
  }
  console.log("[pachas] database migrations applied");
} finally {
  await sql.end();
}

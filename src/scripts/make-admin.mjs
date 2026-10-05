// Promotes (or with --revoke, demotes) an existing account to site admin.
// Usage: node scripts/make-admin.mjs [--revoke] <username>
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const username = args.find((a) => !a.startsWith("--"));
if (!username) {
  console.error("Usage: make-admin [--revoke] <username>");
  process.exit(2);
}

const databasePath = resolve(
  process.env.DATABASE_PATH?.trim() || "/data/pachas.sqlite",
);
const database = new DatabaseSync(databasePath, { timeout: 5_000 });
try {
  const result = database
    .prepare("UPDATE users SET role = ? WHERE lower(username) = lower(?)")
    .run(revoke ? "user" : "admin", username);
  if (result.changes === 0) {
    console.error(`[pachas] no user named "${username}". Register the account first.`);
    process.exit(1);
  }
  console.log(
    `[pachas] ${username} is ${revoke ? "no longer" : "now"} a site admin.`,
  );
} finally {
  database.close();
}

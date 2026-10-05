// Removes accounts and groups created by the API contract suite.
//
// Test accounts all start with `__t` (see tests/api.contract.test.ts). Groups
// are removed only when every member is a test account, so a real group is
// never touched. Not shipped in the production image; refuses to run there.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "production") {
  console.error("[pachas] cleanup-test-data refuses to run with NODE_ENV=production.");
  process.exit(1);
}

const TEST_USER = "substr(username, 1, 3) = '__t'";

const databasePath = resolve(
  process.env.DATABASE_PATH?.trim() || "/data/pachas.sqlite",
);
const database = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
  timeout: 5_000,
});

try {
  database.exec("BEGIN IMMEDIATE");
  database.exec(`
    DELETE FROM groups WHERE id IN (
      SELECT gm.group_id FROM group_members gm
      GROUP BY gm.group_id
      HAVING SUM(gm.user_id NOT IN (SELECT id FROM users WHERE ${TEST_USER})) = 0
    )
  `);
  database.exec(`
    UPDATE categories SET created_by = NULL
    WHERE created_by IN (SELECT id FROM users WHERE ${TEST_USER})
  `);
  const deleted = database.prepare(`DELETE FROM users WHERE ${TEST_USER}`).run();
  database.exec("COMMIT");
  console.log(`Removed ${deleted.changes} API-test users and their groups.`);
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

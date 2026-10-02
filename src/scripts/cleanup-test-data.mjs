import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const databasePath = resolve(
  process.env.DATABASE_PATH?.trim() || "/data/pachas.sqlite",
);
const database = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
  timeout: 5_000,
});

try {
  database.exec("BEGIN IMMEDIATE");
  database.exec("DELETE FROM groups WHERE substr(name, 1, 2) = '__'");
  database.exec(`
    UPDATE categories SET created_by = NULL
    WHERE created_by IN (
      SELECT id FROM users
      WHERE substr(username, 1, 3) IN ('own', 'oth', 'str')
        AND length(username) >= 10
    )
  `);
  const deleted = database.prepare(`
    DELETE FROM users
    WHERE substr(username, 1, 3) IN ('own', 'oth', 'str')
      AND length(username) >= 10
  `).run();
  database.exec("COMMIT");
  console.log(`Removed ${deleted.changes} API-test users and their reserved groups.`);
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

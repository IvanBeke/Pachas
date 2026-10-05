import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATABASE_PATH = "/data/pachas.sqlite";
const databasePath = resolve(
  process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
);
mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
  timeout: 5_000,
});
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA synchronous = NORMAL");

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagedMigrationsDir = join(appRoot, "migrations", "sqlite");
const sourceMigrationsDir = join(
  appRoot,
  "server",
  "db",
  "migrations",
  "sqlite",
);
// PACHAS_MIGRATIONS_DIR is a test seam for running a partial journal.
const migrationsDir = process.env.PACHAS_MIGRATIONS_DIR
  ? resolve(process.env.PACHAS_MIGRATIONS_DIR)
  : existsSync(packagedMigrationsDir)
    ? packagedMigrationsDir
    : sourceMigrationsDir;
const journal = JSON.parse(
  readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
);

database.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )
`);
const applied = new Set(
  database
    .prepare("SELECT hash FROM __drizzle_migrations")
    .all()
    .map((row) => row.hash),
);

try {
  for (const entry of journal.entries) {
    if (applied.has(entry.tag)) continue;
    const migrationPath = join(migrationsDir, `${entry.tag}.sql`);
    const statements = readFileSync(migrationPath, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    // SQLite's documented table-rebuild procedure: `PRAGMA foreign_keys` is a
    // no-op inside a transaction, so it is switched off around it. Otherwise
    // `DROP TABLE` on a rebuilt parent table would cascade-delete child rows.
    // Integrity is re-verified with foreign_key_check before committing.
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) database.exec(statement);
      const violations = database.prepare("PRAGMA foreign_key_check").all();
      if (violations.length) {
        throw new Error(
          `foreign key violations after ${entry.tag}: ${JSON.stringify(violations.slice(0, 5))}`,
        );
      }
      database
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(entry.tag, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
    console.log(`[pachas] applied SQLite migration ${entry.tag}`);
  }

  const builtInCategories = [
    ["General", "🧾", "General"],
    ["Comida", "🍜", "Food"],
    ["Supermercado", "🛒", "Groceries"],
    ["Transporte", "🚕", "Transport"],
    ["Vivienda", "🏠", "Housing"],
    ["Suministros", "💡", "Utilities"],
    ["Ocio", "🎬", "Entertainment"],
    ["Viajes", "✈️", "Travel"],
    ["Compras", "🛍️", "Shopping"],
  ];
  const findCategory = database.prepare(
    "SELECT id FROM categories WHERE title = ? ORDER BY id LIMIT 1",
  );
  const insertCategory = database.prepare(
    "INSERT INTO categories (title, icon, position) VALUES (?, ?, ?)",
  );
  const insertTranslation = database.prepare(
    "INSERT INTO category_translations (category_id, locale, title) VALUES (?, 'en', ?) " +
      "ON CONFLICT (category_id, locale) DO NOTHING",
  );
  for (const [position, [title, icon, englishTitle]] of builtInCategories.entries()) {
    let category = findCategory.get(title);
    if (!category) {
      insertCategory.run(title, icon, position);
      category = { id: Number(database.prepare("SELECT last_insert_rowid() AS id").get().id) };
    }
    insertTranslation.run(category.id, englishTitle);
  }

  console.log(`[pachas] SQLite database ready at ${databasePath}`);
} finally {
  database.close();
}

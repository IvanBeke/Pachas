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
const migrationsDir = existsSync(packagedMigrationsDir)
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

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) database.exec(statement);
      database
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(entry.tag, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
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

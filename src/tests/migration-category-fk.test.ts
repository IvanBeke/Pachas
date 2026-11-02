import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

/**
 * 0007 turns `expenses.category` and `recurring_expenses.category` from free
 * text into foreign keys to `categories`. Runs the real migration script against
 * a database that is one migration behind, holding the messy values the text
 * column allowed.
 */
const root = resolve(__dirname, "..");
const source = join(root, "server/db/migrations/sqlite");
const work = mkdtempSync(join(tmpdir(), "pachas-category-fk-"));

afterAll(() => rmSync(work, { recursive: true, force: true }));

function migrate(dbPath: string, dir: string) {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: dbPath, PACHAS_MIGRATIONS_DIR: dir },
    stdio: "pipe",
  });
}

/** A copy of the migrations without 0007, so a database can be seeded "before" it. */
function partialMigrations(): string {
  const partial = join(work, "partial");
  cpSync(source, partial, { recursive: true });
  const journalPath = join(partial, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith("0007"));
  expect(idx).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, idx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return partial;
}

function seed(dbPath: string, prepare: (db: DatabaseSync) => void = () => {}) {
  const db = new DatabaseSync(dbPath);
  prepare(db);
  db.exec(`
    INSERT INTO users (id, username, name, password_hash, role, created_at)
      VALUES ('a','alice','A','x','user',1);
    INSERT INTO groups (id, name, base_currency, created_by, created_at)
      VALUES ('g','G','EUR','a',1);
    INSERT INTO expenses (id, group_id, title, description, amount, currency, exchange_rate,
        amount_base, paid_by, category, date, split_type, created_by, created_at)
      VALUES ('legacy','g','t','',1000,'EUR',1,1000,'a','general','2026-01-01','equal','a',1),
             ('numeric','g','t','',1000,'EUR',1,1000,'a','2','2026-01-02','equal','a',2),
             ('ghost','g','t','',1000,'EUR',1,1000,'a','999','2026-01-03','equal','a',3),
             ('junk','g','t','',1000,'EUR',1,1000,'a','2x','2026-01-04','equal','a',4),
             ('empty','g','t','',1000,'EUR',1,1000,'a','','2026-01-05','equal','a',5);
    INSERT INTO expense_splits (expense_id, user_id, amount)
      VALUES ('legacy','a',1000), ('numeric','a',1000);
    INSERT INTO recurring_expenses (id, group_id, title, description, amount, currency,
        exchange_rate, amount_base, paid_by, category, split_type, splits, recurrence,
        start_date, created_by, created_at)
      VALUES ('r-legacy','g','Rent','',1000,'EUR',1,1000,'a','general','equal','{"a":1000}',
        'month','2026-01-01','a',1),
             ('r-numeric','g','Gym','',1000,'EUR',1,1000,'a','3','equal','{"a":1000}',
        'month','2026-01-01','a',1),
             ('r-ghost','g','Gone','',1000,'EUR',1,1000,'a','999','equal','{"a":1000}',
        'month','2026-01-01','a',1);
  `);
  db.close();
}

const run = <T>(dbPath: string, sql: string) => {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(sql).all() as T[];
  db.close();
  return rows;
};

const categoriesOf = (dbPath: string, table: "expenses" | "recurring_expenses") =>
  Object.fromEntries(
    run<{ id: string; category: number }>(dbPath, `SELECT id, category FROM ${table}`).map((r) => [
      r.id,
      r.category,
    ]),
  );

describe("0007 category foreign key", () => {
  it("keeps real ids and moves everything else to General", () => {
    const dbPath = join(work, "a.sqlite");
    migrate(dbPath, partialMigrations());
    seed(dbPath);
    migrate(dbPath, source);

    const general = run<{ id: number }>(dbPath, "SELECT id FROM categories WHERE title = 'General'")[0]!.id;
    expect(categoriesOf(dbPath, "expenses")).toEqual({
      legacy: general,
      numeric: 2,
      ghost: general,
      junk: general,
      empty: general,
    });
    expect(categoriesOf(dbPath, "recurring_expenses")).toEqual({
      "r-legacy": general,
      "r-numeric": 3,
      "r-ghost": general,
    });
    // An integer column now, not text.
    expect(
      run<{ t: string }>(dbPath, "SELECT DISTINCT typeof(category) AS t FROM expenses"),
    ).toEqual([{ t: "integer" }]);
  });

  it("does not lose child rows or break any foreign key", () => {
    const dbPath = join(work, "b.sqlite");
    migrate(dbPath, partialMigrations());
    seed(dbPath);
    migrate(dbPath, source);

    expect(run(dbPath, "SELECT * FROM expense_splits")).toHaveLength(2);
    expect(run(dbPath, "SELECT * FROM expenses")).toHaveLength(5);
    expect(run(dbPath, "PRAGMA foreign_key_check")).toHaveLength(0);
  });

  it("enforces the foreign key afterwards", () => {
    const dbPath = join(work, "c.sqlite");
    migrate(dbPath, partialMigrations());
    seed(dbPath);
    migrate(dbPath, source);

    const db = new DatabaseSync(dbPath);
    const insert = (id: string, category: number) =>
      db
        .prepare(
          `INSERT INTO expenses (id, group_id, title, description, amount, currency, exchange_rate,
             amount_base, paid_by, category, date, split_type, created_by, created_at)
           VALUES (?, 'g','t','',1,'EUR',1,1,'a',?,'2026-02-01','equal','a',9)`,
        )
        .run(id, category);
    expect(() => insert("bad", 424242)).toThrow(/FOREIGN KEY/i);
    expect(() => insert("ok", 2)).not.toThrow();
    // A category that expenses use cannot be deleted from under them.
    expect(() => db.exec("DELETE FROM categories WHERE id = 2")).toThrow(/FOREIGN KEY/i);
    db.close();
  });

  it("creates General first when it is missing, e.g. renamed by an admin", () => {
    const dbPath = join(work, "d.sqlite");
    migrate(dbPath, partialMigrations());
    seed(dbPath, (db) => db.exec("UPDATE categories SET title = 'Todo' WHERE title = 'General'"));
    migrate(dbPath, source);

    const general = run<{ id: number }>(dbPath, "SELECT id FROM categories WHERE title = 'General'");
    expect(general).toHaveLength(1);
    const expenses = categoriesOf(dbPath, "expenses");
    expect(expenses.legacy).toBe(general[0]!.id);
    expect(expenses.ghost).toBe(general[0]!.id);
    // The renamed category is untouched, and rows that pointed at a real id keep it.
    expect(run(dbPath, "SELECT id FROM categories WHERE title = 'Todo'")).toHaveLength(1);
    expect(expenses.numeric).toBe(2);
    expect(run(dbPath, "PRAGMA foreign_key_check")).toHaveLength(0);
  });
});

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

/**
 * 0009 adds `groups.rounding_cursor` and `recurring_expenses.split_input`; it
 * converts nothing, so existing rows must survive with the column defaults.
 */
const root = resolve(__dirname, "..");
const source = join(root, "server/db/migrations/sqlite");
const work = mkdtempSync(join(tmpdir(), "pachas-rounding-"));
const dbPath = join(work, "test.sqlite");

afterAll(() => rmSync(work, { recursive: true, force: true }));

function migrate(dir: string) {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: dbPath, PACHAS_MIGRATIONS_DIR: dir },
    stdio: "pipe",
  });
}

/** A copy of the migrations that stops before the first entry starting with `prefix`. */
function journalBefore(prefix: string): string {
  const dir = join(work, `before-${prefix}`);
  cpSync(source, dir, { recursive: true });
  const journalPath = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith(prefix));
  journal.entries = journal.entries.slice(0, idx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("0009 rounding migration", () => {
  it("keeps existing groups and templates, with the cursor at 0 and no stored split input", () => {
    const partial = join(work, "partial");
    cpSync(source, partial, { recursive: true });
    const journalPath = join(partial, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith("0009"));
    expect(idx).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, idx);
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(partial);

    const db = new DatabaseSync(dbPath);
    const categoryId = (db.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").get() as { id: number }).id;
    db.exec(`
      INSERT INTO users (id, username, name, password_hash, role, created_at)
        VALUES ('a','alice','A','x','user',1);
      INSERT INTO groups (id, name, base_currency, created_by, created_at)
        VALUES ('g','G','EUR','a',1);
      INSERT INTO recurring_expenses (id, group_id, title, description, amount, currency,
          exchange_rate, amount_base, paid_by, category, split_type, splits, recurrence,
          start_date, created_by, created_at)
        VALUES ('r1','g','Rent','',10000,'EUR',1,10000,'a',${categoryId},'equal',
          '{"a":10000}','month','2026-01-01','a',1);
    `);
    db.close();

    migrate(journalBefore("0010"));

    const after = new DatabaseSync(dbPath);
    expect(after.prepare("SELECT id, rounding_cursor FROM groups").all()).toEqual([
      { id: "g", rounding_cursor: 0 },
    ]);
    expect(after.prepare("SELECT id, split_input, splits FROM recurring_expenses").all()).toEqual([
      { id: "r1", split_input: null, splits: '{"a":10000}' },
    ]);
    after.close();
  });
});

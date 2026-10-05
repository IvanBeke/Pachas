import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Runs the real migration script against a database that holds data in the
 * pre-0004 shape (REAL decimal amounts), and checks the conversion to integer
 * cents: values survive, child rows are not cascade-deleted by the table
 * rebuilds, and shares that were off by a cent are reconciled.
 */
const root = resolve(__dirname, "..");
const source = join(root, "server/db/migrations/sqlite");
const work = mkdtempSync(join(tmpdir(), "pachas-migrate-"));
const dbPath = join(work, "test.sqlite");

function migrate(dir: string) {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: dbPath, PACHAS_MIGRATIONS_DIR: dir },
    stdio: "pipe",
  });
}

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("0004 cents migration", () => {
  it("converts amounts to cents without losing child rows", () => {
    // 1. Apply only the migrations before 0004.
    const partial = join(work, "partial");
    cpSync(source, partial, { recursive: true });
    const journalPath = join(partial, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith("0004"));
    journal.entries = journal.entries.slice(0, idx);
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(partial);

    // 2. Seed float data, including one expense whose shares are a cent off.
    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO users (id, username, name, password_hash, role, created_at)
        VALUES ('a','alice','A','x','user',1), ('b','bob','B','x','user',1);
      INSERT INTO groups (id, name, base_currency, created_by, created_at)
        VALUES ('g','G','EUR','a',1);
      INSERT INTO group_members (group_id, user_id, role)
        VALUES ('g','a','creator'), ('g','b','member');
      INSERT INTO expenses (id, group_id, title, description, amount, currency, exchange_rate,
          amount_base, paid_by, category, date, split_type, created_by, created_at)
        VALUES ('e1','g','Dinner','',10.01,'EUR',1,10.01,'a','general','2026-01-01','equal','a',1),
               ('e2','g','Taxi','',10,'EUR',1,10,'b','general','2026-01-02','exact','b',2);
      INSERT INTO expense_splits (expense_id, user_id, amount)
        VALUES ('e1','a',5.01), ('e1','b',5), ('e2','a',4.99), ('e2','b',5);
      INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_by, created_at)
        VALUES ('s1','g','b','a',0.3,'b',3);
      INSERT INTO settlement_allocations (settlement_id, debtor_id, creditor_id, amount)
        VALUES ('s1','b','a',0.3);
      INSERT INTO recurring_expenses (id, group_id, title, description, amount, currency,
          exchange_rate, amount_base, paid_by, category, split_type, splits, recurrence,
          start_date, created_by, created_at)
        VALUES ('r1','g','Rent','',1200.5,'EUR',1,1200.5,'a','general','equal',
          '{"a":600.25,"b":600.25}','month','2026-01-01','a',1);
    `);
    db.close();

    // 3. Apply the full journal.
    migrate(source);

    const after = new DatabaseSync(dbPath);
    const one = <T>(sql: string) => after.prepare(sql).get() as T;
    const all = <T>(sql: string) => after.prepare(sql).all() as T[];

    expect(one<{ amount: number; amount_base: number }>(
      "SELECT amount, amount_base FROM expenses WHERE id = 'e1'",
    )).toEqual({ amount: 1001, amount_base: 1001 });
    expect(all("SELECT * FROM expense_splits")).toHaveLength(4);
    expect(all("SELECT * FROM settlement_allocations")).toHaveLength(1);
    expect(one<{ amount: number }>("SELECT amount FROM settlements").amount).toBe(30);

    // e2 was 9.99 of shares on a 10.00 expense; the largest share absorbs it.
    const e2 = all<{ user_id: string; amount: number }>(
      "SELECT user_id, amount FROM expense_splits WHERE expense_id = 'e2' ORDER BY user_id",
    );
    expect(e2).toEqual([
      { user_id: "a", amount: 499 },
      { user_id: "b", amount: 501 },
    ]);
    // Every expense now reconciles exactly.
    expect(
      all(`SELECT e.id FROM expenses e
           WHERE e.amount_base != (SELECT SUM(amount) FROM expense_splits WHERE expense_id = e.id)`),
    ).toHaveLength(0);

    const r1 = one<{ amount: number; splits: string; generated_through: string }>(
      "SELECT amount, splits, generated_through FROM recurring_expenses",
    );
    expect(r1.amount).toBe(120050);
    expect(JSON.parse(r1.splits)).toEqual({ a: 60025, b: 60025 });
    // Existing templates start generating from the migration date, not from
    // their start date, so upgrading doesn't back-fill months of expenses.
    expect(r1.generated_through).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(all("PRAGMA foreign_key_check")).toHaveLength(0);
    after.close();
  });
});

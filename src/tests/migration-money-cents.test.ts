import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

/**
 * 0010 moves storage back from mills to cents. Every amount is divided by 10;
 * anything with a third decimal is rounded and the shares are reallocated so every
 * expense, settlement and template still sums exactly. Runs the real migration
 * script on a database one migration behind.
 */
const root = resolve(__dirname, "..");
const source = join(root, "server/db/migrations/sqlite");
const work = mkdtempSync(join(tmpdir(), "pachas-money-cents-"));
const dbPath = join(work, "test.sqlite");

afterAll(() => rmSync(work, { recursive: true, force: true }));

function migrate(dir: string) {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: dbPath, PACHAS_MIGRATIONS_DIR: dir },
    stdio: "pipe",
  });
}

describe("0010 money cents migration", () => {
  it("divides by 10, rounds third decimals and keeps every total exact", () => {
    const partial = join(work, "partial");
    cpSync(source, partial, { recursive: true });
    const journalPath = join(partial, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith("0010"));
    expect(idx).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, idx);
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(partial);

    const db = new DatabaseSync(dbPath);
    const cat = (db.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").get() as { id: number }).id;
    const expense = (id: string, group: string, amount: number, base: number, created: number, currency = "EUR") =>
      `INSERT INTO expenses (id, group_id, title, description, amount, currency, exchange_rate,
          amount_base, paid_by, category, date, split_type, created_by, created_at)
        VALUES ('${id}','${group}','${id}','',${amount},'${currency}',1,${base},'a',${cat},'2026-01-01','equal','a',${created});`;
    const splits = (id: string, ...mills: number[]) =>
      `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ${mills
        .map((m, i) => `('${id}','${"abc"[i]}',${m})`)
        .join(",")};`;
    db.exec(`
      INSERT INTO users (id, username, name, password_hash, role, created_at)
        VALUES ('a','a','A','x','user',1), ('b','b','B','x','user',1), ('c','c','C','x','user',1);
      INSERT INTO groups (id, name, base_currency, created_by, created_at)
        VALUES ('open','Open','EUR','a',1), ('settled','Settled','EUR','a',1);
      INSERT INTO group_members (group_id, user_id, role)
        VALUES ('open','a','creator'), ('open','b','member'), ('open','c','member'),
               ('settled','a','creator'), ('settled','b','member'), ('settled','c','member');

      ${expense("third", "open", 10_000, 10_000, 1)}        ${splits("third", 3334, 3333, 3333)}
      ${expense("half1", "open", 10_010, 10_010, 2)}        ${splits("half1", 5005, 5005)}
      ${expense("half2", "open", 10_010, 10_010, 3)}        ${splits("half2", 5005, 5005)}
      ${expense("percent", "open", 34_100, 34_100, 4)}      ${splits("percent", 8867, 8893, 16_340)}
      ${expense("cents", "open", 9_000, 9_000, 5)}          ${splits("cents", 3000, 3000, 3000)}
      ${expense("usd", "open", 10_000, 9_213, 6, "USD")}    ${splits("usd", 4607, 4606)}
      ${expense("old", "settled", 10_000, 10_000, 1)}       ${splits("old", 3334, 3333, 3333)}
      INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_by, created_at)
        VALUES ('s1','settled','b','a',3333,'b',9);
      INSERT INTO settlement_allocations (settlement_id, debtor_id, creditor_id, amount)
        VALUES ('s1','b','a',3333);
      INSERT INTO recurring_expenses (id, group_id, title, description, amount, currency,
          exchange_rate, amount_base, paid_by, category, split_type, splits, recurrence,
          start_date, created_by, created_at)
        VALUES ('r1','open','Rent','',120050,'EUR',1,120050,'a',${cat},'equal',
          '{"a":60025,"b":60025}','month','2026-01-01','a',1);
    `);
    db.close();

    migrate(source);

    const after = new DatabaseSync(dbPath);
    const shares = (id: string) =>
      Object.fromEntries(
        (
          after
            .prepare("SELECT user_id, amount FROM expense_splits WHERE expense_id = ? ORDER BY user_id")
            .all(id) as { user_id: string; amount: number }[]
        ).map((r) => [r.user_id, r.amount]),
      );

    expect(shares("third")).toEqual({ a: 334, b: 333, c: 333 });
    expect(shares("percent")).toEqual({ a: 887, b: 889, c: 1634 });
    // Half cents alternate between the two people.
    expect(shares("half1")).toEqual({ a: 501, b: 500 });
    expect(shares("half2")).toEqual({ a: 500, b: 501 });
    expect(shares("cents")).toEqual({ a: 300, b: 300, c: 300 });
    // 9.213 € rounds to 9.21 €, and its shares are reallocated to it.
    expect(shares("usd")).toEqual({ a: 461, b: 460 });
    // Settled groups are rounded too.
    expect(shares("old")).toEqual({ a: 334, b: 333, c: 333 });

    expect(
      after.prepare("SELECT id, amount, amount_base FROM expenses WHERE id IN ('usd','half1','cents') ORDER BY id").all(),
    ).toEqual([
      { id: "cents", amount: 900, amount_base: 900 },
      { id: "half1", amount: 1001, amount_base: 1001 },
      { id: "usd", amount: 1000, amount_base: 921 },
    ]);
    expect(after.prepare("SELECT amount FROM settlements").all()).toEqual([{ amount: 333 }]);
    expect(after.prepare("SELECT amount FROM settlement_allocations").all()).toEqual([{ amount: 333 }]);
    const r1 = after.prepare("SELECT amount, amount_base, splits FROM recurring_expenses").get() as {
      amount: number;
      amount_base: number;
      splits: string;
    };
    expect(r1.amount).toBe(12_005);
    expect(r1.amount_base).toBe(12_005);
    expect(JSON.parse(r1.splits)).toEqual({ a: 6003, b: 6002 });

    // Every expense still adds up exactly and nothing was dropped.
    expect(
      after
        .prepare(
          `SELECT e.id FROM expenses e
           WHERE e.amount_base != (SELECT SUM(amount) FROM expense_splits WHERE expense_id = e.id)`,
        )
        .all(),
    ).toHaveLength(0);
    expect(after.prepare("SELECT COUNT(*) AS n FROM expense_splits").get()).toEqual({ n: 3 + 2 + 2 + 3 + 3 + 2 + 3 });
    expect(after.prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master").get()).toEqual({ n: 0 });
    expect(after.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    after.close();
  });
});

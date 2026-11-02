import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import {
  balancesFromPairwiseDebts,
  buildPairwiseDebts,
} from "../server/utils/settlement-ledger";

/**
 * 0008 moves every stored amount from cents to mills (thousandths), so each
 * value is multiplied by 10. Runs the real migration script against a database
 * one migration behind, and checks nothing is lost and nothing stops adding up.
 */
const root = resolve(__dirname, "..");
const source = join(root, "server/db/migrations/sqlite");
const work = mkdtempSync(join(tmpdir(), "pachas-mills-"));
const dbPath = join(work, "test.sqlite");

afterAll(() => rmSync(work, { recursive: true, force: true }));

function migrate(dir: string) {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_PATH: dbPath, PACHAS_MIGRATIONS_DIR: dir },
    stdio: "pipe",
  });
}

describe("0008 mills migration", () => {
  it("multiplies every stored amount by 10 and keeps the ledger balanced", () => {
    // 1. Apply every migration before 0008.
    const partial = join(work, "partial");
    cpSync(source, partial, { recursive: true });
    const journalPath = join(partial, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.startsWith("0008"));
    expect(idx).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, idx);
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(partial);

    // 2. Seed cents data: an odd split, a settlement with its allocation, a recurring template.
    const db = new DatabaseSync(dbPath);
    const categoryId = (db.prepare("SELECT id FROM categories ORDER BY id LIMIT 1").get() as { id: number }).id;
    db.exec(`
      INSERT INTO users (id, username, name, password_hash, role, created_at)
        VALUES ('a','alice','A','x','user',1), ('b','bob','B','x','user',1);
      INSERT INTO groups (id, name, base_currency, created_by, created_at)
        VALUES ('g','G','EUR','a',1);
      INSERT INTO group_members (group_id, user_id, role)
        VALUES ('g','a','creator'), ('g','b','member');
      INSERT INTO expenses (id, group_id, title, description, amount, currency, exchange_rate,
          amount_base, paid_by, category, date, split_type, created_by, created_at)
        VALUES ('e1','g','Dinner','',1001,'EUR',1,1001,'a',${categoryId},'2026-01-01','equal','a',1),
               ('e2','g','Taxi','',1000,'USD',0.92,920,'b',${categoryId},'2026-01-02','equal','b',2);
      INSERT INTO expense_splits (expense_id, user_id, amount)
        VALUES ('e1','a',501), ('e1','b',500), ('e2','a',460), ('e2','b',460);
      INSERT INTO settlements (id, group_id, from_user, to_user, amount, created_by, created_at)
        VALUES ('s1','g','b','a',30,'b',3);
      INSERT INTO settlement_allocations (settlement_id, debtor_id, creditor_id, amount)
        VALUES ('s1','b','a',30);
      INSERT INTO recurring_expenses (id, group_id, title, description, amount, currency,
          exchange_rate, amount_base, paid_by, category, split_type, splits, recurrence,
          start_date, created_by, created_at)
        VALUES ('r1','g','Rent','',120050,'EUR',1,120050,'a',${categoryId},'equal',
          '{"a":60025,"b":60025}','month','2026-01-01','a',1);
    `);
    const balancesBefore = balances(db, 100);
    db.close();

    // 3. Apply 0008.
    migrate(source);

    const after = new DatabaseSync(dbPath);
    const all = <T>(sql: string) => after.prepare(sql).all() as T[];
    expect(all("SELECT id, amount, amount_base FROM expenses ORDER BY id")).toEqual([
      { id: "e1", amount: 10010, amount_base: 10010 },
      { id: "e2", amount: 10000, amount_base: 9200 },
    ]);
    expect(all("SELECT user_id, amount FROM expense_splits WHERE expense_id = 'e1' ORDER BY user_id")).toEqual([
      { user_id: "a", amount: 5010 },
      { user_id: "b", amount: 5000 },
    ]);
    expect(all("SELECT amount FROM settlements")).toEqual([{ amount: 300 }]);
    expect(all("SELECT amount FROM settlement_allocations")).toEqual([{ amount: 300 }]);
    const r1 = all<{ amount: number; amount_base: number; splits: string }>(
      "SELECT amount, amount_base, splits FROM recurring_expenses",
    )[0]!;
    expect(r1.amount).toBe(1200500);
    expect(r1.amount_base).toBe(1200500);
    expect(JSON.parse(r1.splits)).toEqual({ a: 600250, b: 600250 });

    // Nothing was dropped, every expense still adds up exactly, and balances are unchanged.
    expect(all("SELECT * FROM expense_splits")).toHaveLength(4);
    expect(
      all(`SELECT e.id FROM expenses e
           WHERE e.amount_base != (SELECT SUM(amount) FROM expense_splits WHERE expense_id = e.id)`),
    ).toHaveLength(0);
    expect(balances(after, 1000)).toEqual(balancesBefore);
    expect(all("PRAGMA foreign_key_check")).toHaveLength(0);
    after.close();
  });
});

/** Group balances computed from the raw rows, in major units, for a given storage scale. */
function balances(db: DatabaseSync, scale: number) {
  const splits = db
    .prepare("SELECT e.paid_by AS paidBy, s.user_id AS userId, s.amount AS amount FROM expenses e JOIN expense_splits s ON s.expense_id = e.id")
    .all() as { paidBy: string; userId: string; amount: number }[];
  const byExpense = new Map<string, { paidBy: string; splits: Record<string, number> }>();
  splits.forEach((r, i) => {
    const key = `${r.paidBy}#${i}`;
    byExpense.set(key, { paidBy: r.paidBy, splits: { [r.userId]: r.amount / scale } });
  });
  const allocations = (
    db.prepare("SELECT debtor_id AS debtorId, creditor_id AS creditorId, amount FROM settlement_allocations").all() as {
      debtorId: string;
      creditorId: string;
      amount: number;
    }[]
  ).map((a) => ({ ...a, amount: a.amount / scale }));
  return balancesFromPairwiseDebts(buildPairwiseDebts([...byExpense.values()], allocations));
}

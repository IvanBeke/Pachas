import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { roundingRing } from "../shared/splits";
import { toCents } from "../shared/money";

/**
 * The round-robin cursor against a real database: it moves when an expense is
 * created or an occurrence is generated, and never on an edit.
 */
const root = resolve(__dirname, "..");
const work = mkdtempSync(join(tmpdir(), "pachas-rr-"));
process.env.DATABASE_PATH = join(work, "test.sqlite");

type Groups = typeof import("../server/utils/groups");
type Input = typeof import("../server/utils/expense-input");
type RecInput = typeof import("../server/utils/recurring-input");
type Recurring = typeof import("../server/utils/recurring");
type Client = typeof import("../server/utils/client");
type Cats = typeof import("../server/utils/categories");
let g: Groups;
let input: Input;
let recInput: RecInput;
let recurring: Recurring;
let client: Client;
let cats: Cats;

const A = "u-a";
const B = "u-b";
const C = "u-c";
const MEMBERS = [A, B, C];

beforeAll(async () => {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env },
    stdio: "pipe",
  });
  client = await import("../server/utils/client");
  await client.initializeRuntimeDb();
  g = await import("../server/utils/groups");
  input = await import("../server/utils/expense-input");
  recInput = await import("../server/utils/recurring-input");
  recurring = await import("../server/utils/recurring");
  cats = await import("../server/utils/categories");
  for (const id of MEMBERS) {
    await client.runtimeDb.$client.execute({
      sql: "INSERT INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'user', 1)",
      args: [id, id, id],
    });
  }
});

afterAll(async () => {
  await client.closeRuntimeDb();
  rmSync(work, { recursive: true, force: true });
});

const newGroup = async () => (await g.createGroup("G", "", "EUR", A, MEMBERS))!;

const body = (over: Record<string, unknown> = {}) => ({
  title: "Dinner",
  amount: 10,
  paidBy: A,
  date: "2026-01-01",
  splitType: "equal",
  participants: MEMBERS,
  ...over,
});

async function add(gid: string, over: Record<string, unknown> = {}) {
  const categories = await cats.loadCategoryContext();
  return g.createExpense(
    gid,
    (group) =>
      input.readExpenseInput(
        body(over),
        group.memberIds,
        group.baseCurrency,
        categories,
        roundingRing(group.memberIds, group.roundingCursor),
      ),
    A,
  );
}

const cursorOf = async (gid: string) => (await g.getGroupById(gid))!.roundingCursor;
const splitsOf = async (gid: string, eid: string) =>
  (await g.getExpenses(gid)).find((e) => e.id === eid)!.splits;
const holder = (splits: Record<string, number>) =>
  Object.entries(splits).find(([, v]) => v === Math.max(...Object.values(splits)))?.[0];

describe("round robin (database)", () => {
  it("gives the extra cent to a different person on each new expense", async () => {
    const { id: gid } = await newGroup();
    const holders: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const eid = await add(gid, { title: `e${i}` });
      const splits = await splitsOf(gid, eid);
      expect(Object.values(splits).reduce((x, y) => x + toCents(y), 0)).toBe(1000);
      holders.push(holder(splits));
    }
    expect(holders).toEqual([A, B, C]);
    expect(await cursorOf(gid)).toBe(0);
  });

  it("does not move the cursor for an exact split or an evenly divisible one", async () => {
    const { id: gid } = await newGroup();
    await add(gid, { amount: 9 });
    await add(gid, { splitType: "exact", values: { [A]: 5, [B]: 3, [C]: 2 } });
    expect(await cursorOf(gid)).toBe(0);
  });

  it("recomputes an edit with the current cursor and leaves the cursor alone", async () => {
    const { id: gid } = await newGroup();
    const first = await add(gid);
    expect(await cursorOf(gid)).toBe(1);
    const categories = await cats.loadCategoryContext();
    const ok = await g.updateExpenseIfAllowed(
      gid,
      first,
      (group) =>
        input.readExpenseInput(
          body({ title: "renamed" }),
          group.memberIds,
          group.baseCurrency,
          categories,
          roundingRing(group.memberIds, group.roundingCursor),
        ),
      A,
    );
    expect(ok).toBe(true);
    expect(await cursorOf(gid)).toBe(1);
    // The cursor points at B now, so re-saving moves the extra cent there.
    expect(holder(await splitsOf(gid, first))).toBe(B);
  });

  it("rotates the extra cent between the occurrences of a recurring template", async () => {
    const { id: gid } = await newGroup();
    const categories = await cats.loadCategoryContext();
    const group = (await g.getGroupById(gid))!;
    const payload = recInput.readRecurringInput(
      body({ title: "Rent", recurrence: "week", startDate: "2026-01-05" }),
      group.memberIds,
      group.baseCurrency,
      categories,
      roundingRing(group.memberIds, group.roundingCursor),
    );
    const rid = await g.createRecurringExpense(gid, payload, A);
    expect(await recurring.generateRecurringExpenses("2026-01-19", rid)).toBe(3);
    const list = (await g.getExpenses(gid)).sort((x, y) => x.date.localeCompare(y.date));
    expect(list.map((e) => holder(e.splits))).toEqual([A, B, C]);
    expect(await cursorOf(gid)).toBe(0);
  });

  it("keeps copying the snapshot of a template saved before inputs were stored", async () => {
    const { id: gid } = await newGroup();
    const categories = await cats.loadCategoryContext();
    const group = (await g.getGroupById(gid))!;
    const payload = recInput.readRecurringInput(
      body({ title: "Old", recurrence: "week", startDate: "2026-01-05" }),
      group.memberIds,
      group.baseCurrency,
      categories,
    );
    const rid = await g.createRecurringExpense(gid, payload, A);
    await client.runtimeDb.$client.execute({
      sql: "UPDATE recurring_expenses SET split_input = NULL WHERE id = ?",
      args: [rid],
    });
    await recurring.generateRecurringExpenses("2026-01-12", rid);
    const list = await g.getExpenses(gid);
    expect(list).toHaveLength(2);
    expect(list[0]!.splits).toEqual(list[1]!.splits);
    expect(await cursorOf(gid)).toBe(0);
  });
});

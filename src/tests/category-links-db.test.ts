import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the link and category-delete logic against a real SQLite database built
 * by the real migrations, with foreign keys on as at runtime.
 */
const root = resolve(__dirname, "..");
const work = mkdtempSync(join(tmpdir(), "pachas-links-"));
process.env.DATABASE_PATH = join(work, "test.sqlite");

type Links = typeof import("../server/utils/category-links");
type Cats = typeof import("../server/utils/categories");
type Client = typeof import("../server/utils/client");
let links: Links;
let cats: Cats;
let client: Client;
let categoryIds: number[] = [];

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as Error & { statusCode?: number };
  }
  throw new Error("expected a rejection");
};

beforeAll(async () => {
  execFileSync(process.execPath, [join(root, "scripts/migrate.mjs")], {
    env: { ...process.env },
    stdio: "pipe",
  });
  client = await import("../server/utils/client");
  await client.initializeRuntimeDb();
  links = await import("../server/utils/category-links");
  cats = await import("../server/utils/categories");
  const rows = await client.runtimeDb.$client.execute("SELECT id FROM categories ORDER BY id");
  categoryIds = rows.rows.map((r) => Number(r.id));
});

afterAll(async () => {
  await client.closeRuntimeDb();
  rmSync(work, { recursive: true, force: true });
});

describe("category title links (database)", () => {
  it("stores only the normalised title and lists links in that order", async () => {
    const [food, groceries] = categoryIds as [number, number];
    await links.createCategoryLink({ title: "Zumo", categoryId: food });
    const created = await links.createCategoryLink({ title: "  Álvaro  ", categoryId: groceries });
    expect(created).toMatchObject({ title: "alvaro", categoryId: groceries });
    const listed = await links.listCategoryLinks();
    expect(listed.map((l) => l.title)).toEqual(["alvaro", "zumo"]);
  });

  it("rejects a title that only differs by case, accents or spacing", async () => {
    const [food] = categoryIds as [number];
    for (const title of ["zumo", "ZUMO", " Zumó "]) {
      const e = await failure(links.createCategoryLink({ title, categoryId: food }));
      expect(e.message).toBe("link_exists");
      expect(e.statusCode).toBe(409);
    }
  });

  it("rejects an unknown category", async () => {
    const e = await failure(links.createCategoryLink({ title: "Nuevo", categoryId: 99999 }));
    expect(e.message).toBe("link_category_invalid");
    expect(e.statusCode).toBe(400);
  });

  it("updates title and category, and refuses a clashing title", async () => {
    const [food, groceries] = categoryIds as [number, number];
    const mine = await links.createCategoryLink({ title: "Panadería", categoryId: food });
    const updated = await links.updateCategoryLink(mine.id, {
      title: "Panadería Sol",
      categoryId: groceries,
    });
    expect(updated).toMatchObject({ id: mine.id, title: "panaderia sol", categoryId: groceries });

    const clash = await failure(links.updateCategoryLink(mine.id, { title: "zumo" }));
    expect(clash.message).toBe("link_exists");

    // Saving a link under its own title (e.g. only changing case) is not a clash.
    const same = await links.updateCategoryLink(mine.id, { title: "PANADERÍA SOL" });
    expect(same.title).toBe("panaderia sol");

    const missing = await failure(links.updateCategoryLink(424242, { title: "x" }));
    expect(missing.statusCode).toBe(404);
    const noCat = await failure(links.updateCategoryLink(mine.id, { categoryId: 99999 }));
    expect(noCat.message).toBe("link_category_invalid");
  });

  it("deletes a link and reports a missing one", async () => {
    const [food] = categoryIds as [number];
    const l = await links.createCategoryLink({ title: "Temporal", categoryId: food });
    await links.deleteCategoryLink(l.id);
    expect((await links.listCategoryLinks()).some((x) => x.id === l.id)).toBe(false);
    expect((await failure(links.deleteCategoryLink(l.id))).statusCode).toBe(404);
  });

  it("caps the number of links", async () => {
    const [food] = categoryIds as [number];
    const have = (await links.listCategoryLinks()).length;
    const statements = [];
    for (let i = have; i < links.MAX_CATEGORY_LINKS; i++) {
      statements.push({
        sql: "INSERT INTO category_title_links (normalized_title, category_id, created_at) VALUES (?, ?, 1)",
        args: [`bulk ${i}`, food],
      });
    }
    await client.runtimeDb.$client.batch(statements, "write");
    const e = await failure(links.createCategoryLink({ title: "one too many", categoryId: food }));
    expect(e.message).toBe("link_limit_reached");
  });
});

describe("deleting a category keeps its links", () => {
  it("re-points links to the migration target instead of cascading them away", async () => {
    const db = client.runtimeDb.$client;
    await db.execute("DELETE FROM category_title_links");
    const [a, b, c] = categoryIds.slice(2) as [number, number, number];
    await links.createCategoryLink({ title: "Uno", categoryId: a });
    await links.createCategoryLink({ title: "Dos", categoryId: a });
    await links.createCategoryLink({ title: "Tres", categoryId: c });

    await cats.deleteCategoryMigrating(a, b);

    const listed = await links.listCategoryLinks();
    expect(listed).toHaveLength(3);
    expect(Object.fromEntries(listed.map((l) => [l.title, l.categoryId]))).toEqual({
      uno: b,
      dos: b,
      tres: c,
    });
    const gone = await db.execute({ sql: "SELECT 1 FROM categories WHERE id = ?", args: [a] });
    expect(gone.rows).toHaveLength(0);
  });

  it("refuses an unknown source or target and leaves links untouched", async () => {
    const [x, y] = categoryIds.slice(-2) as [number, number];
    await links.createCategoryLink({ title: "Cuatro", categoryId: y });
    expect((await failure(cats.deleteCategoryMigrating(99999, x))).statusCode).toBe(404);
    expect((await failure(cats.deleteCategoryMigrating(y, 99999))).statusCode).toBe(400);
    const four = (await links.listCategoryLinks()).find((l) => l.title === "cuatro");
    expect(four?.categoryId).toBe(y);
  });
});

describe("category context for expense input (database)", () => {
  it("defaults to the General category and lists every real id", async () => {
    const ctx = await cats.loadCategoryContext();
    const general = await client.runtimeDb.$client.execute(
      "SELECT id FROM categories WHERE title = 'General'",
    );
    expect(ctx.defaultId).toBe(String(general.rows[0]?.id));
    const all = await client.runtimeDb.$client.execute("SELECT id FROM categories");
    expect([...ctx.validIds].sort()).toEqual(all.rows.map((r) => String(r.id)).sort());
    expect(ctx.validIds.has(ctx.defaultId)).toBe(true);
    expect(ctx.validIds.has("general")).toBe(false);
  });

  it("falls back to the first category when General is renamed", async () => {
    const db = client.runtimeDb.$client;
    await db.execute("UPDATE categories SET title = 'Renamed' WHERE title = 'General'");
    const first = await db.execute("SELECT id FROM categories ORDER BY position, id LIMIT 1");
    expect((await cats.loadCategoryContext()).defaultId).toBe(String(first.rows[0]?.id));
  });
});

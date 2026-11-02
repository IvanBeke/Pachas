import { createError } from "h3";
import { asc, count, eq, ne, and } from "drizzle-orm";
import { runtimeDb as db } from "./client";
import { categories, categoryTitleLinks } from "../db/schema";
import { MAX_LINK_TITLE } from "../../shared/category-links";
import { normalizeText } from "../../shared/text";
import { writeTransaction, type DbTransaction } from "./sqlite-writes";

/** Bounds the list every expense form downloads. */
export const MAX_CATEGORY_LINKS = 1000;

export interface NewCategoryLink {
  title: string;
  categoryId: number;
}

export type CategoryLinkPatch = Partial<NewCategoryLink>;

export interface CategoryLinkView {
  id: number;
  title: string;
  categoryId: number;
}

function bad(message: string, statusCode = 400): never {
  throw createError({ statusCode, message });
}

/** Validates the typed title and returns its normalised form, the only one stored. */
function readTitle(value: unknown): string {
  const typed = typeof value === "string" ? value.trim() : "";
  const title = normalizeText(typed);
  if (!title || typed.length > MAX_LINK_TITLE) bad("link_title_invalid");
  return title;
}

function readCategoryId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    bad("link_category_invalid");
  }
  return value;
}

/** A create needs both fields. */
export function readNewCategoryLink(body: Record<string, unknown>): NewCategoryLink {
  return { title: readTitle(body.title), categoryId: readCategoryId(body.categoryId) };
}

/** An update may change either field, but must change at least one. */
export function readCategoryLinkPatch(body: Record<string, unknown>): CategoryLinkPatch {
  const out: CategoryLinkPatch = {};
  if ("title" in body) out.title = readTitle(body.title);
  if ("categoryId" in body) out.categoryId = readCategoryId(body.categoryId);
  if (!Object.keys(out).length) bad("link_nothing_to_update");
  return out;
}

async function requireCategory(tx: DbTransaction, id: number): Promise<void> {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (!row) bad("link_category_invalid");
}

const viewColumns = {
  id: categoryTitleLinks.id,
  title: categoryTitleLinks.normalizedTitle,
  categoryId: categoryTitleLinks.categoryId,
};

export async function listCategoryLinks(): Promise<CategoryLinkView[]> {
  return db
    .select(viewColumns)
    .from(categoryTitleLinks)
    .orderBy(asc(categoryTitleLinks.normalizedTitle));
}

export function createCategoryLink(
  input: NewCategoryLink,
): Promise<CategoryLinkView> {
  const normalizedTitle = normalizeText(input.title);
  return writeTransaction(async (tx) => {
    await requireCategory(tx, input.categoryId);
    const [existing] = await tx
      .select({ id: categoryTitleLinks.id })
      .from(categoryTitleLinks)
      .where(eq(categoryTitleLinks.normalizedTitle, normalizedTitle))
      .limit(1);
    if (existing) bad("link_exists", 409);
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(categoryTitleLinks);
    if (total >= MAX_CATEGORY_LINKS) bad("link_limit_reached");
    const [row] = await tx
      .insert(categoryTitleLinks)
      .values({ normalizedTitle, categoryId: input.categoryId, createdAt: Date.now() })
      .returning(viewColumns);
    if (!row) bad("link_create_failed", 500);
    return row;
  });
}

export function updateCategoryLink(
  id: number,
  input: CategoryLinkPatch,
): Promise<CategoryLinkView> {
  return writeTransaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(categoryTitleLinks)
      .where(eq(categoryTitleLinks.id, id))
      .limit(1);
    if (!current) bad("not_found", 404);

    const next: Partial<typeof categoryTitleLinks.$inferInsert> = {};
    if (input.title !== undefined) {
      const normalizedTitle = normalizeText(input.title);
      const [clash] = await tx
        .select({ id: categoryTitleLinks.id })
        .from(categoryTitleLinks)
        .where(
          and(
            eq(categoryTitleLinks.normalizedTitle, normalizedTitle),
            ne(categoryTitleLinks.id, id),
          ),
        )
        .limit(1);
      if (clash) bad("link_exists", 409);
      next.normalizedTitle = normalizedTitle;
    }
    if (input.categoryId !== undefined) {
      await requireCategory(tx, input.categoryId);
      next.categoryId = input.categoryId;
    }

    const [row] = await tx
      .update(categoryTitleLinks)
      .set(next)
      .where(eq(categoryTitleLinks.id, id))
      .returning(viewColumns);
    if (!row) bad("not_found", 404);
    return row;
  });
}

export function deleteCategoryLink(id: number): Promise<void> {
  return writeTransaction(async (tx) => {
    const rows = await tx
      .delete(categoryTitleLinks)
      .where(eq(categoryTitleLinks.id, id))
      .returning({ id: categoryTitleLinks.id });
    if (!rows.length) bad("not_found", 404);
  });
}

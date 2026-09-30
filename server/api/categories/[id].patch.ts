import { eq } from "drizzle-orm";
import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/client";
import { categories, categoryTranslations } from "../../db/schema";

function capitalize(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: "Invalid category id." });
  }
  const body = await readBody(event).catch(() => ({}));
  const title = capitalize(String(body.title ?? ""));
  const icon = String(body.icon ?? "").trim().slice(0, 4);
  if (!title || title.length > 30) {
    throw createError({
      statusCode: 400,
      message: "A category title is required (max 30 characters).",
    });
  }
  if (!icon) {
    throw createError({ statusCode: 400, message: "An icon is required." });
  }

  const translations = (body.translations || {}) as Record<string, string>;

  const updated = await db.transaction(async (tx) => {
    const [cat] = await tx
      .update(categories)
      .set({ title, icon })
      .where(eq(categories.id, id))
      .returning({ id: categories.id, title: categories.title, icon: categories.icon });

    if (!cat) return null;

    for (const [locale, t] of Object.entries(translations)) {
      const trimmed = String(t || "").trim();
      if (trimmed) {
        await tx
          .insert(categoryTranslations)
          .values({ categoryId: id, locale, title: trimmed })
          .onConflictDoUpdate({
            target: [categoryTranslations.categoryId, categoryTranslations.locale],
            set: { title: trimmed },
          });
      }
    }

    return cat;
  });

  if (!updated) {
    throw createError({ statusCode: 404, message: "Category not found." });
  }
  return updated;
});

import { sql } from "drizzle-orm";
import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/client";
import { categories, categoryTranslations } from "../../db/schema";

/** Bounds the number of translation rows one request can create. */
const MAX_TRANSLATIONS = 20;

/** Only well-formed BCP-47-ish tags become column data. */
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

function capitalize(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event).catch(() => ({}));
  const title = capitalize(String(body.title || ""));
  const icon = String(body.icon || "🧾").trim().slice(0, 4) || "🧾";
  if (!title || title.length > 30) {
    throw createError({
      statusCode: 400,
      message: "A category title is required (max 30 characters).",
    });
  }

  const translations = (body.translations || {}) as Record<string, string>;
  const translationEntries = Object.entries(translations);
  if (translationEntries.length > MAX_TRANSLATIONS) {
    throw createError({
      statusCode: 400,
      message: `At most ${MAX_TRANSLATIONS} translations per category.`,
    });
  }
  for (const [locale] of translationEntries) {
    if (!LOCALE_RE.test(locale)) {
      throw createError({
        statusCode: 400,
        message: `Invalid locale: ${locale}`,
      });
    }
  }

  const maxPos = await db
    .select({ m: sql<number>`coalesce(max(${categories.position}), -1)` })
    .from(categories);

  const created = await db.transaction(async (tx) => {
    const [cat] = await tx
      .insert(categories)
      .values({ title, icon, position: (maxPos[0]?.m ?? -1) + 1 })
      .returning();

    if (!cat) {
      throw createError({ statusCode: 500, message: "Could not create the category." });
    }

    for (const [locale, t] of translationEntries) {
      const trimmed = String(t || "").trim();
      if (trimmed) {
        await tx
          .insert(categoryTranslations)
          .values({ categoryId: cat.id, locale, title: trimmed })
          .onConflictDoUpdate({
            target: [categoryTranslations.categoryId, categoryTranslations.locale],
            set: { title: trimmed },
          });
      }
    }

    return cat;
  });

  if (!created) {
    throw createError({ statusCode: 500, message: "Could not create the category." });
  }
  return { id: created.id, title: created.title, icon: created.icon };
});

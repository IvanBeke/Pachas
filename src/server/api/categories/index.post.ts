import { sql } from "drizzle-orm";
import { requireAdmin } from "../../utils/auth";
import { categories, categoryTranslations } from "../../db/schema";
import { readCategoryInput } from "../../utils/category-input";
import { writeTransaction } from "../../utils/sqlite-writes";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { title, icon, translations } = readCategoryInput(
    await readJsonObject(event),
    { icon: "🧾" },
  );

  const created = await writeTransaction(async (tx) => {
    const [maxPos] = await tx
      .select({ m: sql<number>`coalesce(max(${categories.position}), -1)` })
      .from(categories);
    const [cat] = await tx
      .insert(categories)
      .values({ title, icon, position: (maxPos?.m ?? -1) + 1 })
      .returning();
    if (!cat) {
      throw createError({ statusCode: 500, message: "Could not create the category." });
    }
    if (translations.length) {
      await tx
        .insert(categoryTranslations)
        .values(translations.map(([locale, t]) => ({ categoryId: cat.id, locale, title: t })));
    }
    return cat;
  });

  return { id: created.id, title: created.title, icon: created.icon };
});

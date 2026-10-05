import { eq } from "drizzle-orm";
import { requireAdmin } from "../../utils/auth";
import { categories, categoryTranslations } from "../../db/schema";
import { readCategoryInput } from "../../utils/category-input";
import { writeTransaction } from "../../utils/sqlite-writes";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: "Invalid category id." });
  }
  const { title, icon, translations } = readCategoryInput(await readJsonObject(event));

  const updated = await writeTransaction(async (tx) => {
    const [cat] = await tx
      .update(categories)
      .set({ title, icon })
      .where(eq(categories.id, id))
      .returning({ id: categories.id, title: categories.title, icon: categories.icon });
    if (!cat) return null;
    for (const [locale, t] of translations) {
      await tx
        .insert(categoryTranslations)
        .values({ categoryId: id, locale, title: t })
        .onConflictDoUpdate({
          target: [categoryTranslations.categoryId, categoryTranslations.locale],
          set: { title: t },
        });
    }
    return cat;
  });

  if (!updated) {
    throw createError({ statusCode: 404, message: "Category not found." });
  }
  return updated;
});

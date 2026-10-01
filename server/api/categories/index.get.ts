import { asc } from "drizzle-orm";
import { runtimeDb as db } from "../../utils/client";
import { categories, categoryTranslations } from "../../db/schema";

export default defineEventHandler(async () => {
  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.id));

  const translations = await db
    .select()
    .from(categoryTranslations);

  const transMap: Record<number, Record<string, string>> = {};
  for (const t of translations) {
    (transMap[t.categoryId] ||= {})[t.locale] = t.title;
  }

  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    icon: c.icon,
    translations: transMap[c.id] || {},
  }));
});

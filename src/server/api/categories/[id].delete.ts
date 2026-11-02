import { requireAdmin } from "../../utils/auth";
import { deleteCategoryMigrating } from "../../utils/categories";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: "Invalid category id." });
  }
  const body = await readJsonObject(event);
  const migrateTo = Number(body.migrateTo);
  if (!Number.isInteger(migrateTo) || migrateTo === id) {
    throw createError({
      statusCode: 400,
      message: "Pick a different category to migrate expenses to.",
    });
  }
  await deleteCategoryMigrating(id, migrateTo);
  return { ok: true, migratedTo: migrateTo };
});

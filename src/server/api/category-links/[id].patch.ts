import { requireAdmin } from "../../utils/auth";
import { readCategoryLinkPatch, updateCategoryLink } from "../../utils/category-links";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const id = Number(requireParam(event, "id"));
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: "Invalid link id." });
  }
  const input = readCategoryLinkPatch(await readJsonObject(event));
  return updateCategoryLink(id, input);
});

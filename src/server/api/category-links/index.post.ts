import { requireAdmin } from "../../utils/auth";
import { createCategoryLink, readNewCategoryLink } from "../../utils/category-links";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return createCategoryLink(readNewCategoryLink(await readJsonObject(event)));
});

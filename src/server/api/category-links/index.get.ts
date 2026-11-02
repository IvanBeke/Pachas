import { requireUser } from "../../utils/auth";
import { listCategoryLinks } from "../../utils/category-links";

export default defineEventHandler(async (event) => {
  await requireUser(event);
  return listCategoryLinks();
});

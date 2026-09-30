import { requireUser, publicUser } from "../utils/auth";

export default defineEventHandler(async (event) => {
  const u = await requireUser(event);
  return publicUser(u);
});

import { requireUser, selfUser } from "../utils/auth";

export default defineEventHandler(async (event) => {
  const u = await requireUser(event);
  return selfUser(u);
});

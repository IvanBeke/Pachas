import { allowRegistration } from "../utils/env";

export default defineEventHandler(() => {
  return { allowRegistration: allowRegistration() };
});

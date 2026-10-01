import { initializeRuntimeDb } from "../utils/client";

export default defineNitroPlugin(async () => {
  await initializeRuntimeDb();
});

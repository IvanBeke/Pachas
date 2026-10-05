import { sessionSecretProblem } from "../utils/env";
import { closeRuntimeDb, initializeRuntimeDb } from "../utils/client";
import { purgeExpiredSessions } from "../utils/auth";

const SESSION_PURGE_INTERVAL_MS = 60 * 60_000;

export default defineNitroPlugin(async (nitroApp) => {
  const problem = sessionSecretProblem(process.env.SESSION_SECRET);
  if (problem) {
    console.error(`[pachas] ${problem}. Set it in .env (openssl rand -hex 32).`);
    process.exit(1);
  }

  await initializeRuntimeDb();

  const purge = () =>
    purgeExpiredSessions().catch((error) =>
      console.warn("[pachas] could not purge expired sessions", error),
    );
  await purge();
  const timer = setInterval(purge, SESSION_PURGE_INTERVAL_MS);
  timer.unref();

  nitroApp.hooks.hook("close", async () => {
    clearInterval(timer);
    await closeRuntimeDb();
  });
});

import { initializeRuntimeDb } from "../utils/client";
import { generateRecurringExpenses } from "../utils/recurring";

const INTERVAL_MS = 60 * 60_000;

/** Creates due recurring expenses at startup and then hourly. */
export default defineNitroPlugin((nitroApp) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await initializeRuntimeDb();
      const created = await generateRecurringExpenses();
      if (created) console.log(`[pachas] generated ${created} recurring expense(s)`);
    } catch (error) {
      console.error("[pachas] recurring expense generation failed", error);
    } finally {
      running = false;
    }
  };
  // Deferred so startup (and migrations) are not slowed down by a catch-up run.
  const first = setTimeout(run, 1_000);
  const timer = setInterval(run, INTERVAL_MS);
  first.unref();
  timer.unref();
  nitroApp.hooks.hook("close", () => {
    clearTimeout(first);
    clearInterval(timer);
  });
});

import { cookieSecure } from "../utils/env";

/**
 * Removes the `x-powered-by` response header and, when the deployment is
 * served over HTTPS, adds HSTS.
 *
 * `routeRules` can set headers but cannot delete one: assigning `""` leaves the
 * value Nitro already set, so the framework was still advertised. Doing it in a
 * hook is the only place the header can actually be taken off the response.
 * HSTS is set here rather than in `routeRules` because those are fixed at build
 * time, while `COOKIE_SECURE` is a runtime setting.
 *
 * The other security headers are applied declaratively in `nuxt.config.ts` and
 * are left there.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("beforeResponse", (event) => {
    event.node.res.removeHeader("x-powered-by");
    if (cookieSecure()) {
      event.node.res.setHeader(
        "strict-transport-security",
        "max-age=31536000; includeSubDomains",
      );
    }
  });
});

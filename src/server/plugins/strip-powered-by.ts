/**
 * Removes the `x-powered-by` response header.
 *
 * `routeRules` can set headers but cannot delete one: assigning `""` leaves the
 * value Nitro already set, so the framework was still advertised. Doing it in a
 * hook is the only place the header can actually be taken off the response.
 *
 * The other security headers are applied declaratively in `nuxt.config.ts` and
 * are left there.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("beforeResponse", (event) => {
    event.node.res.removeHeader("x-powered-by");
  });
});

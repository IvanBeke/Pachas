const useDevFilePolling =
  process.env.NODE_ENV === "development" &&
  process.env.PACHAS_DEV_USE_POLLING !== "false";

export default defineNuxtConfig({
  srcDir: "app/",
  serverDir: "server/",
  dir: { shared: "shared/" },
  ssr: false,
  devtools: { enabled: false },
  // The client-only dev server doesn't need a manifest; disabling it avoids
  // Vite trying to resolve Nuxt's server-only `#app-manifest` dynamic import.
  experimental: { appManifest: process.env.NODE_ENV !== "development" },
  modules: ["@nuxthub/core", "@nuxtjs/i18n"],
  ...(useDevFilePolling
    ? {
        watchers: {
          chokidar: { usePolling: true, interval: 1000 },
        },
        vite: {
          server: {
            watch: { usePolling: true, interval: 1000 },
          },
        },
      }
    : {}),
  i18n: {
    defaultLocale: "es",
    locales: [
      { code: "es", name: "Español", file: "es.json" },
      { code: "en", name: "English", file: "en.json" },
    ],
    strategy: "no_prefix",
    detectBrowserLanguage: false,
    langDir: "locales",
  },
  hub: {
    db: {
      dialect: "sqlite",
      driver: "libsql",
      casing: "snake_case",
      // scripts/migrate.mjs owns migrations (it runs at container start);
      // NuxtHub is only used for `pnpm db:generate`.
      applyMigrationsDuringBuild: false,
      applyMigrationsDuringDev: false,
    },
  },
  css: ["~/assets/style.css"],
  // Deployment settings are read from process.env at runtime (see
  // server/utils/env.ts); runtimeConfig would freeze them at build time.
  nitro: {
    preset: "node-server",
    ...(useDevFilePolling
      ? { watchOptions: { usePolling: true, interval: 1000 } }
      : {}),
  },
  routeRules: {
    "/**": {
      headers: {
        // Nuxt emits inline import-map and runtime-config scripts in the SPA
        // shell, so script-src must permit inline scripts for client startup.
        // Keep user data out of HTML: never use v-html or innerHTML.
        "content-security-policy": [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
      },
    },
  },
  app: {
    head: {
      title: "Pachas — gastos compartidos",
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
      ],
      link: [
        {
          rel: "icon",
          href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧾</text></svg>",
        },
      ],
    },
  },
});

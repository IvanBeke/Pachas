// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Auth-gated app with client-side polling: no benefit from SSR,
  // and prerendering would call /api/* with no database at build time.
  ssr: false,
  devtools: { enabled: false },
  modules: ["@nuxthub/core", "@nuxtjs/i18n"],
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
      dialect: "postgresql",
      // DB columns are snake_case, code uses camelCase.
      casing: "snake_case",
      // No database reachable at Docker build time — migrations run from
      // the container entrypoint instead (see entrypoint.sh).
      applyMigrationsDuringBuild: false,
    },
  },
  css: ["~/assets/style.css"],
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || "",
    sessionSecret: process.env.SESSION_SECRET || "",
    allowRegistration: process.env.ALLOW_REGISTRATION ?? "true",
    cookieSecure: process.env.COOKIE_SECURE ?? "false",
    public: {},
  },
  nitro: {
    preset: "node-server",
  },
  // Applied to every route. The app previously served its HTML with no security
  // headers at all — the `X-Frame-Options`/CSP seen on error responses come
  // from Nitro's error page and never applied to the SPA itself.
  routeRules: {
    "/**": {
      headers: {
        // Nuxt emits inline import-map and runtime-config scripts in the SPA
        // shell, so script-src must permit inline scripts for client startup.
        // Keep user data out of HTML: never use v-html or innerHTML.
        "content-security-policy": [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          // Vue's runtime and i18n build styles at runtime in dev.
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          // The app is API-only; nothing should ever frame it.
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
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

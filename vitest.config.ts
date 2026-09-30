import { defineConfig } from "vitest/config";

/**
 * Server utilities are plain TypeScript with no Nuxt runtime imports, so unit
 * tests run under plain Vitest. That keeps them fast and avoids booting the
 * Nuxt/Nitro pipeline (which would need a live database).
 *
 * Two projects so component tests can opt into a DOM without slowing the
 * pure-logic suite down.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          // Contract tests hit a live server; they self-skip when there isn't
          // one, so `pnpm test` stays green in CI with no database.
          exclude: ["**/node_modules/**", "**/.nuxt/**", "**/.output/**", "tests/api.*.test.ts"],
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "api",
          globals: true,
          environment: "node",
          include: ["tests/api.*.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          globals: true,
          environment: "happy-dom",
          include: ["tests/**/*.dom.test.ts"],
        },
      },
    ],
  },
});

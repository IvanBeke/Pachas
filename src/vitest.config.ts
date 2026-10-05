import { defineConfig } from "vitest/config";

/**
 * Server utilities and shared maths are plain TypeScript with no Nuxt runtime
 * imports, so unit tests run under plain Vitest. That keeps them fast and
 * avoids booting the Nuxt/Nitro pipeline.
 *
 * The `api` project is the HTTP contract suite; it needs a running app and
 * self-skips when there isn't one.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/.nuxt/**", "**/.output/**", "tests/api.*.test.ts"],
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
    ],
  },
});

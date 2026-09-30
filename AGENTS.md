# AGENTS.md

Full Nuxt 4 app (Vue 3 SPA, `ssr: false`) + Postgres 18, with Vitest tests, `vue-tsc` typecheck, and a GitHub Actions CI workflow.

## Run
- Always run project tech-stack commands using Docker and the Compose services, never on the host.
- `cp .env.example .env` then set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`).
- `docker compose up -d --build` → app at `http://localhost:3000`. Data persists in the `pachas_pachas-pgdata` volume. Runtime deps live inside the image — nothing is mounted over `/app/node_modules`, host stays clean.
- Dependency installs must not pollute the host: `docker run --rm -v $PWD:/app -v pachas-packages:/app/node_modules -w /app node:26-alpine sh -c "npm i -g pnpm@12.5.1 && pnpm install"`. Build approvals live in `pnpm-workspace.yaml` (`allowBuilds`) — it must be `COPY`d in the Dockerfile deps stage or `pnpm install --frozen-lockfile` fails on `esbuild`.

## Testing
- **All verification goes through Vitest, in `tests/`. Never verify with ad-hoc scripts, throwaway fixtures, or one-off commands — they cannot catch regressions.** Do not write throwaway Python/Node scripts to check behaviour; anything worth checking twice belongs in a test.
- `pnpm test` — unit + property tests (no server or database needed). `pnpm test:api` — contract tests against a running app.
- Run them via Docker with host networking so the API tests can reach the app: `docker run --rm --network host -v $PWD:/app -v pachas-packages:/app/node_modules -w /app node:26-alpine sh -c "npm i -g pnpm@12.5.1 && pnpm test"`.
- `pnpm typecheck` (`nuxt typecheck`) must stay at **0 errors**. Nuxt's generated config enables `noUncheckedIndexedAccess`, so indexed access needs a guard — fix the code, don't relax the flag.
- Three Vitest projects in `vitest.config.ts`: `unit` (node, pure logic), `api` (live-server contract tests, **self-skip when the server is unreachable so CI stays green without a DB**), `dom` (happy-dom, for component tests).
- Use plain `vitest/config`, not `@nuxt/test-utils`: booting the Nuxt pipeline makes `@nuxthub/core` try to clear `.data/`, which fails on a host bind-mount. Server utils are plain TS, so this is also faster.
- Tests resolve real users/groups from the API rather than hardcoding UUIDs — membership is validated against real rows, so a fake uuid is silently dropped.
- Property tests (`settlement-properties.test.ts`) generate ledgers from a seeded PRNG so failures reproduce. When asserting an algorithm's behaviour, prefer a generated sample over a handful of hand-picked cases: hand-picked fixtures agreed with each other and hid that the two settlement algorithms diverge.
- A passing suite is not proof. Mutate the source and confirm a test fails before trusting a new test.
- CI: `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` → `nuxt prepare` → `pnpm test` → `pnpm typecheck`.

## The server is authoritative
- **The front end is never trusted. All money math happens on the server.** The client may compute anything for a live preview, but it must never send computed results to be stored.
- The client sends the **selection**; the server derives the values. For expenses that means `splitType` + `participants` + `values` (+ `items`), never a `splits` map. `readExpenseInput` (`server/utils/expense-input.ts`) recomputes every split and rejects the request if the result doesn't reconcile.
- `shared/splits.ts` is the single implementation of `computeSplits`, imported by both the app (preview) and the server (authoritative), so the two cannot drift. Put logic here when both sides need it. `app/utils/splits.ts` is a re-export.
- Same rule for settlements: `POST /settlements` derives the amount from the real outstanding debt and rejects anything above it, rather than trusting a client-supplied amount.
- Same for the Splitwise importer: the file is re-parsed server-side on commit, not trusted from a client-side parse.
- **When adding a computed field, decide who owns it.** If it affects stored money, the server computes and validates it; the client's copy is presentation only.

## Structure
- `nuxt.config.ts` (`ssr: false` — auth-gated app, and prerendering would call `/api/*` with no DB at build time; `hub.db` postgresql + `snake_case` casing + `applyMigrationsDuringBuild: false`; `defaultLocale: "es"`).
- `shared/**/*.ts` — code both client and server import (see above).
- `server/api/**/*.ts` — Nitro routes. `server/utils/`: `auth.ts` (sessions in `app_sessions`, cookie `pachas.sid`, 30d, `requireAdmin`), `session-token.ts` (`sessionDigest` / `requireSessionSecret` — pure, unit-tested), `rate-limit.ts` (in-process fixed-window limiter, `clientIp`), `groups.ts` (domain queries, `getBalances`/`simplifyDebts`/`pairwiseTransfers`, `importExpenses`, `countExpenses`), `expense-input.ts` (authoritative expense validation), `recurring-input.ts` (recurrence fields + reuse of the expense validator), `splitwise.ts` (CSV parsing), `import-input.ts` (`readImportRequest` — one multipart read, pre-checks `Content-Length`), `client.ts` (runtime drizzle client — see Database). `server/plugins/strip-powered-by.ts` removes the framework header. Security headers are declarative, in `nuxt.config.ts` `routeRules`.
- Route map: `POST /login`, `POST /logout`, `GET /me`, `POST /register`, `GET /config`, `GET /health`; `users/search`; `categories` CRUD (site-wide list); `admin/overview` + `admin/{expenses,settlements}` deletes (admin only); `groups` CRUD — `GET/PATCH /groups/:gid`, `members` add/remove, `expenses` CRUD, `settlements` CRUD + `settlements/plan` (server-computed balances and suggested transfers), `recurring` CRUD, `import/analyze` (dry run) + `import` (commit).
- `server/db/schema.ts` — single Drizzle schema source of truth; `server/db/migrations/postgresql/` — generated SQL, never hand-edit.
- `scripts/migrate.mjs` + `scripts/entrypoint.sh` — entrypoint applies migrations before starting the server. `scripts/cleanup-test-data.sql` prunes leftovers from the API test suite.
- `app/pages/index.vue` (groups), `app/pages/g/[id]/index.vue` (detail), `app/pages/g/[id]/edit.vue` (group settings, members, Splitwise import), `app/pages/login.vue`, `app/pages/admin.vue`; `app/components/*Modal.vue`; `app/composables/`; `app/utils/format.ts` (formatting, item maths).
- `Dockerfile` is multi-stage (`deps` → `build` → `runtime` runs entrypoint as `node` user, `HEALTHCHECK /api/health`).

## Database (NuxtHub Drizzle — https://hub.nuxt.com/docs/database)
- Dialect `postgresql`, driver `postgres-js` (package `postgres`), casing `snake_case`: TS keys are camelCase, columns snake_case. NUMERIC/BIGINT columns must use `mode: 'number'` or the API returns strings.
- Workflow: change `server/db/schema.ts` → `nuxt db generate` (via Docker, never host) → restart/rebuild applies. Never write SQL files by hand; `drizzle.config.ts` is auto-generated, don't create one.
- `nuxt db generate --name X` is broken in hub 0.10 (arg glues into `--config=`); use bare `nuxt db generate`.
- The hub's generated client inlines `DATABASE_URL` at build time, so queries use `server/utils/client.ts` (lazy runtime client) instead of `@nuxthub/db`. Hub stays the schema/migration system of record.
- No DB at Docker build time: entrypoint `migrate.mjs` (journal-driven over `meta/_journal.json`, tracked in `drizzle.__drizzle_migrations`) runs before the server. Statements tolerate "already exists" (42P07/42701/42710) so the baseline also lands on pre-Drizzle DBs.
- Dependencies: `drizzle-orm` + `postgres` + `h3` in `dependencies` (the runtime migrator and server utils need them; `h3` is imported directly, so it must be a direct dependency, not just transitive via Nuxt); `@nuxthub/core`, `drizzle-kit`, `nuxt`, `typescript` in `devDependencies` (build only). Runtime `pnpm install --prod` needs `--ignore-scripts` (postinstall requires devDeps).
- Seed data goes in the existing migration that owns the table (categories in `0002`, its English translations in `0004` once `category_translations` exists). The app defaults to Spanish, so built-in categories use Spanish as the base title with English as the translation.

## Security
`security_fixes.md` records a full review and its remediation. The rules that
constrain future work:
- **All password hashing is async, and `/login` + `/register` are rate limited.** `bcryptjs` is pure JS: `compareSync` blocked the event loop ~48 ms, so ~20 req/s from one connection saturated the whole server. Never reintroduce the `*Sync` variants on a request path.
- **Only *failed* logins count against the limiter** (`peek` before hashing, `hit` on failure). This is load-bearing for the test suite, not just for users: the API contract suite signs in repeatedly from one address, so counting successes would make the suite throttle itself into a 429 and become non-repeatable. There is no env-var bypass — a security control that can be switched off by a stray variable is one variable away from being off in production.
- **Money inputs are validated three deep** — finite checks in `readExpenseInput`, a `bad_amount` result in the shared `computeSplits`, and a finite check on the computed shares. This is deliberate defence in depth, but it has a testing consequence: removing any *one* layer leaves the others rejecting the request, so `tests/expense-integrity.test.ts` pins the property rather than any single line. A test that only removes one guard proves nothing.
- **`Infinity` is the number to fear in money code.** `Number("1e400")` is `Infinity`, which is truthy and `> 0`, so `!x || x <= 0` does not catch it. Worse, `Infinity - Infinity` is `NaN` and *every* comparison against `NaN` is false, so a reconciliation guard written as `if (Math.abs(sum - total) > 0.05)` silently passes a poisoned payload. Use `Number.isFinite` on inputs and on any computed difference.
- **Adding a group member is creator-or-admin only**, matching removal — it grants read access to the whole expense history. Any member can still create their own group and populate it.
- **Any member may leave a group; the creator may not**, because a group with no creator cannot be administered.
- **A group's `baseCurrency` is frozen once it has expenses.** `amountBase` is denormalised into every expense row, so changing it later would reinterpret the whole ledger with no conversion.
- **The session cookie gains a `__Host-` prefix when `COOKIE_SECURE=true`.** That prefix requires `Secure`, so it cannot be used on plain-HTTP LAN — the name follows the deployment, and flipping `COOKIE_SECURE` deliberately invalidates existing sessions. Session lookup and logout both read under the prefixed *and* bare name.
- `users/search` requires ≥2 characters and escapes `%`/`_`, so it can't be used to dump the user directory.
- `x-powered-by` can only be removed in a Nitro hook — assigning `""` via `routeRules` leaves the original value in place.

## Gotchas
- `compose.yaml` uses `${VAR:?msg}` — missing `.env` vars fail fast. `DATABASE_URL` is constructed in compose, not `.env`. `.dockerignore` excludes `.env`, never `COPY` it.
- `COOKIE_SECURE` must stay `"false"` on plain HTTP LAN; `"true"` without HTTPS breaks login cookies. `ALLOW_REGISTRATION` defaults `"true"`; set `"false"` after initial signups.
- `SESSION_SECRET` keys the session digests. The cookie holds a 32-byte random token; `app_sessions.token` stores `HMAC-SHA256(SESSION_SECRET, token)`, never the cookie value — so a DB backup is not a set of usable session cookies. It must be set: `requireSessionSecret` throws rather than falling back to an unkeyed hash, and `compose.yaml` enforces it with `${VAR:?}`. **All three** session call sites (`createSession`, `destroySession`, `getSessionUser`) must digest; miss one and logout stops revoking, which `tests/api.contract.test.ts` catches. Rotating it logs everyone out at once.
- Startup runs pending Drizzle migrations idempotently — no migration files to maintain by hand, never drop tables. Old `session` table (Express era) is orphaned but harmless.
- There are no per-group roles: group access is a `group_members` row, nothing more. `users.role` (`'user'` / `'admin'`) is a **site-wide** flag only — the first account created becomes admin (migration `0002`). Admins reach `server/api/admin/*` via `requireAdmin` and manage the shared category list; admins are not automatically members of any group, so every group route still calls `requireMember` first.
- Nitro route filenames: `[gid]`/`[eid]`/`[sid]` are file-name params, not directories — count `../` to `server/utils/` from the containing folder (e.g. `server/api/groups/[gid]/expenses/*.ts` needs `../../../../utils/`).
- Polling (`useGroupDetail.ts`, 4s, skipped when tab hidden) only mutates list refs; modals keep local `reactive()` state so refreshes never wipe typing. Don't reintroduce a global re-render.
- A route file and a directory of the same name collide. `app/pages/g/[id].vue` alongside `app/pages/g/[id]/edit.vue` makes the edit page a **child** route, which never renders without a `<NuxtPage />` in the parent. Use `app/pages/g/[id]/index.vue` so they are siblings.
- Category titles must render through `translatedTitle(cat, locale)`; the raw `cat.title` is the base (Spanish) title. Admin-managed categories can have any locale, so the select options need the helper, not the field.
- i18n messages are compiled into token arrays by `@nuxtjs/i18n`, so a literal like `"{from} debe {amount} a {to}"` will **not** appear in the bundle. Grep for the key instead. Use `<i18n-t>` with named slots to keep per-locale word order while rendering names as components — never `v-html` (display names are user data).
- `simplifyTransfers` on a group picks between `simplifyDebts` (greedy) and `pairwiseTransfers`. They choose **different pairs for the same number of payments** on groups larger than ~4 members — the toggle changes who pays whom, not how many payments. See `tests/settlement-properties.test.ts`.
- Splitwise CSV member columns hold **net** balances, not raw shares: a payer's own portion is already deducted. A negative balance is that member's exact share and the payer's share is the remainder — `undefined + n` is `NaN`, which `JSON.stringify` writes as `null` and the server reads as `0`. That bug shipped once; `tests/splitwise.test.ts` guards it.
- Test contract groups named `__contract__` / `__delete_*` and the suite's throwaway users (`own*`, `oth*`, `str*` + a run id) are not self-deleting: there is no `DELETE /groups/:id` route and no user-delete endpoint. After running the API tests, clean up with `cat scripts/cleanup-test-data.sql | docker compose exec -T db psql -U pachas pachas -v ON_ERROR_STOP=1` (idempotent; matches only the suite's naming patterns).
- Admin authorisation is explicit per route, and the UI must agree with it. Expense delete and update both let a site admin act on anyone's row (`isAdmin` bypasses the `createdBy` filter); a non-owner gets **404**, not 403, so the response never confirms the row exists. A plain member still cannot. Cover new admin overrides with a test in `tests/api.contract.test.ts`.

# Architecture

Pachas is a Nuxt 4 / Vue 3 single-page app (`ssr: false`) with Nitro API routes
and a local SQLite database. Spanish is the default UI language; English is
also available.

## Source layout

- `src/app/` — pages, components, composables, assets, and client utilities.
- `src/server/api/` — API routes.
- `src/server/middleware/` — request guard (body size, same-origin writes).
- `src/server/plugins/` — startup checks, database init, recurring-expense
  schedule, response headers.
- `src/server/utils/` — database access, validation, permissions, and domain logic.
- `src/shared/` — logic shared by browser and server: money helpers and split
  calculations.
- `src/i18n/` — locale messages.
- `src/scripts/` — migration/seed entrypoint, `make-admin`, and test-data cleanup.
- `src/tests/` — unit, property, migration, and API contract tests.
- `src/` also contains the package manifests and Nuxt/TypeScript/Vitest config.

## Server-owned money

The browser sends the user's selections (split type, participants, typed
values, the amount and rate); the server computes and validates every persisted
amount, including the base-currency amount. `src/shared/splits.ts` is used for
previews and server-side calculation, so the two cannot drift. Settlement
amounts and Splitwise imports are likewise derived or re-parsed on the server.

Money is stored as **integer cents** (`src/shared/money.ts`). The API speaks
decimal units; `src/server/utils/groups.ts` converts at the database boundary.
Split maths runs in cents and distributes leftover cents deterministically, so
shares always sum to the total exactly. A group's base currency is fixed once
it has expenses because each expense stores a base-currency amount.

## Recurring expenses

A recurring expense is a template (weekly, monthly or yearly, with a start date
and optional inclusive end date). `src/server/plugins/recurring.ts` runs
`generateRecurringExpenses` at startup and hourly; creating a template also
generates anything already due. Each template records `generated_through`, and
generated expenses carry `recurring_id` with a unique `(recurring_id, date)`
index, so occurrences are created exactly once. Dates are UTC calendar dates;
monthly/yearly schedules clamp to the end of short months. Editing a template
affects future occurrences only. An occurrence whose payer or participants are
no longer group members is skipped and logged.

## Group page data flow

The group page polls `GET /api/groups/:gid/summary` (group, expenses,
settlements, and the settlement plan). Every write to a group runs through
`lockGroup`, which bumps `groups.version`; the summary's ETag is that version,
so unchanged polls get an empty `304`. Polling backs off while nothing changes
and pauses while the tab is hidden. The settlement plan is cached per group
version on the server.

## Database and startup

`src/server/db/schema.ts` is the schema source of truth. Generate migrations
with `pnpm db:generate` (see [verification](./verification.md)). Production
startup and the dev entrypoint run `scripts/migrate.mjs`, which applies pending
migrations (with foreign-key enforcement disabled around each migration and a
`foreign_key_check` before commit, as SQLite's table-rebuild procedure
requires) and idempotent category seeds before serving.

The runtime uses `drizzle-orm/libsql` with `DATABASE_PATH` (default
`/data/pachas.sqlite`) in WAL mode with a busy timeout; the connection is
checkpointed and closed on shutdown. The server refuses to start if
`SESSION_SECRET` is missing, shorter than 32 bytes, or the `.env.example`
placeholder.

## Route map

All routes are under `/api`. Everything except `health`, `config`, `login`,
`register`, and `logout` requires a session.

- Session: `POST /login`, `POST /logout`, `POST /register`, `GET /me`,
  `PATCH /me` (name, language, password).
- Public: `GET /health`, `GET /config` (whether registration is open).
- Users: `GET /users/search?q=` (3+ characters), `GET /users?ids=` (only users
  who share a group with you; at most 100 ids).
- Categories: `GET /categories`; site admin: `POST /categories`,
  `PATCH /categories/:id`, `DELETE /categories/:id` (moves expenses and
  recurring templates to another category).
- Site admin: `GET /admin/overview` (counts, users, groups).
- Groups: `GET|POST /groups`; `GET|PATCH|DELETE /groups/:gid`;
  `GET /groups/:gid/summary`.
- Members: `POST /groups/:gid/members`; `PATCH|DELETE /groups/:gid/members/:uid`
  (role change, removal or leaving).
- Expenses: `GET|POST /groups/:gid/expenses`;
  `PATCH|DELETE /groups/:gid/expenses/:eid`.
- Settlements: `GET|POST /groups/:gid/settlements`;
  `GET /groups/:gid/settlements/plan`; `DELETE /groups/:gid/settlements/:sid`.
- Recurring: `GET|POST /groups/:gid/recurring`;
  `PATCH|DELETE /groups/:gid/recurring/:rid`.
- Import: `POST /groups/:gid/import/analyze` (dry run),
  `POST /groups/:gid/import` (multipart CSV upload).

## Settlement and import details

Settlement plans can use group-net transfers allocated through the debt graph
or direct pairwise debts. A member involved in the selected plan cannot leave or
be removed until clear. Splitwise member columns contain **net balances** (the
payer's portion is already deducted), not raw shares. Imported rows must be in
the group's base currency, have real calendar dates, and their shares must sum
to the cost exactly; an import is capped at 20,000 rows.

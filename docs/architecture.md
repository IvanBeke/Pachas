# Architecture

Pachas is a Nuxt 4 / Vue 3 single-page app (`ssr: false`) with Nitro API routes
and a local SQLite database. Spanish is the default UI language; English is
also available.

## Source layout

- `src/app/` — pages, components, composables, assets, and client utilities.
- `src/server/api/` — authenticated API routes.
- `src/server/utils/` — database access, validation, permissions, and domain logic.
- `src/shared/` — logic shared by browser and server, including split calculations.
- `src/i18n/` — locale messages.
- `src/scripts/` — database migration/seed entrypoint and test-data cleanup.
- `src/tests/` — unit, property, DOM, and API contract tests.
- `src/` also contains the package manifests and Nuxt/TypeScript/Vitest config.

## Server-owned money

The browser sends the user's selections; the server computes and validates all
persisted amounts. `src/shared/splits.ts` is used for previews and server-side
calculation, so the two cannot drift. Settlement amounts and Splitwise imports
are likewise derived or re-parsed on the server before storage.

Groups support recurring expenses with required start dates and optional,
inclusive end dates. A group's base currency is fixed once it has expenses
because each expense stores a base-currency amount.

## Database and startup

`src/server/db/schema.ts` is the schema source of truth. Generate SQLite
migrations; never hand-edit migration SQL. Production startup and the dev
entrypoint apply migrations and idempotent category seeds before serving.

The runtime uses `drizzle-orm/libsql` with `DATABASE_PATH` (default
`/data/pachas.sqlite`). SQLite migrations are applied with Node's built-in
`node:sqlite`. The database is persisted in a Compose volume.

## Route map

- Authentication: `/login`, `/logout`, `/me`, `/register`, `/config`, `/health`.
- Site-wide: `/users/search`, `/categories`, `/admin/*`.
- Groups: group settings and membership; expenses; settlements and plans;
  recurring expenses; Splitwise import analyze/commit.

## Settlement and import details

Settlement plans can use group-net transfers allocated through the debt graph
or direct pairwise debts. A member involved in the selected plan cannot leave or
be removed until clear. Splitwise member columns contain **net balances** (the
payer's portion is already deducted), not raw shares.

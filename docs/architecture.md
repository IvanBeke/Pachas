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
Everything has two decimals: what people type (amounts, item prices, exact
splits) and what the server derives (the base-currency amount, shares, balances,
settlements). A converted total is rounded to the cent (10 USD × 0.9213 = 9.21 €).
A group's base currency is fixed once it has expenses because each expense stores
a base-currency amount.

Shares are whole cents: 10 ÷ 3 = 3.34 / 3.33 / 3.33 and 10.01 ÷ 2 = 5.01 / 5.00.
Leftover cents go to the largest remainders (so 8.867 rounds up and 8.893 down),
and remainders that tie (all of an equal split) are awarded **round-robin**. The
group keeps a cursor (`groups.rounding_cursor`) into its members sorted by id
(`roundingRing`); the person at the cursor, then the next ones, get the extra
cent, and the cursor moves past the last tie-break winner, so over time everyone
gets the same number of extra cents. Shares always sum to the total exactly.

The cursor only moves inside the group write transaction: when an expense is
created or a recurring occurrence is generated. Editing an expense recomputes
its shares with the current cursor but does not move it, so re-saving an expense
recomputes it with the current rule. The client receives `roundingCursor` with the
group so previews show what the server will store.

History: amounts were stored in mills (thousandths) for a while (migration
`0008`). Migration `0010` went back to cents: every stored amount was divided by 10
(rounded half up), and the shares of each expense, the allocations of each
settlement and the splits of each recurring template were reallocated, with the same
largest-remainder rule, so they still sum exactly to their rounded total. Exact
half-cent ties alternate between the lower and higher user id from one expense to
the next. Groups with recorded settlements were rounded too, so their balances
can have moved by a few cents and a settled debt can leave a cent-sized residual.

## Title → category links

A site admin can link an expense title to a category (admin screen, "Title
links" tab). A link is global: one normalised title maps to one category, and a
category can have many titles. Only the normalised title is stored and shown
(`normalizeText` in `src/shared/text.ts`: lower-case, no accents, single
spaces) and incoming titles are compared in that form; they must match the
whole title; the matcher in `src/shared/category-links.ts` is used by both
the browser and the server. Deleting a category re-points its links to the
category its expenses move to, instead of letting `ON DELETE CASCADE` drop them.

Links are applied in two places. In the expense and recurring-template forms the
category follows the title as the user types (a linked title selects its
category, a title with no link returns to General), until they pick a category
themselves; editing never changes a stored category on open, and the server does
not override the category it is sent. The Splitwise import resolves each row on
the server: a linked title wins over the CSV category mapping.

## Default category

An expense's (and a recurring template's) `category` is a foreign key to
`categories.id`, `ON DELETE RESTRICT`: a category in use cannot be deleted, so the
admin delete route first moves its expenses, templates and title links to another
category. The API still speaks string ids; `groups.ts` converts at the database
boundary.

New forms start in the default category: the one titled "General", or the first
if an admin has renamed it (`defaultCategory` in `src/shared/categories.ts`, used
by the browser and by `loadCategoryContext` on the server). On every expense and
recurring route a missing or empty category becomes the default and an unknown id
is a 400 `bad_category`. Splitwise imports use the default when a row has neither
a title link nor a mapped CSV category.

## Recurring expenses

A recurring expense is a template (weekly, monthly or yearly, with a start date
and optional inclusive end date). `src/server/plugins/recurring.ts` runs
`generateRecurringExpenses` at startup and hourly; creating a template also
generates anything already due. Each template records `generated_through`, and
generated expenses carry `recurring_id` with a unique `(recurring_id, date)`
index, so occurrences are created exactly once. Dates are UTC calendar dates;
monthly/yearly schedules clamp to the end of short months. Editing a template
affects future occurrences only. A template keeps the split selection
(`split_input`: participants and typed values), and every occurrence recomputes
its shares from it with the group's round-robin cursor, so the extra cent
rotates between occurrences. Templates saved before `split_input` existed keep
copying their stored split until they are edited. An occurrence whose payer or participants are
no longer group members is skipped and logged.

## Group page data flow

The group page polls `GET /api/groups/:gid/summary` (group, expenses,
settlements, and the settlement plan). Every write to a group runs through
`lockGroup`, which bumps `groups.version`; the summary's ETag is that version,
so unchanged polls get an empty `304`. Polling backs off while nothing changes
and pauses while the tab is hidden. The settlement plan is cached per group
version on the server.

From 768px wide the Expenses tab shows the net balances in a column inside the
usual page width (`NetBalances`, shared with the Balances tab), using the free
space in the list rows. The column is only as wide as its content (capped at
200px) and the list takes the rest. It reuses the balances already polled from
`/summary`, so it needs no extra request.

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
  `PATCH /me` (name, language, theme, password).
- Public: `GET /health`, `GET /config` (whether registration is open).
- Users: `GET /users/search?q=` (3+ characters), `GET /users?ids=` (only users
  who share a group with you; at most 100 ids).
- Categories: `GET /categories`; site admin: `POST /categories`,
  `PATCH /categories/:id`, `DELETE /categories/:id` (moves expenses and
  recurring templates to another category).
- Category links: `GET /category-links` (any signed-in user); site admin:
  `POST /category-links`, `PATCH /category-links/:id`, `DELETE /category-links/:id`.
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

# Conventions and invariants

These are project-level rules for changes that affect money, access, or UI
behavior.

## Money and server authority

- Never persist amounts computed by the browser. Send selections and compute
  values on the server; client calculations are previews only. This includes
  the base-currency amount, which the server derives from amount × rate.
- Money is stored as integer cents. Convert only through `src/shared/money.ts`
  (`toCents`, `fromCents`, `round2`), and only at the database boundary in
  `src/server/utils/groups.ts`. Totals must match exactly; there are no rounding
  tolerances. There is a single precision: a converted amount is rounded to the cent
  (`round2(amount * rate)`).
- Hand out a total over weights only through `allocateRoundRobin` (via
  `computeSplits`): leftover cents go to the largest remainders and
  ties are awarded round-robin. Never break ties by input order in real
  code. The group's `rounding_cursor` is read and advanced only inside the group
  write transaction (`createExpense`, recurring generation); an edit uses it but
  never advances it. Compute splits inside that transaction, not before it.
- Use the shared split implementation (`src/shared/splits.ts`) when both
  browser and server need it. An itemised split is computed from the bill
  stored in the expense description, never from a separate field.
- Validate money at each boundary. `Infinity` is especially dangerous:
  arithmetic can produce `NaN`, which defeats ordinary comparisons. Use
  `Number.isFinite` for inputs. Amounts are capped at `MAX_AMOUNT`.
- Keep the server authoritative for settlements and Splitwise imports too.
- Group base currency is immutable after expenses exist.

## Categories

- An expense or recurring template stores a category **id** (a foreign key, never a
  name); the server validates it with `readCategory` and falls back to the default
  (General). See [architecture](./architecture.md#default-category).
- Pick the default only through `defaultCategory` (`shared/categories.ts`), and
  delete a category only through `deleteCategoryMigrating`.

## Title links

- Compare titles only through `normalizeText` and the shared matcher
  (`shared/category-links.ts`); never re-implement matching in a component or
  route. Match whole titles, not substrings.
- Category links are admin-managed global data: reads need a session, writes
  need the site admin role. Deleting a category must go through
  `deleteCategoryMigrating` so its links are moved, not cascaded away.

## Authorization and sessions

- `src/server/utils/group-permissions.ts` is the group authorization source of
  truth. Permission checks run inside the write transaction, against the same
  snapshot the write applies to (`authorizeWrite` in `groups.ts`).
- Site admins manage categories and see the admin overview. Site admin status
  grants **no** group permissions.

| Action | Creator | Group admin | Member |
|---|---|---|---|
| Add expenses, recurring expenses, settlements they owe or are owed | ✓ | ✓ | ✓ |
| Edit or delete any expense / recurring expense | ✓ | ✓ | own only |
| Record a settlement between two other people | ✓ | ✓ | — |
| Delete a settlement | recorder only | recorder only | recorder only |
| Add members | ✓ | ✓ | — |
| Change group settings, import from Splitwise | ✓ | ✓ | — |
| Remove another member / change roles | ✓ | ✓ (not the creator) | — |
| Transfer the creator role, delete the group | ✓ | — | — |
| Leave the group (when settled up) | — | ✓ | ✓ |

- For expenses and recurring expenses, a request the caller may not perform
  returns **404**, the same as a missing record, so ownership isn't revealed.
  Other group routes return 403 to members and non-members alike.
- Group roles (`creator`, `admin`, `member`) are separate from the site role,
  which is only returned to the user themselves (`/api/me`).
- Password hashing is asynchronous. Passwords are 8–72 bytes (bcrypt's limit).
  Login is rate limited per address, per address + account, and per account
  globally; only failures count. Registration and user search are rate limited.
  `X-Forwarded-For` is ignored unless `TRUST_PROXY` is set.
- Session cookies contain random tokens; SQLite stores only their keyed
  digests. Sessions last 30 days; expired rows are purged hourly. Changing a
  password ends every other session and rotates the current one.
- State-changing API requests must be same-origin and JSON (multipart for
  imports), and are size-limited (`src/server/middleware/request-guard.ts`).

## Vue and localization

- A page with tabs keeps each tab in its own component (`components/group/`,
  `components/admin/`). The page owns the tab switch, auth and the toast; tabs
  load their own data and report failures with an `error` event.
- Every page sets its browser title with `usePageTitle([...])`, segments from most
  to least specific. The ` · Pachas` suffix comes from the `titleTemplate` in
  `app.vue`, so don't add it by hand. The default tab of a page adds no segment.
- Keep modal form state local so polling does not erase in-progress input.
- Group polling updates list data, not modal forms or a global page rerender.
- Derive per-row display values in `computed`s, not template expressions.
- Render category titles through `translatedTitle(cat, locale)`; `cat.title` is
  the base-language value. Load categories through `useCategories()`.
- Never use `v-html` for user-controlled text. Use `<i18n-t>` with named slots
  when translated word order must wrap components.
- Emoji fields (group emoji, category icon) use `EmojiPicker` in the UI and
  `readEmoji` (`server/utils/emoji-input.ts`) on the server. Never `slice` an
  emoji: flags, skin tones and ZWJ sequences span several UTF-16 units.
- The picker's dataset (`app/utils/emoji-data.generated.json`) is generated from
  `emojibase-data` with `pnpm emoji:generate`; don't edit it by hand. Add custom
  search words in `scripts/emoji-extra-keywords.json` and regenerate. A unit test
  fails when the committed file is stale.

## Routes and shared code

- Nitro `[gid]`, `[eid]`, and `[sid]` parameters are filename parameters. Read
  them with `requireParam`, and bodies with `readJsonObject`.
- Use `src/shared/` for logic imported by both client and server. Keep server-
  only utilities in `src/server/utils/`.
- Deployment settings are read from `process.env` at runtime
  (`src/server/utils/env.ts`), never from `runtimeConfig`, which Nuxt freezes
  at build time.
- A route file and a directory with the same name can change Nuxt's nesting.
  Use `index.vue` where a dynamic route needs sibling child pages.

## Migrations

- Generate migrations from the schema; don't write DDL by hand.
- When a migration changes how existing data is represented, add the data
  conversion to the generated file and cover it with a migration test (see
  `src/tests/migration-cents.test.ts`, `migration-mills.test.ts` and
  `migration-money-cents.test.ts`). A data-only
  migration can be created with `drizzle-kit generate --custom`.

## Regression tests

- Put lasting behavioral checks in `src/tests/`; don't rely on throwaway
  scripts or fixtures.
- Prefer generated/property-based cases for algorithm behavior. Mutate a new
  guard or algorithm and confirm its test fails before trusting the test.
- When changing a mutation/API path, update its read paths and client state in
  the same change.

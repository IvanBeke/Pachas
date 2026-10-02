# Conventions and invariants

These are project-level rules for changes that affect money, access, or UI
behavior.

## Money and server authority

- Never persist amounts computed by the browser. Send selections and compute
  values on the server; client calculations are previews only.
- Use the shared split implementation when both browser and server need it.
- Validate money at each boundary. `Infinity` is especially dangerous:
  arithmetic can produce `NaN`, which defeats ordinary comparisons. Use
  `Number.isFinite` for inputs and computed reconciliation differences.
- Keep the server authoritative for settlements and Splitwise imports too.
- Group base currency is immutable after expenses exist; `amountBase` is stored
  in each expense.

## Authorization and sessions

- `src/server/utils/group-permissions.ts` is the group authorization source of
  truth. Site-wide admin status is separate and grants no group permissions.
- Group creators/admins can manage group-wide settings and expenses; members
  generally manage only their own records. A non-owner should receive 404 rather
  than 403 for another member's expense.
- Group roles (`creator`, `admin`, `member`) are separate from platform roles.
- Password hashing is asynchronous. Login and registration are rate limited;
  only failed logins count toward the limiter.
- Session cookies contain random tokens; SQLite stores only their keyed
  digests. Keep all session creation, lookup, and logout paths on the same
  digest scheme.

## Vue and localization

- Keep modal form state local so polling does not erase in-progress input.
- Group polling updates list data, not modal forms or a global page rerender.
- Render category titles through `translatedTitle(cat, locale)`; `cat.title` is
  the base-language value.
- Never use `v-html` for user-controlled text. Use `<i18n-t>` with named slots
  when translated word order must wrap components.

## Routes and shared code

- Nitro `[gid]`, `[eid]`, and `[sid]` parameters are filename parameters. Count
  relative imports carefully from the route's directory.
- Use `src/shared/` for logic imported by both client and server. Keep server-
  only utilities in `src/server/utils/`.
- A route file and a directory with the same name can change Nuxt's nesting.
  Use `index.vue` where a dynamic route needs sibling child pages.

## Regression tests

- Put lasting behavioral checks in `src/tests/`; don't rely on throwaway
  scripts or fixtures.
- Prefer generated/property-based cases for algorithm behavior. Mutate a new
  guard or algorithm and confirm its test fails before trusting the test.
- When changing a mutation/API path, update its read paths and client state in
  the same change.

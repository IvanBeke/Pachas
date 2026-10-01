# Security review and remediation plan

Baseline: commit `1f4fa65` ("pre audit") on branch **`main`** (renamed from
`master` at the user's request). Everything after that commit is the audit diff,
so it can be reviewed in one pass.

Scope: full read of every route in `server/api/`, `server/utils/`, `shared/`,
container config, and a production-dependency audit. Every finding below was
either read directly from the source or verified with a live probe; the three
highest-severity items were confirmed empirically rather than reasoned about.

Status legend: `[ ]` open, `[x]` fixed.

---

## Summary

No critical vulnerabilities. No stored-XSS surface, no SQL injection, no
cross-group IDOR, and the money math is genuinely server-authoritative. One
high-severity availability bug, one high-severity data-integrity bug, and one
known high-severity CVE in a production dependency that is not currently
reachable.

| # | Severity | Finding |
|---|---|---|
| 1 | High | Unauthenticated DoS: synchronous bcrypt + no rate limiting |
| 2 | High | `NaN` defeats the split reconciliation guard |
| 3 | High | `drizzle-orm@0.44.7` — GHSA-gpj5-g38j-94v9 (not reachable) |
| 4 | Medium | Malformed cookie → uncaught `URIError` → 500 on every authed route |
| 5 | Medium | Upload cap enforced after full buffering; body parsed 3× |
| 6 | Medium | Any member can add any user to a group |
| 7 | Low | No security headers on app pages; `x-powered-by` disclosed |
| 8 | Low | Login username enumeration via timing |
| 9 | Low | User directory enumeration via `users/search` |
| 10 | Low | Plain members cannot leave a group |
| 11 | Low | `baseCurrency` editable after expenses exist |
| 12 | Low | No `__Host-` cookie prefix; first-wins duplicate parsing |
| 13 | Low | Unbounded `memberIds` / `translations` arrays |

---

## Tier 1 — small, high value, no policy decisions

### 1. Unauthenticated DoS via synchronous bcrypt + no rate limiting

`server/api/login.post.ts:8` calls `bcrypt.compareSync`; `register.post.ts:54`
calls `bcrypt.hashSync`. `bcryptjs@3.0.3` is a pure-JS implementation, so both
**block Node's single thread** for the whole hash. Measured in the running
container:

```
compareSync blocks the event loop for ~48.0ms
=> ~20 sequential logins/sec, all serialized on one thread
```

There is no rate limiting on any endpoint in the app. So ~20 requests/second
from a single unauthenticated connection fully saturates the server. This is
worse than credential stuffing — it is a one-connection denial of service that
needs no valid credentials, and `register` is open by default.

- [x] Use the async bcrypt API (`compare`/`hash`) so hashing yields the event loop.
- [x] Add rate limiting on `/login` (per account **and** per IP) and `/register`.

  Two design points that the first attempt got wrong:

  - **Only failed logins are recorded.** A successful sign-in never consumes
    the budget. The first version counted every attempt, which made the API
    contract suite throttle *itself* — the suite signs in repeatedly from one
    address, indistinguishable from credential stuffing. The limiter now offers
    `peek` (check, used before the expensive hash) and `hit` (record, used only
    on failure).
  - **The per-IP limit is a CPU ceiling, not a household limit.** Per-account is
    tight at 10 failures per 5 minutes. Per-IP sits at 200, because everyone
    behind one NAT address shares that bucket and a tight value locks out a real
    family. The DoS itself is fixed by async hashing, not by the limit.

  There is deliberately **no test bypass**. A control switchable by an
  environment variable is one stray variable away from being off in production;
  the failures-only design removed the need for one instead.

  Verified: 13 wrong passwords for one account give 10× `401` then `429`, and a
  correct login immediately afterwards still returns `200`. Five consecutive
  suite runs pass with no restart, so the limiter no longer fights the tests.

### 2. `NaN` defeats the split reconciliation guard

`readExpenseInput` validates only `!amount || amount <= 0`, which `Infinity`
passes. `amount: "1e400"` → `Number()` → `Infinity` → `computeSplits` produces
`{Infinity, NaN}` → `sumSplits` → `NaN` → the reconciliation comparison
`Math.abs(sum - target) > 0.05` evaluates to `false` because `NaN` compares
false against everything. The request is accepted.

A group member can therefore write `Infinity`/`NaN` into the ledger, which
propagates through `getBalances` and the settlement plan for every member and is
only fixable by hand in SQL. This defeats the invariant `AGENTS.md` describes as
the core safety net.

- [x] Reject non-finite `amount`, `amountBase`, `exchangeRate`, and item prices.
- [x] Make the reconciliation comparison NaN-safe so it cannot be defeated.
- [x] Regression test in `tests/splits.test.ts`.

### 3. `drizzle-orm@0.44.7` — GHSA-gpj5-g38j-94v9

`pnpm audit --prod` reports a high-severity SQL injection via improperly
escaped SQL **identifiers**, fixed in `>=0.45.2`.

Reachability was checked: **not currently exploitable.** The only two ``sql` ``
templates are `SELECT 1` and
`lower(${users.username}) = lower(${username})` — the first static, the second
value-bound. Every `from()`/`orderBy()` is a static schema reference. No user
input reaches an identifier position. It is still a live high-severity advisory
one refactor away from being reachable, and arrives transitively via
`@nuxtjs/i18n > unstorage > db0`.

- [x] Bump `drizzle-orm` to `>=0.45.2` and re-run the suite + typecheck.

---

## Tier 2 — integrity and resource limits

### 4. Malformed cookie → uncaught `URIError` → 500

`parseCookieHeader` calls `decodeURIComponent(value)` with no guard, so
`Cookie: pachas.sid=%` throws an unhandled `URIError` on every route that calls
`requireUser`. Confirmed live:

```
Cookie: pachas.sid=%   -> HTTP 500
[request error] [unhandled] [GET] /api/me  URIError: URI malformed
```

Unauthenticated, one request, hits every protected route. Error bodies do not
leak a stack trace, so impact is limited to 500s, unhandled-exception log spam,
and availability.

- [x] Guard the decode; an unparseable cookie is treated as absent (401).

### 5. Upload cap enforced after full buffering; body parsed 3×

`readMultipartFormData` buffers the entire request into memory, and only then
does `import-input.ts:18` check `MAX_BYTES`. A cap checked after the fact is not
a DoS bound. Separately, `import/index.post.ts` calls it **three times** (file
plus two mapping fields), re-parsing the whole body each time. h3 does cache the
raw body via `event.node.req[RawBodySymbol]`, so this is functionally correct
but triples parse cost and peak memory on the largest allowed upload.

- [x] Reject on `Content-Length` before reading the body.
- [x] Parse the multipart body once and reuse the parts for the file and both
      mapping fields.

---

## Tier 3 — authorization policy

These three were genuine design questions rather than unambiguous bugs. The
chosen behaviour is recorded next to each so it can be revisited.

### 6. Any member can add any user to a group

`members.post.ts` required only `requireMember`, while *removal* required
creator-or-admin. Addition is the disclosure path — it grants read access to the
group's full expense history — so the asymmetry was backwards.

- [x] **Decision:** adding a member requires the group creator or a site admin,
      matching removal. Ordinary members can still create their own groups and
      add people to those, which is how the app is meant to bootstrap.
- [x] UI already agreed: the add button in `g/[id]/edit.vue` was gated on the
      same `canManage` computed, so no change was needed there.

### Current group-role policy

The product later intentionally changed the membership policy: all group
members may add people, and newly added users receive the `member` role. This
supersedes the earlier creator/admin-only decision above. The disclosure risk
remains; it is accepted as a product requirement. Group authorization now uses
the `group_members.role` enum and `server/utils/group-permissions.ts`, separate
from site-wide app-admin status.

### 7. `baseCurrency` editable after expenses exist

`amountBase` is denormalized into every expense row, so switching a group's
base currency silently reinterprets the entire historical ledger with no
conversion and no guard. One authorized click, irreversible.

- [x] **Decision:** once a group has any expense, `baseCurrency` is frozen.
      Name, emoji, and `simplifyTransfers` stay editable.
- [x] The currency `<select>` is disabled and the hint text changes, so the UI
      does not offer an action the server will reject with a 409.

### 8. Plain members cannot leave a group

`members/[uid].delete.ts` rejected `uid === me.id` for everyone, so a
non-creator member is stuck until the creator or an admin removes them. The
guard only makes sense for the creator (to avoid orphaning the group).

- [x] **Decision:** any member may remove themselves. The creator is still
      blocked, since a group with no creator cannot be administered.
- [x] Added a "Leave group" control to the group edit page for non-creators.
      Without it the server rule would have been correct but unreachable.

---

## Tier 4 — defence in depth

- [x] **7. Security headers.** `/` returned only `x-powered-by: Nuxt`. The
      `script-src 'none'` and `X-Frame-Options: DENY` seen earlier belong to
      Nitro's *error page* only, so they never protect the SPA. Added CSP,
      `X-Content-Type-Options`, `Referrer-Policy`, and `frame-ancestors` via
      `routeRules`, and removed the `x-powered-by` fingerprint.
- [x] **8. Login timing.** `if (!u || !bcrypt.compareSync(...))` short-circuits,
      skipping the hash entirely for a nonexistent user, so a missing username
      returns ~48 ms faster. Now a dummy hash is always computed, so the
      response time does not reveal whether the account exists.
- [x] **9. User enumeration.** `users/search` passed the query into `ilike`
      unescaped, so `q=%` matched every user, and there was no minimum query
      length. Escaped the wildcards and required a minimum length.
- [x] **10. `__Host-` cookie prefix.** `pachas.sid` was a bare name, and
      `parseCookieHeader` takes the *first* occurrence of a duplicate, leaving
      it open to cookie tossing from a sibling subdomain. Added the `__Host-`
      prefix, which browsers only accept without `Domain` and over a secure
      connection.
- [x] **11. Registration enumeration.** `register` returned 409 "That username
      is already taken", a free oracle. Kept the 409 (it is genuinely useful
      feedback) but that is now moot as a *timing* channel; the remaining
      disclosure is the same one every site with a taken-username error has.
- [x] **12. Unbounded arrays.** `groups/index.post.ts` passed `memberIds`
      straight into an `IN (...)` with no length cap; `categories/index.post.ts`
      inserted one row per client-supplied translation key with no cap and no
      locale validation. Capped both and validated locales against a pattern.

---

## Repository housekeeping

- [x] **Rename the default branch `master` → `main`.** Done as part of standing
      this up: `git init` produced `master`, renamed with `git branch -m main`.
      `ci.yml` triggers on `[main, master]`, so it kept working either way; the
      trigger list was left alone rather than narrowed, since narrowing it to
      only `main` would silently stop CI if a push ever landed on `master`.

---

## Deliberately not changed

Stated so these are decisions, not oversights:

- **`x-powered-by` on the db container and other cosmetic hardening** — out of
  scope.
- **Peppering password hashes with `SESSION_SECRET`.** `bcryptjs` is adequate
  for passwords as configured. Mixing a secret into password verification is a
  larger change with real migration risk, and is better handled by moving to
  Argon2id.
- **Session count limits / "log out everywhere".** A real gap, but a feature
  rather than a fix. Rotating `SESSION_SECRET` already provides global
  revocation.
- **Sliding session renewal.** 30-day fixed expiry is a deliberate simplicity
  trade-off for a self-hosted household app.

---

## Verification

Per `AGENTS.md`, every behavioural fix ships with a Vitest test, and each new
test is mutation-checked — the source is deliberately broken and the suite is
confirmed to fail before the test is trusted.

- `tests/expense-integrity.test.ts` — non-finite amounts, rates, item prices;
  a generated sweep asserting every share is finite and reconciles.
- `tests/rate-limit.test.ts` — `hit`/`peek` behaviour, key independence, window
  reset, bounded memory under key flooding, and IP extraction.
- `tests/api.contract.test.ts` — malformed cookie → 401; login rate limiting;
  security headers; poisoned amount rejected; member-add authorization;
  currency freeze; self-removal; wildcard search.
- `tests/session-token.test.ts` — existing, guards the digest invariant.

### What mutation testing actually revealed

Two of the new tests did **not** bite on the first attempt, and finding out why
changed both the tests and the fix:

1. **The `Infinity` guard is layered three deep** — a finite check on
   `amount`/`amountBase` in `readExpenseInput`, a `bad_amount` result in the
   shared `computeSplits`, and a finite check on the computed shares. Removing
   any *one* of the three left the others to reject the request, so the test
   passed every time and proved nothing. Only after removing all three did it
   fail (`expected false to be true`, 3 tests). The layering is deliberate and
   worth keeping, but it means a single-layer regression is invisible to this
   test — the test pins the *property*, not any one line.

2. **The wildcard-search test was vacuous.** It queried `q=%`, which is one
   character, so the new minimum-length check rejected it before the query ever
   reached `ILIKE`. The escaping was never exercised. Rewritten to use
   two-character wildcards (`%%`, `__`, `_%`), which clears the length check;
   with escaping removed the test then failed with `expected 8 to be 0` — the
   full directory dump. This is the clearest example in the review of a test
   that passed for the wrong reason.

Mutation checks that passed on the first attempt: member-add authorization
(`403` expected, `200` received when removed), the malformed-cookie guard, and
`destroySession` digesting (from the earlier session work).

### Live probes

- **DoS fix:** under 12 concurrent login floods, worst-case `/api/health`
  latency was **9 ms**. Before the fix each login blocked the event loop ~48 ms,
  so ~20 req/s from one connection saturated the server. The limiter returns
  `429` once the per-account or per-IP bucket is exhausted.
- **Cookie fix:** `Cookie: pachas.sid=%`, `%zz`, and `abc%` all return `401`.
  Each returned `500` with `[unhandled] URIError: URI malformed` before.
- **CVE:** `pnpm audit --prod` → *No known vulnerabilities found*
  (`drizzle-orm` 0.44.7 → 0.45.3).
- **Import still works** after the multipart rewrite: a 2-row Spanish-header
  Splitwise CSV committed, with balances of admin `+6.50` / beke `-6.50` on a
  €13 total and a matching `beke -> admin 6.50` transfer.
- **i18n** remains at full parity: 240 keys in each of `es` and `en`, none
  missing on either side.

### Final state

`179 tests passing across 10 files, 0 type errors`, against the live container,
and **five consecutive suite runs pass without restarting the app** — the
limiter is process state, so repeatability had to be demonstrated, not assumed.
Real data untouched: 4 users, 2 groups, 1270 expenses / €64,183.00.

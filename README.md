# Pachas

A self-hosted, Splitwise-style shared expense splitter. Groups,
multi-currency expenses (with a manual exchange rate), balances, settle-up
suggestions, an activity feed, recurring expenses, Splitwise CSV import, and
its own accounts — no external service required. The interface is in Spanish
or English; the default is **Spanish**. Default currency is EUR.

It's a Nuxt 4 (Vue 3) app backed by a local **SQLite** database inside the
container. Docker Compose persists the database file in a named volume.

## Features

- **Groups** with emoji, base currency, and members you can add or remove.
- **Expenses** in any of 19 currencies, converted with a manual exchange rate.
- **Five ways to split**: equally, by exact amount, by percentage, by share
  weight, or itemised (assign each line of a bill to whoever had it, with tax
  and tip). Expenses can be edited or deleted afterwards.
- **Balances** and **settle-up suggestions** — who should pay whom, with
  simplified group netting or direct pairwise debts (see below).
- **Recurring expenses** (weekly / monthly / yearly) with a start date.
- **Splitwise CSV import** — drop in an export file, match the members and
  categories, and the whole file is imported in one go.
- **Activity feed** per group, and an **admin area** for managing the shared
  category list and reviewing users and groups.
- Multi-language UI (es/en), dark-friendly styling, no external services.

## Security

- **Passwords** are hashed with `bcryptjs` (cost 10). Hashing is asynchronous,
  and sign-in and sign-up are rate limited per IP *and* per account name.
- **Sessions** are a 32-byte random token in an `httpOnly`, `SameSite=Lax`
  cookie. The database stores `HMAC-SHA256(SESSION_SECRET, token)`, not the
  token, so a database backup is not a set of usable session cookies. Changing
  `SESSION_SECRET` logs everyone out everywhere.
- **The server computes all the money.** The browser sends *which* split was
  chosen and who takes part; the server derives the amounts and rejects
  anything that does not reconcile. Non-finite amounts (`Infinity`, `NaN`) are
  refused outright — they would otherwise make every balance in a group `NaN`.
- **Authorization** is checked per request. Group roles are separate from the
  site-wide admin role. Members cannot leave or be removed while the selected
  settlement plan still involves them.
- **Response headers** include a Content-Security-Policy, `X-Frame-Options`,
  `nosniff`, and `Referrer-Policy`. The framework banner is stripped.
- **The container** runs as an unprivileged user, ships production
  dependencies only, and includes its SQLite runtime—there is no database
  service to configure or expose.

`security_fixes.md` documents a full security review of the codebase, the
issues it found, and how each was verified.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set `SESSION_SECRET` to a random value. `DATABASE_PATH` is
   optional and defaults to `/data/pachas.sqlite` inside the container.

2. From this folder, run:

   ```bash
   docker compose up -d --build
   ```

   This starts the app with its SQLite file in the persistent `pachas-data`
   volume. Schema migrations are applied automatically before the server starts.

3. Open `http://<your-server>:3000` and create the first account. **The first
   account created becomes the admin** — it gets the admin area for managing
   categories. Everyone else is a regular user.

4. Once your household/group has accounts, set `ALLOW_REGISTRATION: "false"`
   in `compose.yaml` and re-run `docker compose up -d --build` so random
   visitors can't sign themselves up if the port is ever reachable from
   outside your LAN.

## Configuration

Set in `.env` (used by `compose.yaml`):

| Variable | Description |
|---|---|
| `DATABASE_PATH` | SQLite database path inside the container. Optional; defaults to `/data/pachas.sqlite`. Keep custom paths under `/data`, or mount the custom directory in `compose.yaml`, so the file persists across container replacement. |
| `SESSION_SECRET` | Secret used to key stored session digests. **Required** — the app refuses to start without it (see note below). Generate one with `openssl rand -hex 32`. |

> **Note on `SESSION_SECRET`:** your browser's session cookie holds a random
> 32-byte token. The database does **not** store that token — it stores
> `HMAC-SHA256(SESSION_SECRET, token)`. So a database backup does not hand over
> usable session cookies; the digests are useless without the secret in your
> `.env`.
>
> Two consequences worth knowing:
> - Sessions survive restarts and rebuilds, because they live in the database
>   rather than in process memory.
> - **Changing `SESSION_SECRET` logs out every user on every device.** There
>   is no way to preserve sessions across a rotation, by design.

Set directly in `compose.yaml` under the `pachas` service:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the app listens on inside the container. |
| `ALLOW_REGISTRATION` | `true` | Set to `false` to close self-service sign-up. |
| `COOKIE_SECURE` | `false` | Set to `true` only if serving over HTTPS (e.g. behind a reverse proxy doing TLS termination). Leave `false` for plain HTTP on your LAN — otherwise login cookies won't be sent and you won't be able to log in. |

## Data & backups

Everything (users, groups, expenses, settlements, categories, and sessions)
lives in `/data/pachas.sqlite` in the `pachas_pachas-data` Docker volume. Stop
the app briefly before copying the file so SQLite can checkpoint its WAL:

```bash
docker compose stop pachas
docker cp pachas:/data/pachas.sqlite ./pachas-backup.sqlite
docker compose start pachas
```

To restore that backup:

```bash
docker compose stop pachas
docker cp ./pachas-backup.sqlite pachas:/data/pachas.sqlite
docker compose start pachas
```

## Reverse proxy / HTTPS

To expose Pachas outside your LAN, put it behind a reverse proxy (Caddy,
Traefik, nginx, or your existing one) that terminates HTTPS, and
set `COOKIE_SECURE: "true"`. Don't expose port 3000 directly to the internet
over plain HTTP — login credentials and session cookies would travel
 unencrypted. Only the `pachas` service needs to be reachable.

## Updating

```bash
docker compose pull    # if you're pulling a pre-built image
docker compose up -d --build
```

Your data stays in the `pachas_pachas-data` volume across
rebuilds/updates. The app applies pending database migrations on every start,
so new columns/tables in future versions apply automatically — existing data is
never dropped.

### Pre-built images

Every green build on `main` publishes a multi-arch image (`linux/amd64` and
`linux/arm64`) to `ghcr.io/ivanbeke/pachas`, tagged with the branch, the git
SHA, and `latest` for the default branch. To use it instead of building locally,
point the `pachas` service at the image:

```yaml
  pachas:
    image: ghcr.io/ivanbeke/pachas:latest
```

Images are signed keylessly with cosign, so you can check what you pulled:

```bash
cosign verify ghcr.io/ivanbeke/pachas@sha256:<digest>
```

## Uninstalling

```bash
docker compose down          # stop and remove the containers
docker compose down -v       # also delete all stored data — irreversible
```


## How it works

- **Backend**: `server/api/` — Nitro server routes. Sessions are token-based
  (an `app_sessions` table in SQLite, so they survive restarts), and the
  stored value is a keyed digest rather than the cookie itself; passwords are
  hashed with `bcryptjs` in the login and register routes.
- **The server does all the money maths.** The browser is never trusted: the
  client sends *which* split was chosen and who takes part, and the server
  computes the actual amounts and rejects anything that doesn't add up. The
  same applies to settle-ups (the amount is derived from the real debt) and
  to the CSV import (the file is re-parsed on the server). The front end only
  computes a preview, using the same shared module so the two can't drift.
- Startup applies pending Drizzle migrations from the container entrypoint —
  no manual migration step. Schema source of truth is `server/db/schema.ts`;
  generate new migrations with `nuxt db generate` (see `AGENTS.md`).
- **Frontend**: `app/pages/` + `app/components/` + `app/composables/` +
  `app/utils/` — Vue 3 SPA (no SSR), no separate build tooling beyond
  Nuxt/Vite. It polls the server every few seconds so everyone sees
  roughly-live balances. Each modal owns its form state locally, so
  background refreshes never wipe what you're typing.
- **Settle-up suggestions**: simplified mode nets the group and suggests
  debtor-to-creditor transfers that can be allocated along outstanding debt
  paths, so intermediaries can be netted out. Pairwise mode instead suggests
  each outstanding debt between the people connected by expense shares.
  Recorded settlements retain the actual sender/recipient and persist which
  underlying pairwise debts the payment clears. Members involved in the
  selected plan cannot leave or be removed until those suggested payments are
  settled; switching to pairwise mode is blocked if it would involve former
  members.
- **CSV import**: a Splitwise export is a file where each member column holds
  that person's *net* balance for the row (the payer's own share is already
  deducted). The importer derives each member's share from the negative
  balances and gives the payer the remainder, so an equal two-person split
  lands as two equal shares rather than one person owing everything.

## Development

Contributors should read [`AGENTS.md`](./AGENTS.md) first — it documents the
project conventions, the testing setup, and the traps that have bitten before.
In short: everything runs through Docker, verification goes through Vitest,
and CI runs both on every push.

### Tests and typecheck

```bash
pnpm test        # unit + property tests (no server or database needed)
pnpm typecheck   # vue-tsc, must stay at 0 errors
```

Both run through Docker so the host stays clean — the `dev` service is the pnpm
image with the source bind-mounted and `node_modules` in a named volume:

```bash
docker compose run --rm --no-deps dev pnpm test
docker compose run --rm --no-deps dev pnpm typecheck
```

The contract tests reach the running app over the compose network. They create
their own throwaway users and group, and **skip themselves** if no server is
reachable — so `pnpm test` stays green in CI, where there is no database. To run
just those:

```bash
PACHAS_API=http://pachas:3000 docker compose run --rm --no-deps -e PACHAS_API dev pnpm test:api
```

Some API contract fixtures and throwaway accounts are intentionally retained.
Clean up reserved test data afterwards with:

```bash
docker compose exec pachas node scripts/cleanup-test-data.mjs
```

CI (`.github/workflows/ci.yml`) runs install → `nuxt prepare` → tests →
typecheck on every push and pull request.

# Pachas

A self-hosted, Splitwise-style expense splitter for groups. Track expenses,
balances, recurring expenses, settlement suggestions, and Splitwise imports. The
interface is available in Spanish and English (Spanish by default); no external
service is required.

## Features

- Groups with members, emoji, a base currency, and roles (creator, admin,
  member). Members can leave a group once they owe and are owed nothing; the
  creator can hand the group over or delete it.
- Multi-currency expenses with five ways to split a bill: equal, exact amounts,
  percentages, shares, or itemised.
- Group-net (simplified) or direct pairwise settlement suggestions.
- Recurring expenses (weekly, monthly, yearly) that the server turns into real
  expenses on schedule, with an optional end date.
- Splitwise CSV import, an activity feed, and a profile page (name, language,
  password).
- A site admin area with usage counts and category management.

## Stack

- Nuxt 4 and Vue 3 SPA with Nitro API routes.
- Local SQLite database persisted in a Docker volume.
- pnpm-managed Node 26 runtime.

## Production quick start

1. Copy `.env.example` to `.env` and set `SESSION_SECRET` to the output of
   `openssl rand -hex 32`. Set `ALLOW_REGISTRATION=true` for now.
2. Start the production image:

   ```bash
   docker compose -f compose.prod.yaml up -d
   ```

3. Open `http://localhost:3000` (the port is bound to `127.0.0.1` by default;
   see [deployment](./docs/deployment.md) to expose it) and register your
   account.
4. Make that account the site administrator:

   ```bash
   docker compose -f compose.prod.yaml exec pachas node scripts/make-admin.mjs <username>
   ```

5. Once everyone has an account, set `ALLOW_REGISTRATION=false` in `.env` and
   run `docker compose -f compose.prod.yaml up -d` again.

## Development

The default `compose.yaml` runs the hot-reload development app:

```bash
docker compose up -d
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local development and testing.

## Documentation

- [Architecture](./docs/architecture.md)
- [Conventions and security](./docs/conventions.md)
- [Deployment, configuration, and backups](./docs/deployment.md)
- [Verification](./docs/verification.md)

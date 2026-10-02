# Pachas

A self-hosted, Splitwise-style expense splitter for groups. Track expenses,
balances, recurring expenses, settlement suggestions, and Splitwise imports. The
interface is available in Spanish and English (Spanish by default); no external
service is required.

## Features

- Groups with members, emoji, and a base currency.
- Multi-currency expenses with five ways to split a bill.
- Group-net and pairwise settlement suggestions.
- Recurring expenses with start and optional end dates.
- Splitwise CSV import, activity feed, and an admin area.

## Stack

- Nuxt 4 and Vue 3 SPA with Nitro API routes.
- Local SQLite database persisted in a Docker volume.
- pnpm-managed Node 26 runtime.

## Production quick start

1. Copy `.env.example` to `.env` and set `SESSION_SECRET` to the output of
   `openssl rand -hex 32`.
2. Start the production image:

   ```bash
   docker compose -f compose.prod.yaml up -d
   ```

3. Open `http://<your-server>:3000` and create the first account; it becomes the
   site administrator.
4. Close sign-ups by setting `ALLOW_REGISTRATION` to `false` in
   `compose.prod.yaml` and restarting the service.

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

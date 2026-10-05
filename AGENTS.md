# Agent instructions

Pachas is a Nuxt 4 / Vue 3 SPA (`ssr: false`) with Nitro API routes and local
SQLite. Application code and package/tooling config live in `src/`; Docker,
Compose, GitHub workflows, and human-facing docs stay at the repository root.

## Before changing code

- Read the relevant shared project guidance:
  - [`docs/architecture.md`](./docs/architecture.md) for app structure and data flow.
  - [`docs/conventions.md`](./docs/conventions.md) for security and coding invariants.
  - [`docs/deployment.md`](./docs/deployment.md) for deployment, backup, and configuration details.
  - [`docs/verification.md`](./docs/verification.md) for commands and test requirements.
- Money values persisted by the app are server-authoritative. Do not trust
  computed client values for storage.

## Required workflow

- Run Node/pnpm tooling through Docker Compose; never on the host.
- Start development with `docker compose up -d`. Run tests and typecheck with
  `docker compose run --rm --no-deps pachas pnpm test` and
  `docker compose run --rm --no-deps pachas pnpm typecheck`.
- API contract tests need the app running:
  `docker compose run --rm --no-deps -e PACHAS_API=http://pachas:3000 pachas pnpm test:api`.
- Production uses `docker compose -f compose.prod.yaml pull` followed by
  `docker compose -f compose.prod.yaml up -d`; it runs
  `ghcr.io/ivanbeke/pachas:latest` and persists SQLite data in the
  `pachas_pachas-data` volume.

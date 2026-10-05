# Development and verification

## Compose environments

- `compose.yaml` is the development stack. It bind-mounts `src/`, keeps
  `node_modules` and the dev database in named volumes, and runs `pnpm dev` with
  hot reload. Polling is enabled for bind-mounted source files by default; set
  `PACHAS_DEV_USE_POLLING=false` when native file events work to reduce CPU use.
- `compose.prod.yaml` uses the published
  `ghcr.io/ivanbeke/pachas:latest` image and persists data in
  `pachas_pachas-data`.
- Copy `.env.example` to `.env` and set `SESSION_SECRET` with
  `openssl rand -hex 32`. `DATABASE_PATH` defaults to `/data/pachas.sqlite`.
- On Docker Desktop, Compose may create an empty `src/node_modules` mountpoint
  on the host. Package contents stay in the named `pachas-dev-node-modules`
  volume; never install dependencies on the host.

## Tests and typecheck

Run project tooling through the development service:

```bash
docker compose run --rm --no-deps pachas pnpm test
docker compose run --rm --no-deps pachas pnpm typecheck
```

Vitest has `unit` (pure logic/property tests), `dom` (happy-dom), and `api`
(live-server contract tests) projects. API tests self-skip when the server is
unreachable. To exercise them against the dev app:

```bash
docker compose up -d
docker compose run --rm --no-deps -e PACHAS_API=http://pachas:3000 pachas pnpm test:api
docker compose exec pachas pnpm exec node scripts/cleanup-test-data.mjs
```

Use plain `vitest/config`, not `@nuxt/test-utils`: booting Nuxt test utils can
make `@nuxthub/core` clear `.data/`, which is unsafe with host bind mounts.

## Database changes

Change `src/server/db/schema.ts`, then generate migrations with:

```bash
docker compose run --rm --no-deps pachas pnpm db:generate
```

Never hand-edit generated migration SQL. App startup applies pending migrations.

## Dependencies and CI

- `src/pnpm-workspace.yaml` keeps dependency build scripts strict and allows
  only reviewed scripts. Adding a package to `allowBuilds` requires reviewing
  its lifecycle scripts.
- `.github/workflows/ci.yml` runs Nuxt prepare, Vitest, and typecheck. A separate
  image job builds the production Dockerfile. Published GHCR images are
  multi-arch and keylessly signed.
- Actions are pinned to commit SHAs; checkout credentials are not persisted.

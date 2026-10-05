# Development and verification

## Compose environments

- `compose.yaml` is the development stack. It bind-mounts `src/`, keeps
  `node_modules` and the dev database in named volumes, and runs `pnpm dev` with
  hot reload. Polling is enabled for bind-mounted source files by default; set
  `PACHAS_DEV_USE_POLLING=false` when native file events work to reduce CPU use.
- `compose.prod.yaml` uses the published
  `ghcr.io/ivanbeke/pachas:latest` image and persists data in
  `pachas_pachas-data`. See [deployment](./deployment.md) for its settings.
- Copy `.env.example` to `.env` and set `SESSION_SECRET` with
  `openssl rand -hex 32` (at least 32 bytes). The dev stack always allows
  registration and binds to `127.0.0.1:3000`. Use
  `docker compose exec pachas pnpm make-admin <username>` to get a site admin.
- On Docker Desktop, Compose may create an empty `src/node_modules` mountpoint
  on the host. Package contents stay in the named `pachas-dev-node-modules`
  volume; never install dependencies on the host.

## Tests and typecheck

Run project tooling through the development service:

```bash
docker compose run --rm --no-deps pachas pnpm test
docker compose run --rm --no-deps pachas pnpm typecheck
```

`pnpm test` runs the `unit` project: pure logic, property tests, and a
migration test that runs `scripts/migrate.mjs` against a temporary database.
The `api` project holds the live-server contract tests; they self-skip when the
server is unreachable. To exercise them against the dev app:

```bash
docker compose up -d
docker compose run --rm --no-deps -e PACHAS_API=http://pachas:3000 pachas pnpm test:api
docker compose exec pachas pnpm exec node scripts/cleanup-test-data.mjs
```

The suite registers about 25 accounts per run, and registration is limited to
60 per hour per address, so restart the app (`docker compose restart pachas`)
between repeated runs. Test accounts all start with `__t`; the cleanup script
removes exactly those and the groups whose members are all test accounts.

Use plain `vitest/config`, not `@nuxt/test-utils`: booting Nuxt test utils can
make `@nuxthub/core` clear `.data/`, which is unsafe with host bind mounts.

## Database changes

Change `src/server/db/schema.ts`, then generate migrations with:

```bash
docker compose run --rm --no-deps pachas pnpm db:generate
```

Don't write DDL by hand. If a change alters how existing data is stored, add
the conversion statements to the generated file and add a migration test. App
startup applies pending migrations (`scripts/migrate.mjs`); NuxtHub's own
migration runner is disabled.

## Dependencies and CI

- `src/pnpm-workspace.yaml` only runs dependency build scripts listed in
  `allowBuilds` (pnpm's default is to block the rest); adding a package there
  requires reviewing its lifecycle scripts. `minimumReleaseAge: 1440` refuses
  package versions published less than a day ago.
- `.github/workflows/ci.yml` runs Nuxt prepare, Vitest, and typecheck. A separate
  image job builds the production Dockerfile. Published GHCR images are
  multi-arch and keylessly signed.
- Actions are pinned to commit SHAs, and Dependabot (`.github/dependabot.yml`)
  proposes updates to them weekly. Docker base images use version tags
  (`node:26-slim`, `ghcr.io/pnpm/pnpm:12`), so each image build picks up their
  latest patches. Checkout credentials are not persisted.

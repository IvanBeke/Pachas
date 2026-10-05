# Contributing to Pachas

Thanks for contributing.

For architecture and security invariants, see
[`docs/architecture.md`](./docs/architecture.md) and
[`docs/conventions.md`](./docs/conventions.md). Verification commands are in
[`docs/verification.md`](./docs/verification.md).

## Maintainer scope disclaimer

I built this app around my own day-to-day usage and preferences.

Contributions are welcome, but I may decline changes that do not match how I
want this project to evolve or how I personally use it.

## Workflow

- Start from a clear task or issue.
- Keep changes minimal and scoped.
- Use Docker for all app, database and toolchain operations — never on the host.
- Run commands from the repository root.

## Local setup

```bash
cp .env.example .env
```

Set `SESSION_SECRET` in `.env`; generate it with `openssl rand -hex 32`. Compose
won't start without it, and the server refuses to start if it is shorter than
32 bytes or still the example placeholder. The dev database is
`/data/pachas.sqlite` in the `pachas-dev-data` volume.

```bash
docker compose up -d
```

This starts the development app at `http://localhost:3000`. Source is
bind-mounted for hot reload, and dependencies are installed into a named Docker
volume so dependency changes do not require rebuilding an image. Migrations and
built-in categories are applied before Nuxt starts. For production, use
`docker compose -f compose.prod.yaml up -d`.

Polling is enabled by default in the development Compose service so edits made
from WSL are detected across the Windows-mounted source directory. On a native
Linux filesystem with working file events, set `PACHAS_DEV_USE_POLLING=false` in
`.env` to reduce watcher CPU usage. This setting only affects development.

Dependency files must stay in the named Docker volume, so run installs and
checks through the development service:

```bash
docker compose run --rm --no-deps pachas pnpm install
docker compose run --rm --no-deps pachas pnpm test
docker compose run --rm --no-deps pachas pnpm typecheck
```

## Verification required before opening a PR

Run, in this order:

```bash
docker compose run --rm --no-deps pachas pnpm test
docker compose run --rm --no-deps pachas pnpm typecheck
```

`pnpm test` runs the unit, property and migration suites and needs no running
server.
`pnpm typecheck` must report **0 errors** — do not silence one by relaxing a
compiler flag.

Then, with the app running, run the contract suite (it self-skips when no server
is reachable, so a green run means nothing unless one was actually up). It
reaches the app over the compose network:

```bash
docker compose run --rm --no-deps -e PACHAS_API=http://pachas:3000 pachas pnpm test:api
```

If your change touches authorization, balances or settlements, say so in the PR —
those paths are the ones with real money behind them.

Afterwards, clean up the throwaway rows the suite leaves behind:

```bash
docker compose exec pachas pnpm exec node scripts/cleanup-test-data.mjs
```

**Verification goes through Vitest, in `src/tests/`.** Do not verify behavior with
ad-hoc scripts, one-off commands or throwaway fixtures — they cannot catch
regressions, and anything worth checking twice belongs in a test. A passing
suite is not proof on its own: mutate the source and confirm a test actually
fails before trusting a new test.

## What CI does with your branch

`ci.yml` runs the unit tests and typecheck, and separately builds the Docker
image, so a Dockerfile that no longer builds fails before anything ships. When
both are green on `main`, `docker-publish.yml` pushes the image to GHCR and
signs it. CodeQL scans JavaScript/TypeScript on pushes to `main` and pull
requests targeting it.

Two consequences for contributors:

- **A pull request from a fork is not checked by CI at all** — neither tests,
  typecheck, nor the image build run, because they execute repository code on
  a GitHub runner. Run the verification steps above locally, and ask for the
  branch to be pushed here if you need CI.
- **Actions are pinned to commit SHAs.** If you touch a workflow and see a
  `@abc123… # v3`, leave the comment as the version label and update both
  together — `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` is how you resolve
  a new SHA.

## Code conventions

See [`docs/conventions.md`](./docs/conventions.md) for money, authorization,
shared-code, UI, and security rules. See [`docs/architecture.md`](./docs/architecture.md)
for the server/client boundary, routes, and database workflow.

## Pull requests

- Use an imperative title/message style.
- Describe scope, verification commands run, and any migration impact.
- Include screenshots for UI changes when helpful.

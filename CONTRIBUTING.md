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

Set `SESSION_SECRET` in `.env`; generate it with `openssl rand -hex 32`. The app
refuses to start without it. `DATABASE_PATH` is optional and defaults to the
SQLite file `/data/pachas.sqlite` inside the app container.

```bash
docker compose up -d
```

This starts the development app at `http://localhost:3000`. Source is
bind-mounted for hot reload, and dependencies are installed into a named Docker
volume so dependency changes do not require rebuilding an image. Migrations and
built-in categories are applied before Nuxt starts. For production, use
`docker compose -f compose.prod.yaml up -d`.

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

`pnpm test` runs the unit and property suites and needs no server or database.
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
signs it. CodeQL scans JavaScript/TypeScript on every push and pull request.

Two consequences for contributors:

- **A pull request from a fork is not built.** `docker build` runs repository
  code on a GitHub runner, so CI skips it unless the branch lives in this
  repository. Ask for a branch to be pushed here if you need the image check.
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

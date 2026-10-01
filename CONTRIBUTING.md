# Contributing to Pachas

Thanks for contributing.

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

Set `POSTGRES_PASSWORD` and `SESSION_SECRET` in `.env`; generate the secret with
`openssl rand -hex 32`. The app refuses to start without either.

```bash
docker compose up -d --build
```

The container applies any pending schema migrations before serving, so there is
no manual migrate step. The app is then on `http://localhost:3000`.

Dependency installs must not pollute the host, so run them in the `dev` service —
the pnpm image with the source bind-mounted and `node_modules` in a named volume:

```bash
docker compose run --rm --no-deps dev pnpm install
```

## Verification required before opening a PR

Run, in this order:

```bash
docker compose run --rm --no-deps dev pnpm test
docker compose run --rm --no-deps dev pnpm typecheck
```

`pnpm test` runs the unit and property suites and needs no server or database.
`pnpm typecheck` must report **0 errors** — do not silence one by relaxing a
compiler flag.

Then, with the app running, run the contract suite (it self-skips when no server
is reachable, so a green run means nothing unless one was actually up). It
reaches the app over the compose network:

```bash
PACHAS_API=http://pachas:3000 docker compose run --rm --no-deps -e PACHAS_API dev pnpm test:api
```

If your change touches authorization, balances or settlements, say so in the PR —
those paths are the ones with real money behind them.

Afterwards, clean up the throwaway rows the suite leaves behind:

```bash
cat scripts/cleanup-test-data.sql | docker compose exec -T db psql -U pachas pachas -v ON_ERROR_STOP=1
```

**Verification goes through Vitest, in `tests/`.** Do not verify behavior with
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

## Style and conventions

- **The server is authoritative.** All money math happens server-side. The
  client sends the *selection* (`splitType`, `participants`, `values`), never
  precomputed amounts, and the server recomputes and rejects anything that does
  not reconcile. Same rule for settlements and for the Splitwise importer, whose
  file is re-parsed on commit rather than trusted from a client-side parse.
- **Share logic instead of duplicating it.** Anything both the browser and the
  server need belongs in `shared/`, imported by both. `shared/splits.ts` is the
  single implementation of `computeSplits` precisely so the two cannot drift.
- Put code that only the server needs in `server/utils/`. Mind the relative
  depth: Nitro route params are file names, not directories, so count the `../`
  segments to reach `server/utils/`.
- Use plain `vitest/config` in tests, not `@nuxt/test-utils`. Booting the Nuxt
  pipeline needs a live database. Name suites `*.test.ts`, contract tests
  `api.*.test.ts`, component tests `*.dom.test.ts`.
- Migrations are generated, never hand-written: change `server/db/schema.ts`,
  then run `nuxt db generate`. Seed data belongs in the migration that owns the
  table, not a new one.
- Group access and authorization use `group_members.role` and
  `server/utils/group-permissions.ts`. Group roles (`creator`, `admin`,
  `member`) are separate from the site-wide `users.role`; never use app-admin
  status to grant group permissions.
- Render category titles through `translatedTitle(cat, locale)`, and never use
  `v-html` for user-supplied data such as display names.
- Do not hardcode secrets.

## Pull requests

- Use an imperative title/message style.
- Describe scope, verification commands run, and any migration impact.
- Include screenshots for UI changes when helpful.

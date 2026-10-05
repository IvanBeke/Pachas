# Deployment and operations

## Configuration

Copy `.env.example` to `.env`. `compose.prod.yaml` reads these values at
container start, so changing one only needs `docker compose -f compose.prod.yaml up -d`.

| Variable | Default | Meaning |
|---|---|---|
| `SESSION_SECRET` | — (required) | At least 32 bytes; generate with `openssl rand -hex 32`. The server refuses to start without a valid one. Rotating it signs everyone out. |
| `ALLOW_REGISTRATION` | `false` | Allow new accounts to sign up. |
| `COOKIE_SECURE` | `false` | `true` only behind HTTPS. Also enables HSTS. Changing it signs everyone out (the cookie is renamed). |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the app. With `0`, `X-Forwarded-For` is ignored and rate limits use the connecting address. Set to `1` behind a single proxy. |
| `PACHAS_BIND` | `127.0.0.1` | Host interface the port is published on. Use `0.0.0.0` to expose it on the LAN. |
| `PORT` | `3000` | Host port to publish. The container always listens on 3000. |
| `DATABASE_PATH` | `/data/pachas.sqlite` | SQLite path inside the container. Keep it under `/data`, the mounted volume. |

The development stack (`compose.yaml`) sets its own values and only reads
`SESSION_SECRET` and `PACHAS_DEV_USE_POLLING` from `.env`. The contract tests
read `PACHAS_API`.

## First run and site admins

Sites start with registration closed and no administrator. To set up:

1. Set `ALLOW_REGISTRATION=true`, start the stack, and register your account.
2. Promote it:

   ```bash
   docker compose -f compose.prod.yaml exec pachas node scripts/make-admin.mjs <username>
   ```

   Add `--revoke` to demote an admin.
3. When everyone has an account, set `ALLOW_REGISTRATION=false` and run
   `docker compose -f compose.prod.yaml up -d`.

## Data and backups

Both Compose files set the project name `pachas`, so production data lives in
`/data/pachas.sqlite` in the `pachas_pachas-data` volume.

Take a consistent backup while the app runs with SQLite's `VACUUM INTO`, which
writes a single self-contained file (no `-wal` / `-shm` companions):

```bash
docker compose -f compose.prod.yaml exec pachas node -e \
  "new (require('node:sqlite').DatabaseSync)('/data/pachas.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
docker compose -f compose.prod.yaml cp pachas:/data/backup.sqlite ./pachas-backup.sqlite
docker compose -f compose.prod.yaml exec pachas rm /data/backup.sqlite
```

To restore, stop the app, replace the database, and remove any leftover WAL
files so they aren't replayed onto the restored copy:

```bash
docker compose -f compose.prod.yaml stop pachas
docker compose -f compose.prod.yaml cp ./pachas-backup.sqlite pachas:/data/pachas.sqlite
docker compose -f compose.prod.yaml run --rm --no-deps --entrypoint sh pachas \
  -c 'rm -f /data/pachas.sqlite-wal /data/pachas.sqlite-shm'
docker compose -f compose.prod.yaml start pachas
```

The app applies pending migrations on startup without dropping existing data.
Take a backup before upgrading across a release that includes a migration.

## HTTPS and updates

To expose Pachas beyond the host, put it behind a TLS-terminating reverse proxy
and set `COOKIE_SECURE=true` and `TRUST_PROXY=1`. Keep `PACHAS_BIND=127.0.0.1`
when the proxy runs on the same host. Do not expose plain HTTP to the public
internet. The proxy must pass the original `Host` header so same-origin checks
on writes succeed.

Production uses the signed, multi-arch `ghcr.io/ivanbeke/pachas` image:

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

Builds of `main` are tagged `main`, `sha-<full commit SHA>`, and `latest`, and
signed keylessly with cosign. Verify a specific digest with:

```bash
cosign verify ghcr.io/ivanbeke/pachas@sha256:<digest>
```

The image's healthcheck polls `/api/health`. The container runs as the
unprivileged `node` user, which can write only to `/data`.

## Recurring expenses

Due recurring expenses are created at startup and every hour, using UTC dates.
After an upgrade from a version without generation, existing templates start
from the upgrade date; earlier occurrences are not back-filled.

## Uninstalling

```bash
docker compose down
docker compose -f compose.prod.yaml down
```

Adding `-v` removes that stack's named volumes and permanently deletes its
stored data.

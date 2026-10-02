# Deployment and operations

## Configuration

Copy `.env.example` to `.env` and set `SESSION_SECRET` (`openssl rand -hex 32`).
Both Compose files require it. Rotating it invalidates every session: the
database stores keyed session digests, not reusable cookie values.

| Variable | Meaning |
|---|---|
| `DATABASE_PATH` | Production SQLite path, default `/data/pachas.sqlite`. Keep custom paths under `/data` and mount the containing directory. Development uses `/data/pachas.sqlite` in its own volume. |
| `PORT` | Container port; default `3000`. |
| `ALLOW_REGISTRATION` | `true` by default. Set to `false` in `compose.prod.yaml` after creating accounts. |
| `COOKIE_SECURE` | `false` for plain HTTP on a LAN. Set to `true` only behind HTTPS. |

## Data and backups

Production data lives in `/data/pachas.sqlite` in the `pachas_pachas-data`
volume. Stop the app while copying so SQLite can checkpoint its WAL:

```bash
docker compose -f compose.prod.yaml stop pachas
docker compose -f compose.prod.yaml cp pachas:/data/pachas.sqlite ./pachas-backup.sqlite
docker compose -f compose.prod.yaml start pachas
```

To restore:

```bash
docker compose -f compose.prod.yaml stop pachas
docker compose -f compose.prod.yaml cp ./pachas-backup.sqlite pachas:/data/pachas.sqlite
docker compose -f compose.prod.yaml start pachas
```

The app applies pending migrations on startup without dropping existing data.

## HTTPS and updates

Put the app behind a TLS-terminating reverse proxy and set `COOKIE_SECURE: "true"`
in `compose.prod.yaml`. Do not expose plain HTTP to the public internet.

Production uses the signed, multi-arch `ghcr.io/ivanbeke/pachas` image:

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

Images are signed keylessly with cosign and tagged with the branch, commit SHA,
and `latest` for the default branch. Verify a specific digest with:

```bash
cosign verify ghcr.io/ivanbeke/pachas@sha256:<digest>
```

## Uninstalling

```bash
docker compose down
docker compose -f compose.prod.yaml down
```

Adding `-v` removes that stack's named volumes and permanently deletes its
stored data.

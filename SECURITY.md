# Security notes

Pachas is built primarily for self-hosting on a private network.

## What this means

- Keep the app on a trusted LAN by default. The SQLite database is stored in a
  local file mounted in the app container.
- The production stack publishes its port on `127.0.0.1` only, and registration
  is closed, by default. See [deployment](./docs/deployment.md).
- If you expose Pachas to the public internet, put it behind a reverse proxy
  that terminates HTTPS. Set `COOKIE_SECURE=true` and `TRUST_PROXY=1`; do not
  expose port 3000 directly over plain HTTP.
- No account becomes a site administrator automatically. Promote one with
  `node scripts/make-admin.mjs <username>` inside the container. Open
  registration only while the intended accounts are being created.

## Self-hosting baseline

- Set `SESSION_SECRET` to a random value (`openssl rand -hex 32`). The server
  refuses to start without at least 32 bytes; rotating it invalidates all
  existing sessions.
- Keep the SQLite database file and its backups private. `DATABASE_PATH` can be
  used to choose its location inside the container.
- Keep `.env` private and never commit it. Commit placeholders in
  `.env.example`, never real credentials or secrets.
- Keep the app and its dependencies up to date, and maintain protected backups
  of the SQLite database.

## If you find a security issue

- Please do not post exploit details in a public issue.
- Use GitHub's private vulnerability reporting if it is enabled for this
  repository. Otherwise, open an issue with minimal, non-sensitive details and
  ask to coordinate privately with the maintainer.
- Include reproduction steps and impact in the private report so the issue can
  be assessed and fixed quickly.

## Secrets hygiene

- Never include passwords, session cookies, `.env` contents, or database dumps
  in issues or logs shared publicly.
- Rotate any key, password, or token that is accidentally exposed.

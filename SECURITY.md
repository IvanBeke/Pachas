# Security notes

Pachas is built primarily for self-hosting on a private network.

## What this means

- Keep the app and database on a trusted LAN by default.
- If you expose Pachas to the public internet, put it behind a reverse proxy
  that terminates HTTPS. Set `COOKIE_SECURE: "true"`; do not expose port 3000
  directly over plain HTTP.
- The first account created becomes the site administrator. Create it on a
  trusted network, then set `ALLOW_REGISTRATION: "false"` after the intended
  accounts have been created.

## Self-hosting baseline

- Set a strong, unique `POSTGRES_PASSWORD`.
- Set `SESSION_SECRET` to a random value (`openssl rand -hex 32`). It is
  required; rotating it invalidates all existing sessions.
- Keep `.env` private and never commit it. Commit placeholders in
  `.env.example`, never real credentials or secrets.
- Keep PostgreSQL unpublished; the provided Compose configuration exposes the
  app, not the database.
- Keep the app and its dependencies up to date, and maintain protected backups
  of the database.

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

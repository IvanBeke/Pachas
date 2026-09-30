import { createHmac } from "node:crypto";

/**
 * Session token handling.
 *
 * The cookie holds a 32-byte random token. The database does NOT: it stores
 * `HMAC-SHA256(SESSION_SECRET, token)`.
 *
 * Why: the raw token is the bearer credential — the exact string in the
 * browser's cookie. If it were also the primary key in `app_sessions`, then a
 * database backup, a SQL-injection read, or access to the db container would
 * hand over ready-to-use session cookies for every signed-in user, with no
 * cracking required. Keying the stored value with a secret that lives outside
 * the database removes that exposure, and makes rotating `SESSION_SECRET`
 * revoke every session at once.
 *
 * The token is already unguessable, so this does not make randomness stronger.
 * What it buys is "a leaked database is not a leaked session".
 */

/** Throws when no secret is configured. Never falls back to an unkeyed hash. */
export function requireSessionSecret(secret: string | undefined | null): string {
  const value = (secret ?? "").trim();
  if (!value) {
    throw new Error(
      "[pachas] SESSION_SECRET is not set. Sessions cannot be verified without it. " +
        "Set it in .env (openssl rand -hex 32).",
    );
  }
  return value;
}

/** The value stored in `app_sessions.token` for a given cookie token. */
export function sessionDigest(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

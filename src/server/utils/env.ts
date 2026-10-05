/**
 * Deployment settings, read from the process environment at call time.
 *
 * These deliberately bypass `runtimeConfig`: Nuxt inlines `runtimeConfig`
 * defaults at build time, so values set on the published image's container
 * would otherwise be ignored. Reading `process.env` directly keeps
 * `compose.prod.yaml` authoritative.
 */

const PLACEHOLDER_SECRETS = new Set(["change-this-to-a-long-random-string"]);
const MIN_SECRET_BYTES = 32;

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function allowRegistration(): boolean {
  return flag("ALLOW_REGISTRATION", false);
}

export function cookieSecure(): boolean {
  return flag("COOKIE_SECURE", false);
}

/**
 * Number of reverse-proxy hops whose `X-Forwarded-For` entries are trusted.
 * `0` (the default) ignores the header entirely.
 */
export function trustedProxyHops(): number {
  const n = Number.parseInt(process.env.TRUST_PROXY?.trim() || "0", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}

/** Returns a reason the secret is unusable, or `null` when it is fine. */
export function sessionSecretProblem(secret: string | undefined): string | null {
  const value = (secret ?? "").trim();
  if (!value) return "SESSION_SECRET is not set";
  if (PLACEHOLDER_SECRETS.has(value)) {
    return "SESSION_SECRET is still the .env.example placeholder";
  }
  if (Buffer.byteLength(value, "utf8") < MIN_SECRET_BYTES) {
    return `SESSION_SECRET must be at least ${MIN_SECRET_BYTES} bytes`;
  }
  return null;
}

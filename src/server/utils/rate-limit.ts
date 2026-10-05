import { trustedProxyHops } from "./env";

/**
 * Fixed-window rate limiter, in process memory.
 *
 * Scope: this is a single-instance, self-hosted app. An in-process map is
 * enough to blunt credential stuffing and, more importantly, to bound how much
 * password-hashing CPU any one client can request. It is not a distributed
 * limiter and makes no claim to be — running multiple app replicas would need a
 * shared store.
 *
 * Entries are swept lazily on access, so a burst of distinct keys cannot grow
 * the map without bound.
 *
 * The API contract suite deliberately stresses this: it registers throwaway
 * users and hammers the limiter from a single address. There is no test bypass
 * — a security control that can be switched off by an environment variable is
 * one stray variable away from being off in production. Instead the login route
 * only *records* failures (see `peek`/`hit`), so a successful sign-in never
 * consumes the attack budget and the suite's legitimate logins don't collide
 * with it.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Above this many tracked keys, every access sweeps expired windows. */
const MAX_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

let lastSweep = Date.now();

function sweepIfDue(now: number): void {
  if (now - lastSweep < 1000 && windows.size < MAX_KEYS) return;
  lastSweep = now;
  sweep(now);
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

const ALLOW: RateLimitResult = { ok: true, retryAfter: 0 };

/**
 * Checks a bucket *without* recording a hit. Used before doing expensive work
 * (a password hash) so a blocked client is rejected cheaply, and so that a
 * successful attempt doesn't count against the limit.
 */
export function peek(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) return ALLOW;
  if (w.count < limit) return ALLOW;
  return { ok: false, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
}

/**
 * Records one failed attempt against `key` and reports whether it is still
 * within `limit` for the current window. `key` should combine every dimension
 * worth limiting on — e.g. IP and account name — so that neither rotating IPs
 * nor rotating usernames alone gets an attacker more attempts.
 */
export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return ALLOW;
  }

  existing.count += 1;
  if (existing.count <= limit) return ALLOW;
  return {
    ok: false,
    retryAfter: Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Reads the client's IP.
 *
 * `X-Forwarded-For` is client-controlled unless a trusted proxy rewrites it, so
 * it is ignored unless `trustedHops` (from `TRUST_PROXY`) is set. With N
 * trusted hops, the client is the Nth entry from the right; anything further
 * left could have been supplied by the client and is never used.
 */
export function clientIp(
  event: {
    node: {
      req: {
        headers: Record<string, unknown>;
        socket?: { remoteAddress?: string | undefined };
      };
    };
  },
  trustedHops: number = trustedProxyHops(),
): string {
  const socketIp = event.node.req.socket?.remoteAddress ?? "unknown";
  if (trustedHops <= 0) return socketIp;
  const fwd = event.node.req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd.join(",") : fwd;
  if (typeof raw !== "string" || !raw.length) return socketIp;
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) return socketIp;
  return entries[Math.max(0, entries.length - trustedHops)] ?? socketIp;
}

/** Test seam: drops all recorded state. */
export function resetRateLimits(): void {
  windows.clear();
  lastSweep = Date.now();
}

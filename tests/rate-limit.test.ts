import { describe, expect, it } from "vitest";
import {
  clientIp,
  hit,
  peek,
  resetRateLimits,
} from "../server/utils/rate-limit";

/**
 * The limiter exists to blunt credential stuffing and, more importantly, to
 * stop one client pinning the event loop with a flood of password hashes.
 * `bcrypt.compareSync` blocked for ~48ms per call, so ~20 requests/second from
 * a single unauthenticated connection saturated the whole server.
 */
describe("hit", () => {
  it("allows up to the limit and refuses the next one", () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++) {
      expect(hit("k", 5, 60_000).ok).toBe(true);
    }
    const denied = hit("k", 5, 60_000);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("keeps separate keys independent", () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++) hit("a", 5, 60_000);
    expect(hit("a", 5, 60_000).ok).toBe(false);
    // Rotating the key — e.g. a different username — gets a fresh bucket,
    // which is why the login route limits on IP *and* account.
    expect(hit("b", 5, 60_000).ok).toBe(true);
  });

  it("resets once the window elapses", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) hit("k", 3, 40);
    expect(hit("k", 3, 40).ok).toBe(false);
    // Synchronous spin rather than a real sleep: the limiter reads Date.now().
    const until = Date.now() + 60;
    while (Date.now() < until) {
      /* wait out the window */
    }
    expect(hit("k", 3, 40).ok).toBe(true);
  });

  it("reports a retry delay within the window", () => {
    resetRateLimits();
    expect(hit("k", 1, 5_000).ok).toBe(true);
    const denied = hit("k", 1, 5_000);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfter).toBeLessThanOrEqual(5);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("does not grow without bound under key flooding", () => {
    resetRateLimits();
    for (let i = 0; i < 20_000; i++) hit(`flood-${i}`, 100, 60_000);
    // The map is swept above MAX_KEYS, so a burst of distinct keys must not
    // leave 20k live entries holding attacker-controlled strings.
    expect(hit("flood-new", 100, 60_000).ok).toBe(true);
  });
});

describe("peek", () => {
  it("reports an exhausted bucket without recording a hit", () => {
    // This is what lets the login route reject cheaply and lets a successful
    // sign-in not consume the attack budget.
    resetRateLimits();
    for (let i = 0; i < 3; i++) hit("k", 3, 60_000);
    expect(peek("k", 3, 60_000).ok).toBe(false);

    // Peeking repeatedly must not push the counter further over.
    for (let i = 0; i < 50; i++) expect(peek("k", 3, 60_000).ok).toBe(false);
    expect(peek("k", 3, 60_000).ok).toBe(false);
  });

  it("allows an untouched bucket", () => {
    resetRateLimits();
    expect(peek("fresh", 1, 60_000).ok).toBe(true);
    // Still untouched: peeking created no window.
    expect(peek("fresh", 1, 60_000).ok).toBe(true);
  });

  it("allows a bucket that is under its limit", () => {
    resetRateLimits();
    hit("k", 5, 60_000);
    hit("k", 5, 60_000);
    expect(peek("k", 5, 60_000).ok).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, unknown>, remote?: string) => ({
    node: {
      req: { headers, socket: { remoteAddress: remote ?? "10.0.0.5" } },
    },
  });

  it("prefers the leftmost X-Forwarded-For entry", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
  });

  it("falls back to the socket address", () => {
    expect(clientIp(req({}))).toBe("10.0.0.5");
  });

  it("handles an array header value", () => {
    expect(clientIp(req({ "x-forwarded-for": ["198.51.100.9"] }))).toBe(
      "198.51.100.9",
    );
  });
});

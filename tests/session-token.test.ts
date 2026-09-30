import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  requireSessionSecret,
  sessionDigest,
} from "../server/utils/session-token";

/**
 * The database must never hold the session cookie value.
 *
 * `app_sessions.token` is the primary key. If it stored the raw cookie token,
 * then a DB backup, a SQL-injection read, or `docker exec` into the db
 * container would yield ready-to-use session cookies for every signed-in
 * user — the one place a bearer credential would sit in plaintext. These
 * tests pin the digest that prevents that.
 */
const SECRET = "test-secret-not-the-real-one";

describe("requireSessionSecret", () => {
  it("accepts a configured secret", () => {
    expect(requireSessionSecret(SECRET)).toBe(SECRET);
  });

  it("throws when unset rather than falling back to an unkeyed hash", () => {
    // A silent fallback would restore the exact weakness the digest exists to
    // remove, and nothing would notice. Failing loudly is the whole point.
    expect(() => requireSessionSecret("")).toThrow(/SESSION_SECRET/);
    expect(() => requireSessionSecret(undefined)).toThrow(/SESSION_SECRET/);
    expect(() => requireSessionSecret(null)).toThrow(/SESSION_SECRET/);
    expect(() => requireSessionSecret("   ")).toThrow(/SESSION_SECRET/);
  });

  it("trims surrounding whitespace", () => {
    expect(requireSessionSecret("  abc  ")).toBe("abc");
  });
});

describe("sessionDigest", () => {
  it("never returns the token it was given", () => {
    // The property that matters: the stored value cannot be replayed as a
    // cookie, because it is not the cookie.
    for (let i = 0; i < 200; i++) {
      const token = randomBytes(32).toString("hex");
      expect(sessionDigest(token, SECRET)).not.toBe(token);
    }
  });

  it("is a 64-char hex string (fits the existing text primary key)", () => {
    const digest = sessionDigest(randomBytes(32).toString("hex"), SECRET);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic, so a cookie resolves back to its own row", () => {
    const token = "a".repeat(64);
    expect(sessionDigest(token, SECRET)).toBe(sessionDigest(token, SECRET));
  });

  it("differs per token", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(sessionDigest(randomBytes(32).toString("hex"), SECRET));
    }
    expect(seen.size).toBe(500);
  });

  it("differs per secret, so rotating the secret revokes every session", () => {
    // This is the operational payoff: change SESSION_SECRET and no previously
    // issued cookie can match any stored row any more.
    const token = randomBytes(32).toString("hex");
    const before = new Set<string>();
    const after = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = randomBytes(32).toString("hex");
      before.add(sessionDigest(t, SECRET));
      after.add(sessionDigest(t, "rotated-secret"));
    }
    for (const digest of before) expect(after.has(digest)).toBe(false);
  });

  it("is not a plain unkeyed hash of the token", () => {
    // Guards against someone 'simplifying' this to createHash() later and
    // quietly removing the DB-compromise protection.
    const token = randomBytes(32).toString("hex");
    const unkeyed = createHash("sha256").update(token).digest("hex");
    expect(sessionDigest(token, SECRET)).not.toBe(unkeyed);
  });
});

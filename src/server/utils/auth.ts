import { randomBytes } from "node:crypto";
import type { H3Event } from "h3";
import { and, eq, gt, lte, ne, sql } from "drizzle-orm";
import { runtimeDb as db } from "./client";
import { appSessions, users } from "../db/schema";
import {
  requireSessionSecret,
  sessionDigest as sessionDigestWith,
} from "./session-token";
import { cookieSecure } from "./env";

const SESSION_COOKIE_BASE = "pachas.sid";
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

function parseCookieHeader(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && !(k in out)) {
      let decoded = v;
      try {
        decoded = decodeURIComponent(v);
      } catch {
        decoded = v;
      }
      out[k] = decoded;
    }
  }
  return out;
}

function serializeCookie(
  name: string,
  value: string,
  opts: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    path?: string;
    maxAge?: number;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}

function appendSetCookie(event: H3Event, cookie: string): void {
  const prev = event.node.res.getHeader("Set-Cookie");
  if (!prev) {
    event.node.res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(prev)) {
    event.node.res.setHeader("Set-Cookie", [...prev, cookie]);
  } else {
    event.node.res.setHeader("Set-Cookie", [String(prev), cookie]);
  }
}

function readCookie(event: H3Event, name: string): string | undefined {
  return parseCookieHeader(event.node.req.headers.cookie)[name];
}

function writeCookie(
  event: H3Event,
  name: string,
  value: string,
  opts: Parameters<typeof serializeCookie>[2],
): void {
  appendSetCookie(event, serializeCookie(name, value, opts));
}

function removeCookie(
  event: H3Event,
  name: string,
  opts: { path?: string } = {},
): void {
  appendSetCookie(event, serializeCookie(name, "", { ...opts, maxAge: 0 }));
}

export type DbUser = typeof users.$inferSelect;

/**
 * The session cookie name, and therefore the prefix that is safe to use.
 *
 * Under HTTPS we adopt the `__Host-` prefix, which browsers accept only when
 * the cookie has no `Domain` attribute and is `Secure`. That rules out cookie
 * tossing: a sibling subdomain cannot set a competing cookie under this name,
 * which matters because `parseCookieHeader` honours the first occurrence of a
 * duplicated name.
 *
 * Over plain HTTP — the documented LAN default — `__Host-` cannot be used,
 * because browsers reject an unprefixed-secure cookie, and a `__Host-` cookie
 * without `Secure` is refused outright. Deploying that way would silently break
 * login for everyone. So the prefix follows the deployment, and flipping
 * `COOKIE_SECURE` deliberately invalidates existing sessions by renaming the
 * cookie.
 */
function sessionCookieName(): string {
  return cookieSecure() ? `__Host-${SESSION_COOKIE_BASE}` : SESSION_COOKIE_BASE;
}

function sessionDigest(token: string): string {
  const secret = requireSessionSecret(process.env.SESSION_SECRET);
  return sessionDigestWith(token, secret);
}

/** Profile fields visible to other users. Never includes the site role. */
export function publicUser(row: DbUser) {
  let h = 0;
  for (let i = 0; i < row.id.length; i++) {
    h = (h * 31 + row.id.charCodeAt(i)) >>> 0;
  }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    locale: (row.locale === "en" ? "en" : "es") as "en" | "es",
    color: `hsl(${h % 360}, 42%, 45%)`,
  };
}

/** The signed-in user's own view of their account, including the site role. */
export function selfUser(row: DbUser) {
  return {
    ...publicUser(row),
    role: (row.role === "admin" ? "admin" : "user") as "admin" | "user",
  };
}

export async function findUserByUsername(
  username: string,
): Promise<DbUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return rows[0] || null;
}

export async function findUserById(uid: string): Promise<DbUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  return rows[0] || null;
}

export async function createSession(
  event: H3Event,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const digest = sessionDigest(token);
  const expiresAt = Date.now() + THIRTY_DAYS_MS;
  await db.insert(appSessions).values({
    token: digest,
    userId,
    expiresAt,
  });
  writeCookie(event, sessionCookieName(), token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_MS / 1000,
  });
  return digest;
}

/** Ends every session for `userId` except the one whose digest is `keep`. */
export async function revokeOtherSessions(
  userId: string,
  keep: string,
): Promise<void> {
  await db
    .delete(appSessions)
    .where(and(eq(appSessions.userId, userId), ne(appSessions.token, keep)));
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(appSessions).where(lte(appSessions.expiresAt, Date.now()));
}

export async function destroySession(event: H3Event): Promise<void> {
  const names = cookieSecure()
    ? [sessionCookieName(), SESSION_COOKIE_BASE]
    : [SESSION_COOKIE_BASE];
  for (const name of names) {
    const token = readCookie(event, name);
    if (!token) continue;
    try {
      await db
        .delete(appSessions)
        .where(eq(appSessions.token, sessionDigest(token)));
    } catch (error) {
      console.warn("[pachas] could not delete session row", error);
    }
  }
  for (const name of names) removeCookie(event, name, { path: "/" });
}

export async function getSessionUser(event: H3Event): Promise<DbUser | null> {
  const names = cookieSecure()
    ? [sessionCookieName(), SESSION_COOKIE_BASE]
    : [SESSION_COOKIE_BASE];
  let token: string | undefined;
  for (const name of names) {
    token = readCookie(event, name);
    if (token) break;
  }
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(appSessions)
    .innerJoin(users, eq(users.id, appSessions.userId))
    .where(
      and(
        eq(appSessions.token, sessionDigest(token)),
        gt(appSessions.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  return rows[0]?.user || null;
}

export async function requireUser(event: H3Event): Promise<DbUser> {
  const u = await getSessionUser(event);
  if (!u) {
    throw createError({ statusCode: 401, message: "not_authenticated" });
  }
  return u;
}

export async function requireAdmin(event: H3Event): Promise<DbUser> {
  const u = await requireUser(event);
  if (u.role !== "admin") {
    throw createError({ statusCode: 403, message: "not_an_admin" });
  }
  return u;
}

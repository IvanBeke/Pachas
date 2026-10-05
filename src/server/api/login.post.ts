import bcrypt from "bcryptjs";
import { clientIp, hit, peek } from "../utils/rate-limit";
import { findUserByUsername, createSession, selfUser } from "../utils/auth";

/**
 * Per-account does the real work against credential stuffing and is tight: ten
 * wrong passwords for one name in five minutes.
 *
 * Per-IP is only a backstop against one source spraying many *different*
 * accounts, so it is set as a CPU ceiling rather than a household limit. It has
 * to be loose: everyone behind one NAT address shares this bucket, and a tight
 * value would lock out a real family the moment two people fat-fingered their
 * passwords. At 200 rejected hashes per five minutes it still bounds the worst
 * case to roughly ten seconds of hashing per window, and since hashing is
 * asynchronous the event loop is never blocked either way.
 *
 * Only *failed* attempts are recorded, so signing in successfully never consumes
 * the budget — see the note in `rate-limit.ts`.
 */
const PER_IP = { limit: 200, windowMs: 5 * 60_000 };
const PER_ACCOUNT = { limit: 10, windowMs: 5 * 60_000 };
/**
 * Global ceiling per account, across all sources. Much looser than the
 * per-source bucket so a third party can't lock a user out by spraying wrong
 * passwords from one address, but still bounds a distributed guessing attack.
 */
const PER_ACCOUNT_GLOBAL = { limit: 100, windowMs: 15 * 60_000 };

/**
 * A real bcrypt hash of a value nobody can supply, used to spend the same CPU
 * when the account does not exist. Without it, a missing username returns
 * measurably faster than a wrong password and the response time enumerates
 * valid accounts. Regenerated per process start so it is never a fixed
 * known-answer string.
 */
const DECOY_HASH = bcrypt.hashSync(
  `pachas-decoy-${Math.random()}-${Date.now()}`,
  10,
);

function tooMany(retryAfter: number) {
  return createError({
    statusCode: 429,
    message: "Too many attempts. Try again later.",
    data: { retryAfter },
  });
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}));
  const username = String(body?.username || "").trim();
  // bcrypt ignores bytes past 72; reject instead of silently truncating.
  const password = String(body?.password || "");
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw createError({
      statusCode: 401,
      message: "Incorrect username or password.",
    });
  }

  // Keyed on the submitted username, normalised the same way as the lookup, so
  // `Alice` and `alice` share a bucket.
  const ip = clientIp(event);
  const name = username.toLowerCase();
  const ipKey = `login:ip:${ip}`;
  const userKey = `login:user:${ip}:${name}`;
  const globalKey = `login:user:${name}`;

  // Checked before the hash, so a blocked client is rejected without making us
  // spend any CPU on it.
  const ipBlocked = peek(ipKey, PER_IP.limit, PER_IP.windowMs);
  if (!ipBlocked.ok) throw tooMany(ipBlocked.retryAfter);
  const userBlocked = peek(userKey, PER_ACCOUNT.limit, PER_ACCOUNT.windowMs);
  if (!userBlocked.ok) throw tooMany(userBlocked.retryAfter);
  const globalBlocked = peek(
    globalKey,
    PER_ACCOUNT_GLOBAL.limit,
    PER_ACCOUNT_GLOBAL.windowMs,
  );
  if (!globalBlocked.ok) throw tooMany(globalBlocked.retryAfter);

  const u = await findUserByUsername(username);

  // Always run a comparison, whichever branch we take. `compare` is the async
  // API, so this yields the event loop instead of blocking it for ~48ms.
  const ok = u
    ? await bcrypt.compare(password, u.passwordHash)
    : (await bcrypt.compare(password, DECOY_HASH), false);

  if (!u || !ok) {
    hit(ipKey, PER_IP.limit, PER_IP.windowMs);
    hit(userKey, PER_ACCOUNT.limit, PER_ACCOUNT.windowMs);
    hit(globalKey, PER_ACCOUNT_GLOBAL.limit, PER_ACCOUNT_GLOBAL.windowMs);
    // One message for both failure modes, so the response never says which.
    throw createError({
      statusCode: 401,
      message: "Incorrect username or password.",
    });
  }
  await createSession(event, u.id);
  return selfUser(u);
});

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { clientIp, hit } from "../utils/rate-limit";
import { allowRegistration } from "../utils/env";
import { passwordProblem } from "../utils/password";
import { runtimeDb as db } from "../utils/client";
import { users } from "../db/schema";
import {
  findUserById,
  createSession,
  selfUser,
} from "../utils/auth";

function validUsername(s: unknown) {
  return typeof s === "string" && /^[a-zA-Z0-9._-]{3,32}$/.test(s);
}

export default defineEventHandler(async (event) => {
  if (!allowRegistration()) {
    throw createError({
      statusCode: 403,
      message: "Registration is disabled on this server.",
    });
  }
  const check = hit(`register:ip:${clientIp(event)}`, 60, 60 * 60_000);
  if (!check.ok) {
    throw createError({
      statusCode: 429,
      message: "Too many accounts created from this address. Try again later.",
      data: { retryAfter: check.retryAfter },
    });
  }
  const body = await readBody(event).catch(() => ({}));
  const { username, password, name } = body || {};
  if (!validUsername(username)) {
    throw createError({
      statusCode: 400,
      message:
        "Username must be 3-32 characters: letters, numbers, dots, dashes, underscores.",
    });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) {
    throw createError({
      statusCode: 400,
      message:
        pwProblem === "too_long"
          ? "Password must be at most 72 bytes."
          : "Password must be at least 8 characters.",
    });
  }
  const displayName =
    (name || username).toString().trim().slice(0, 60) || username;
  const passwordHash = await bcrypt.hash(password, 10);
  const uid = randomUUID();
  // Site admins are only created with `pnpm make-admin <username>`; the first
  // account is not promoted automatically, so an exposed fresh install can't be
  // claimed by whoever registers first.
  const taken = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    if (existing.length) return true;
    await tx.insert(users).values({
      id: uid,
      username,
      name: displayName,
      passwordHash,
      role: "user",
      createdAt: Date.now(),
    });
    return false;
  }, { behavior: "immediate" });
  if (taken) {
    throw createError({
      statusCode: 409,
      message: "That username is already taken.",
    });
  }
  const u = await findUserById(uid);
  await createSession(event, uid);
  return selfUser(u!);
});

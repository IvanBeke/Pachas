import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { clientIp, hit } from "../utils/rate-limit";
import { db } from "../utils/client";
import { users } from "../db/schema";
import {
  findUserByUsername,
  findUserById,
  createSession,
  publicUser,
} from "../utils/auth";

function validUsername(s: unknown) {
  return typeof s === "string" && /^[a-zA-Z0-9._-]{3,32}$/.test(s);
}

function allowRegistration(): boolean {
  const v =
    useRuntimeConfig().allowRegistration ??
    process.env.ALLOW_REGISTRATION ??
    "true";
  return String(v).toLowerCase() !== "false";
}

export default defineEventHandler(async (event) => {
  if (!allowRegistration()) {
    throw createError({
      statusCode: 403,
      message: "Registration is disabled on this server.",
    });
  }
  // Registration is open by default and each attempt costs a password hash, so
  // it is capped per source address. Deliberately generous, because a whole
  // household shares one LAN address and a runaway sign-up should not lock out
  // the real users. Note this window is an hour of *process* state, so it resets
  // on `docker compose restart pachas`; the API contract suite registers a few
  // throwaway users per run and is the main thing that will ever reach it.
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
  if (typeof password !== "string" || password.length < 8) {
    throw createError({
      statusCode: 400,
      message: "Password must be at least 8 characters.",
    });
  }
  if (await findUserByUsername(username)) {
    throw createError({
      statusCode: 409,
      message: "That username is already taken.",
    });
  }
  const displayName =
    (name || username).toString().trim().slice(0, 60) || username;
  // Async, so a flood of signups cannot pin the event loop the way the
  // synchronous call did.
  const passwordHash = await bcrypt.hash(password, 10);
  const uid = randomUUID();
  await db.insert(users).values({
    id: uid,
    username,
    name: displayName,
    passwordHash,
    createdAt: Date.now(),
  });
  const u = await findUserById(uid);
  await createSession(event, uid);
  return publicUser(u!);
});

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { clientIp, hit } from "../utils/rate-limit";
import { runtimeDb as db } from "../utils/client";
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
  const passwordHash = await bcrypt.hash(password, 10);
  const uid = randomUUID();
  await db.transaction(async (tx) => {
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(users);
    await tx.insert(users).values({
      id: uid,
      username,
      name: displayName,
      passwordHash,
      role: (result[0]?.count ?? 0) === 0 ? "admin" : "user",
      createdAt: Date.now(),
    });
  }, { behavior: "immediate" });
  const u = await findUserById(uid);
  await createSession(event, uid);
  return publicUser(u!);
});

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { runtimeDb as db } from "../utils/client";
import {
  createSession,
  destroySession,
  findUserById,
  requireUser,
  revokeOtherSessions,
  selfUser,
} from "../utils/auth";
import { passwordProblem } from "../utils/password";

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const body = await readBody(event).catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "profile_nothing_to_update" });
  }

  if ("username" in body) {
    throw createError({ statusCode: 400, message: "profile_username_immutable" });
  }

  const updates: { name?: string; locale?: string; passwordHash?: string } = {};

  if ("name" in body) {
    if (typeof body.name !== "string") {
      throw createError({ statusCode: 400, message: "profile_name_invalid" });
    }
    const name = body.name.trim();
    if (!name || name.length > 60) {
      throw createError({ statusCode: 400, message: "profile_name_invalid" });
    }
    updates.name = name;
  }

  if ("locale" in body) {
    if (body.locale !== "es" && body.locale !== "en") {
      throw createError({ statusCode: 400, message: "profile_locale_invalid" });
    }
    updates.locale = body.locale;
  }

  const changingPassword =
    body.currentPassword !== undefined || body.newPassword !== undefined;
  if (changingPassword) {
    if (
      typeof body.currentPassword !== "string" ||
      typeof body.newPassword !== "string"
    ) {
      throw createError({
        statusCode: 400,
        message: "profile_password_fields_required",
      });
    }
    const problem = passwordProblem(body.newPassword);
    if (problem === "too_short") {
      throw createError({ statusCode: 400, message: "profile_password_too_short" });
    }
    if (problem === "too_long") {
      throw createError({ statusCode: 400, message: "profile_password_too_long" });
    }
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw createError({
        statusCode: 400,
        message: "profile_current_password_incorrect",
      });
    }
    updates.passwordHash = await bcrypt.hash(body.newPassword, 10);
  }

  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, message: "profile_nothing_to_update" });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));
  if (updates.passwordHash) {
    // A password change signs out every other device and rotates this one's
    // token, so a stolen session cookie stops working.
    await destroySession(event);
    const keep = await createSession(event, user.id);
    await revokeOtherSessions(user.id, keep);
  }
  const updated = await findUserById(user.id);
  return selfUser(updated!);
});

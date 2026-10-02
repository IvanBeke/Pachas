import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { runtimeDb as db } from "../utils/client";
import { findUserById, publicUser, requireUser } from "../utils/auth";

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
    if (body.newPassword.length < 8) {
      throw createError({ statusCode: 400, message: "profile_password_too_short" });
    }
    if (Buffer.byteLength(body.newPassword, "utf8") > 72) {
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
  const updated = await findUserById(user.id);
  return publicUser(updated!);
});

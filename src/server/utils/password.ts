/** bcrypt only reads the first 72 bytes, so longer passwords are rejected. */
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;

export function passwordProblem(
  password: unknown,
): "invalid" | "too_short" | "too_long" | null {
  if (typeof password !== "string") return "invalid";
  if (password.length < PASSWORD_MIN_CHARS) return "too_short";
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return "too_long";
  return null;
}

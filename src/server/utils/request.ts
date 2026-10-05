import type { H3Event } from "h3";

/** A required route parameter; a missing one is a 404, never `"undefined"`. */
export function requireParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name);
  if (!value) throw createError({ statusCode: 404, message: "not_found" });
  return value;
}

/**
 * Reads a JSON object body. A missing or malformed body becomes `{}`, and a
 * non-object (array, string, number) is rejected, so handlers can destructure
 * safely.
 */
export async function readJsonObject(
  event: H3Event,
): Promise<Record<string, unknown>> {
  const body = await readBody(event).catch(() => undefined);
  if (body === undefined || body === null || body === "") return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "invalid_body" });
  }
  return body as Record<string, unknown>;
}

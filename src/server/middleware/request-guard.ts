/**
 * Baseline checks for every state-changing API request.
 *
 * - Body size: h3 does not cap JSON bodies, so an unauthenticated request could
 *   otherwise make the server buffer an arbitrarily large payload.
 * - Cross-site requests: the session cookie is `SameSite=Lax`, which still lets
 *   same-site pages (e.g. another service on a different port of the same host)
 *   send it. Writes must come from this origin and carry a JSON body, which a
 *   plain HTML form cannot produce.
 */

const MAX_JSON_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 + 64 * 1024;
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isUpload(path: string): boolean {
  return /^\/api\/groups\/[^/]+\/import(\/analyze)?\/?$/.test(path);
}

export default defineEventHandler((event) => {
  const path = event.path.split("?")[0] ?? "";
  if (!path.startsWith("/api/")) return;
  const method = event.method.toUpperCase();
  if (!UNSAFE.has(method)) return;

  const headers = event.node.req.headers;

  const site = headers["sec-fetch-site"];
  const origin = headers.origin;
  if (site && site !== "same-origin" && site !== "none") {
    throw createError({ statusCode: 403, message: "cross_site_request" });
  }
  if (!site && origin) {
    const host = headers["x-forwarded-host"] ?? headers.host;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== host) {
      throw createError({ statusCode: 403, message: "cross_site_request" });
    }
  }

  const upload = isUpload(path);
  const limit = upload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
  const length = Number(headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > limit) {
    throw createError({ statusCode: 413, message: "payload_too_large" });
  }
  // Without a declared length (chunked), count bytes as they arrive.
  if (!headers["content-length"] && headers["transfer-encoding"]) {
    let seen = 0;
    event.node.req.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > limit) event.node.req.destroy();
    });
  }

  const type = String(headers["content-type"] ?? "").toLowerCase();
  const hasBody = length > 0 || Boolean(headers["transfer-encoding"]);
  if (hasBody) {
    const ok = upload
      ? type.startsWith("multipart/form-data")
      : type.startsWith("application/json");
    if (!ok) {
      throw createError({ statusCode: 415, message: "unsupported_media_type" });
    }
  }
});

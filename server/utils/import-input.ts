import { createError, getRequestHeader, type H3Event } from "h3";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Parses the multipart body once and hands back the parts.
 *
 * `readMultipartFormData` buffers the whole request into memory before
 * returning, so a size check afterwards is not a real bound — the memory has
 * already been spent. We therefore reject on `Content-Length` *before* reading,
 * and cap the parsed size as a backstop for chunked requests that omit the
 * header.
 *
 * The import route needs the file plus two JSON fields. Calling this once and
 * reusing the parts matters: h3 does cache the raw body, so repeated calls
 * worked, but each one re-parses the entire multipart payload, tripling peak
 * memory and CPU on the largest allowed upload.
 */
async function partsOnce(event: H3Event) {
  const declared = Number(getRequestHeader(event, "content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw createError({ statusCode: 413, message: "file_too_large" });
  }

  const parts = await readMultipartFormData(event);
  if (!parts) {
    throw createError({ statusCode: 400, message: "no_file" });
  }
  // Backstop for chunked uploads, which send no Content-Length.
  const total = parts.reduce((n, p) => n + (p.data?.length ?? 0), 0);
  if (total > MAX_BYTES) {
    throw createError({ statusCode: 413, message: "file_too_large" });
  }
  return parts;
}

type Part = { name?: string; filename?: string; type?: string; data?: Buffer };

/**
 * Pulls the uploaded CSV and any accompanying JSON fields out of one multipart
 * request, so the body is parsed exactly once.
 */
export async function readImportRequest(event: H3Event): Promise<{
  text: string;
  fields: Record<string, unknown>;
}> {
  const parts = (await partsOnce(event)) as Part[];

  const file =
    parts.find((p) => p.name === "file" || (p.filename && p.type?.includes("csv"))) ??
    parts.find((p) => p.filename);
  if (!file || !file.data?.length) {
    throw createError({ statusCode: 400, message: "no_file" });
  }
  const text = file.data.toString("utf8");

  const fields: Record<string, unknown> = {};
  for (const p of parts) {
    if (!p.name || p.name === "file" || !p.data?.length) continue;
    try {
      fields[p.name] = JSON.parse(p.data.toString("utf8"));
    } catch {
      throw createError({ statusCode: 400, message: `bad_${p.name}` });
    }
  }
  return { text, fields };
}

/**
 * Reads a request body with a hard byte budget, then JSON-parses it.
 * Rejects oversized payloads even when `Content-Length` is missing or wrong
 * (chunked transfer), so callers never call unbounded `request.json()`.
 */
export type ReadRequestJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "too_large" | "invalid_json" | "empty" };

export async function readRequestJsonWithByteLimit<T>(
  request: Request,
  maxBytes: number,
): Promise<ReadRequestJsonResult<T>> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, error: "too_large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, error: "empty" };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return { ok: false, error: "empty" };
  }

  if (total === 0) {
    return { ok: false, error: "empty" };
  }

  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

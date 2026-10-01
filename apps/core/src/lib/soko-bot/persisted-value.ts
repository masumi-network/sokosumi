import type { Prisma } from "@sokosumi/database";
import {
  containsSokoBotSensitiveMaterial,
  type RuntimeJsonValue,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";
import { jsonInput } from "@/helpers/prisma-json";
import { urlsIn } from "@/lib/soko-bot/citations";

const PERSISTED_VALUE_MAX_DEPTH = 8;
const TOOL_RESULT_MAX_BYTES = 16_384;
const PERSISTED_COLLECTION_MAX_ITEMS = 100;
/** Room kept for the addresses of a result too large to store whole. */
const TRUNCATED_SOURCES_MAX_BYTES = 8_192;

/**
 * Redacts secrets and bounds size before anything the model produced or
 * received is written to a durable row. Every Soko Bot persistence path shares
 * this: tool calls, projected events, and the runtime event log all store
 * values the model chose, and a tool input can carry an API key or password.
 */
export function sanitizePersistedValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): RuntimeJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactSokoBotSensitiveText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (depth >= PERSISTED_VALUE_MAX_DEPTH || seen.has(value)) {
    return "[Truncated]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items: RuntimeJsonValue[] = value
      .slice(0, PERSISTED_COLLECTION_MAX_ITEMS)
      .map((item) => sanitizePersistedValue(item, depth + 1, seen));
    if (value.length > items.length) items.push("[Truncated]");
    return items;
  }

  const result: Record<string, RuntimeJsonValue> = {};
  const entries = Object.entries(value).slice(
    0,
    PERSISTED_COLLECTION_MAX_ITEMS,
  );
  for (const [key, entry] of entries) {
    const safeKey = redactSokoBotSensitiveText(key);
    result[safeKey] = containsSokoBotSensitiveMaterial(`${key}: value`)
      ? redactSokoBotSensitiveText(`${key}: value`)
      : sanitizePersistedValue(entry, depth + 1, seen);
  }
  if (Object.keys(value).length > entries.length) result._truncated = true;
  return result;
}

/** The longest prefix of `value` within `maxBytes` of UTF-8. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}

/**
 * The addresses in a result, as far as they fit. A truncated preview cuts
 * them off, and the link check reads stored results: without these a link the
 * bot's own tool returned (a long board read, a Task with many comments) was
 * dropped from its answer as unconfirmed.
 */
function truncatedSources(value: unknown): string[] {
  const sources: string[] = [];
  let bytes = 0;
  for (const url of urlsIn(value)) {
    bytes += Buffer.byteLength(url, "utf8") + 3;
    if (bytes > TRUNCATED_SOURCES_MAX_BYTES) break;
    sources.push(url);
  }
  return sources;
}

/**
 * A tool input or result as stored on its row: sanitized, and at most 16 KB,
 * plus the addresses of one that had to be cut.
 */
export function persistedToolResult(value: unknown): Prisma.InputJsonValue {
  const sanitized = sanitizePersistedValue(value);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, "utf8") <= TOOL_RESULT_MAX_BYTES) {
    return jsonInput(sanitized);
  }
  const sources = truncatedSources(sanitized);
  const emptyWrapper = JSON.stringify({ truncated: true, preview: "" });
  let preview = truncateUtf8(
    serialized,
    TOOL_RESULT_MAX_BYTES - Buffer.byteLength(emptyWrapper, "utf8"),
  );
  let wrapper = { truncated: true, preview };
  while (
    Buffer.byteLength(JSON.stringify(wrapper), "utf8") > TOOL_RESULT_MAX_BYTES
  ) {
    const excess =
      Buffer.byteLength(JSON.stringify(wrapper), "utf8") -
      TOOL_RESULT_MAX_BYTES;
    preview = truncateUtf8(
      preview,
      Math.max(0, Buffer.byteLength(preview, "utf8") - excess - 1),
    );
    wrapper = { truncated: true, preview };
  }
  return jsonInput(sources.length ? { ...wrapper, sources } : wrapper);
}

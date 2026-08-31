import {
  containsSokoBotSensitiveMaterial,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";

const PERSISTED_VALUE_MAX_DEPTH = 8;
const PERSISTED_COLLECTION_MAX_ITEMS = 100;

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
): unknown {
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
    const items = value
      .slice(0, PERSISTED_COLLECTION_MAX_ITEMS)
      .map((item) => sanitizePersistedValue(item, depth + 1, seen));
    if (value.length > items.length) items.push("[Truncated]");
    return items;
  }

  const result: Record<string, unknown> = {};
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

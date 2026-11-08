/**
 * Replaces lone UTF-16 surrogates in every string of a JSON-like value.
 *
 * Text cut at a length limit can end in half an emoji. JSON.stringify writes
 * it as a lone `\ud83d` escape, which the Gateway refuses on zero-retention
 * routes ("Invalid body: failed to parse JSON value"), and the whole turn
 * fails. Only plain objects and arrays are rebuilt; anything else (bytes,
 * URLs) is kept as it is.
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === "string") return value.toWellFormed() as T;
  if (Array.isArray(value)) return value.map(wellFormed) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, wellFormed(entry)]),
    ) as T;
  }
  return value;
}

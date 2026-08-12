/**
 * Canonical JSON for comparing two attacker-authored 402 values for equality
 * regardless of key order.
 *
 * Split out of `payment-required.schema.ts` because it answers a third
 * question — not what a payload may contain (the schema) and not how much of
 * it may pass (the limits), but whether two values are THE SAME value.
 *
 * Written locally rather than delegated to `json-canonicalize` because that
 * serializer short-circuits on `object.toJSON != null` and falls back to plain
 * `JSON.stringify`, which emits INSERTION order, unsorted. `toJSON` need not
 * be callable — the string `"x"` triggers it — and it is a spec-legal unknown
 * key on an `accepts` entry: it collides with no validated field, so
 * `dropShadowKeys` passes it and the loose entry schema keeps it. A resource
 * server could therefore choose which of its own entries canonicalize
 * inconsistently, and `narrowToChosenRequirement` would refuse the entry the
 * payload really offered on any path that round-trips it (a replay, a queued
 * job). It fails closed, so the outcome is an unpayable agent rather than a
 * diverted payment — but the trigger is attacker-chosen, so the dependency
 * goes.
 *
 * `json-canonicalize` stays a dependency: `src/hash/hash.ts` hashes values
 * whose canonical form must keep matching what the payment node computes.
 * This module is only for local value-equality, where the ONLY property that
 * matters is that two equal values produce one string and two different values
 * never do.
 */

import { X402_MAX_JSON_DEPTH } from "./payment-required.limits.js";

/** Signals a value outside the JSON data model; never escapes this module. */
class NotCanonicalizableError extends Error {}

/**
 * RFC 8785-style canonical JSON: object keys sorted by UTF-16 code unit at
 * every depth, arrays in order, scalars exactly as `JSON.stringify` writes
 * them. `undefined` properties are treated as absent (the `filterUndefined`
 * behaviour the previous implementation was configured with).
 *
 * Returns `undefined` — never throws — when the value is outside the JSON data
 * model (a cycle, a function, a `BigInt`, a symbol, `NaN`/`Infinity`) or
 * nested past `X402_MAX_JSON_DEPTH`. The caller treats that as "not equal",
 * which is the fail-closed direction for a fund-diversion fence.
 *
 * Keys and string values BOTH go through `JSON.stringify`, so neither can
 * forge the other's delimiters: a value containing `","` cannot appear as a
 * second key, and a key containing `":"` cannot appear as a value. That is
 * what makes an equal canonical string mean equal values, so it must survive
 * any future edit here.
 */
export function canonicalJsonKey(value: unknown): string | undefined {
  try {
    return serialize(value, 0, new Set());
  } catch (error) {
    if (error instanceof NotCanonicalizableError) {
      return undefined;
    }
    throw error;
  }
}

function serialize(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // `JSON.stringify` writes NaN and ±Infinity as `null`, which would make
      // them compare equal to a real `null`. Refuse instead.
      if (!Number.isFinite(value)) {
        throw new NotCanonicalizableError("non-finite number");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      return serializeObject(value as object, depth, ancestors);
    default:
      // undefined, function, bigint, symbol — outside the JSON data model.
      throw new NotCanonicalizableError(`unsupported type ${typeof value}`);
  }
}

function serializeObject(
  value: object,
  depth: number,
  ancestors: Set<object>,
): string {
  if (depth >= X402_MAX_JSON_DEPTH) {
    throw new NotCanonicalizableError("nested too deep");
  }
  if (ancestors.has(value)) {
    throw new NotCanonicalizableError("circular reference");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const elements = value.map((element) =>
        // `JSON.stringify` writes a hole or an `undefined` element as `null`;
        // matching it keeps array length meaningful.
        element === undefined
          ? "null"
          : serialize(element, depth + 1, ancestors),
      );
      return `[${elements.join(",")}]`;
    }
    // Own enumerable string keys only, sorted by UTF-16 code unit — what
    // `Array.prototype.sort` does by default, and what RFC 8785 specifies.
    // `toJSON` is just another key here; it is never consulted.
    const properties = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serialize(
            (value as Record<string, unknown>)[key],
            depth + 1,
            ancestors,
          )}`,
      );
    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

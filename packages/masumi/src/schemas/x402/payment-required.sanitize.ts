/**
 * Removes the object keys that turn a relayed 402 into a prototype-pollution
 * payload against whoever parses it next.
 *
 * Soko does not merge a 402 into anything, so nothing here protects Soko. It
 * protects the PAYMENT NODE: `POST /x402/pay` receives the normalized
 * `paymentRequired` verbatim, masumi-payment-service is Node/TS, and any
 * deep-merge or recursive `Object.assign` over an `accepts` entry, its `extra`
 * or the payload's `extensions` walks straight into `__proto__`. That is the
 * same fail-open-on-the-node's-parser reasoning that justifies
 * `dropShadowKeys` — a node the caller does not deploy decides what a
 * spec-legal unknown key means, so Soko must not ship one that can only ever
 * be harmful.
 *
 * Before this existed, a TOP-LEVEL `__proto__` on an entry did disappear —
 * but only incidentally, because zod assigns unknown keys with `obj[k] = v`,
 * which hits the prototype setter rather than creating an own property. No
 * check did it, `constructor` survived even there, and one level down
 * everything survived. An undocumented dependency on a zod implementation
 * detail is not a defence, especially since `dropShadowKeys` rebuilds with
 * `Object.fromEntries`, which DOES materialize an own `__proto__` key and
 * would have re-created exactly what zod incidentally dropped.
 *
 * Applied to the whole candidate BEFORE the wild schema parses it, so there is
 * one call site instead of three and no ordering rule to get wrong later.
 */

import { err, ok, type Result } from "neverthrow";

import { X402_MAX_JSON_DEPTH } from "./payment-required.limits.js";

/**
 * The keys a recursive merge can weaponize. `__proto__` reaches the prototype
 * setter, `constructor` reaches `Object.prototype` via `constructor.prototype`,
 * and `prototype` is the same reach one hop further along. Nothing in the x402
 * spec, the node's `/x402/pay` schema or any live Bazaar listing uses them, so
 * dropping them rejects nothing legitimate.
 */
const PROTOTYPE_POLLUTING_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** Whether a key must never be forwarded, whatever else is true of it. */
export function isPrototypePollutingKey(key: string): boolean {
  return PROTOTYPE_POLLUTING_KEYS.has(key);
}

/** Signals an unwalkable value; never escapes this module. */
class UnwalkableValueError extends Error {}

/**
 * Returns a copy of `value` with every `__proto__` / `constructor` /
 * `prototype` key removed at every depth, in objects and inside arrays. The
 * input is not mutated, and every other value survives byte-identically.
 *
 * Objects are rebuilt as plain objects: the contract is JSON data (either
 * `JSON.parse` output or a JSON-shaped body), so an exotic prototype is
 * already outside it, and flattening one produces a value the schema then
 * rejects loudly rather than a value that quietly keeps its own behaviour.
 *
 * Fails closed with an error — never a throw, for ANY input — for a value
 * nested past `X402_MAX_JSON_DEPTH`, containing a cycle, or whose property
 * read throws. All three are impossible from `JSON.parse`, but this runs
 * before any bound the schema applies (and before zod, whose `safeParse`
 * throws on the third), so the walk must carry its own.
 */
export function stripPrototypePollutingKeys(
  value: unknown,
): Result<unknown, string> {
  try {
    return ok(walk(value, 0, new Set()));
  } catch (error) {
    if (error instanceof UnwalkableValueError) {
      return err(error.message);
    }
    // EVERY other throw fails closed too, exactly as `canonicalJsonKey` does
    // and for the same reason. `walk` reads `source[key]`, so an enumerable
    // getter that throws escapes as a plain `TypeError` out of a function
    // whose declared contract is `Result<unknown, string>` — an unhandled 500
    // on the pay path where the contract promises a refusal. This walker runs
    // FIRST, before zod (`safeParse` throws on the same input), so it is the
    // one place that must not let a property read escape.
    //
    // The message is FIXED, not `error.message`: the thrown value is
    // attacker-authored and unbounded, and every other echo in this module is
    // capped. The cost is that a genuine defect here also reads as a refused
    // 402 — which still fails closed, the direction this module must err in.
    return err("x402 payment-required payload could not be read");
  }
}

function walk(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (depth >= X402_MAX_JSON_DEPTH) {
    throw new UnwalkableValueError(
      `x402 payment-required payload is nested deeper than ${X402_MAX_JSON_DEPTH} levels`,
    );
  }
  if (ancestors.has(value)) {
    throw new UnwalkableValueError(
      "x402 payment-required payload contains a circular reference",
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((element) => walk(element, depth + 1, ancestors));
    }
    const source = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (isPrototypePollutingKey(key)) {
        continue;
      }
      // Safe as a plain assignment precisely because the dangerous keys were
      // skipped above: no remaining key can reach a setter on the prototype.
      sanitized[key] = walk(source[key], depth + 1, ancestors);
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}

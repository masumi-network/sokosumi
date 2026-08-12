import { describe, expect, it } from "vitest";

import {
  isPrototypePollutingKey,
  stripPrototypePollutingKeys,
} from "../payment-required.sanitize.js";

/** Own `__proto__` / `constructor` / `prototype` keys, as JSON.parse makes them. */
function withProtoKey(json: string): unknown {
  return JSON.parse(json);
}

describe("isPrototypePollutingKey", () => {
  it("names exactly the three keys a recursive merge can weaponize", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(isPrototypePollutingKey(key)).toBe(true);
    }
    for (const key of [
      "proto",
      "__proto__ ",
      "Constructor",
      "payTo",
      "extra",
    ]) {
      expect(isPrototypePollutingKey(key)).toBe(false);
    }
  });
});

describe("stripPrototypePollutingKeys", () => {
  it("drops the keys at every depth, in objects and inside arrays", () => {
    const value = withProtoKey(
      '{"a":{"__proto__":{"polluted":1},"keep":1},"b":[{"constructor":2,"keep":2}],"prototype":3}',
    );

    const result = stripPrototypePollutingKeys(value);

    expect(result.isOk()).toBe(true);
    expect(JSON.stringify(result._unsafeUnwrap())).toBe(
      '{"a":{"keep":1},"b":[{"keep":2}]}',
    );
  });

  it("creates no own __proto__ key of its own while rebuilding", () => {
    // `Object.fromEntries` DOES materialize an own `__proto__` data property,
    // so the rebuild must not reintroduce what it just removed.
    const result = stripPrototypePollutingKeys(
      withProtoKey('{"__proto__":{"polluted":1},"keep":1}'),
    )._unsafeUnwrap() as Record<string, unknown>;

    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(JSON.stringify(result)).toBe('{"keep":1}');
  });

  it("does not pollute Object.prototype while walking a hostile payload", () => {
    stripPrototypePollutingKeys(
      withProtoKey('{"nested":{"__proto__":{"pollutionCanary":true}}}'),
    );

    expect(({} as Record<string, unknown>).pollutionCanary).toBeUndefined();
  });

  it("leaves every other value byte-identical", () => {
    const value = {
      scheme: "exact",
      amount: "1000",
      maxTimeoutSeconds: 3600,
      nested: { list: [1, "two", null, true], empty: {} },
    };

    const result = stripPrototypePollutingKeys(value)._unsafeUnwrap();

    expect(result).toEqual(value);
    expect(JSON.stringify(result)).toBe(JSON.stringify(value));
  });

  it("passes non-object values through untouched", () => {
    for (const value of [null, undefined, 42, "str", true]) {
      expect(stripPrototypePollutingKeys(value)._unsafeUnwrap()).toBe(value);
    }
  });

  it("does not mutate the value it sanitizes", () => {
    const value = withProtoKey('{"a":{"__proto__":{"polluted":1},"keep":1}}');

    stripPrototypePollutingKeys(value);

    expect(JSON.stringify(value)).toBe(
      '{"a":{"__proto__":{"polluted":1},"keep":1}}',
    );
  });

  it("returns an error, never a throw, past the depth cap", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 200; index += 1) {
      deep = { deep };
    }

    const call = () => stripPrototypePollutingKeys(deep);

    expect(call).not.toThrow();
    expect(call().isErr()).toBe(true);
    expect(call()._unsafeUnwrapErr()).toMatch(/nested/);
  });

  it("returns an error, never a throw, for a cyclic value", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const call = () => stripPrototypePollutingKeys(cyclic);

    expect(call).not.toThrow();
    expect(call().isErr()).toBe(true);
    // The depth guard does NOT subsume the cycle guard: `ancestors` holds the
    // objects on the CURRENT path, so a self-reference trips at depth 1, long
    // before the 64-level bound. Pinned by message because both guards fail
    // closed, which makes removing either one invisible to an isErr assertion.
    expect(call()._unsafeUnwrapErr()).toMatch(/circular reference/);
  });

  it("reports a cycle longer than the depth bound as a depth failure", () => {
    // The other side of the same relationship: a loop longer than
    // X402_MAX_JSON_DEPTH is caught by the depth guard, because the walk runs
    // out of depth before it revisits the first object.
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 100; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    cursor.next = root;

    expect(stripPrototypePollutingKeys(root)._unsafeUnwrapErr()).toMatch(
      /nested deeper than/,
    );
  });

  it("returns an error, never a throw, when reading a property throws", () => {
    // `walk` reads `source[key]`, so an enumerable getter that throws escaped
    // as a plain TypeError out of a function whose declared contract is
    // `Result<unknown, string>` — an unhandled 500 exactly where the contract
    // promises a fail-closed error. Round 4 made `canonicalJsonKey` swallow
    // every throw for this reason and left this sibling walker's narrow catch
    // in place, even though this one runs FIRST and is the choke point that
    // rebuilds the payload into plain data before zod sees it.
    //
    // Same reachability as the canonical.ts twin: `JSON.parse` output cannot
    // carry a getter, so neither live transport triggers it, but the exported
    // normalizer takes any caller's hand-built value.
    const hostile: Record<string, unknown> = { keep: 1 };
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new TypeError("property read exploded");
      },
    });

    const call = () => stripPrototypePollutingKeys({ nested: hostile });

    expect(call).not.toThrow();
    expect(call().isErr()).toBe(true);
    // A FIXED message: the thrown error's own message is attacker-authored
    // and unbounded, and every other echo in this module is capped.
    expect(call()._unsafeUnwrapErr()).not.toContain("property read exploded");
  });
});

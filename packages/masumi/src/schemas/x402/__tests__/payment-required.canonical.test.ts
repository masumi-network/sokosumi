import { describe, expect, it } from "vitest";

import { canonicalJsonKey } from "../payment-required.canonical.js";

describe("canonicalJsonKey", () => {
  it("sorts object keys at every depth, so key order cannot change the key", () => {
    expect(canonicalJsonKey({ b: 1, a: 2 })).toBe(
      canonicalJsonKey({ a: 2, b: 1 }),
    );
    expect(canonicalJsonKey({ outer: { z: 1, a: 2 } })).toBe(
      canonicalJsonKey({ outer: { a: 2, z: 1 } }),
    );
    expect(canonicalJsonKey({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("ignores a toJSON key instead of handing the value its own serializer", () => {
    // `json-canonicalize` short-circuits on `object.toJSON != null` and falls
    // back to plain `JSON.stringify`, which emits insertion order. `toJSON`
    // need not be callable — the string "x" triggers it — and it is a
    // spec-legal unknown key on an `accepts` entry, so an attacker-authored
    // 402 could pick which entries canonicalize inconsistently.
    expect(canonicalJsonKey({ toJSON: "x", a: 1 })).toBe(
      canonicalJsonKey({ a: 1, toJSON: "x" }),
    );
    expect(canonicalJsonKey({ toJSON: "x", a: 1 })).toBe(
      '{"a":1,"toJSON":"x"}',
    );
    expect(canonicalJsonKey({ nested: { toJSON: "x", a: 1 } })).toBe(
      canonicalJsonKey({ nested: { a: 1, toJSON: "x" } }),
    );
  });

  it("never lets a key or a value cross the other's boundary", () => {
    // Both keys and string values go through `JSON.stringify`, so a value
    // containing `","` or `":"` cannot forge a second key, and vice versa.
    // Two objects that differ only in where the quoting falls must differ.
    expect(canonicalJsonKey({ a: '1","b":"2' })).not.toBe(
      canonicalJsonKey({ a: "1", b: "2" }),
    );
    expect(canonicalJsonKey({ 'a":"1': "x" })).not.toBe(
      canonicalJsonKey({ a: "1", x: "" }),
    );
    expect(canonicalJsonKey({ a: '"' })).toBe('{"a":"\\""}');
    // Guards the KEY side specifically. Both pairs above differ even with the
    // key emitted raw (`"${key}":`), because the quoting still lands
    // differently — so they do not hold the escaping in place. These two do:
    // an unescaped key spells `{"a":1,"b":2}` for BOTH objects, so the fence
    // would call two different values the same value.
    expect(canonicalJsonKey({ 'a":1,"b': 2 })).not.toBe(
      canonicalJsonKey({ a: 1, b: 2 }),
    );
    expect(canonicalJsonKey({ 'a":1,"b': 2 })).toBe('{"a\\":1,\\"b":2}');
  });

  it("preserves array order and distinguishes an array from an object", () => {
    expect(canonicalJsonKey([1, 2])).toBe("[1,2]");
    expect(canonicalJsonKey([1, 2])).not.toBe(canonicalJsonKey([2, 1]));
    expect(canonicalJsonKey({ 0: 1, 1: 2 })).not.toBe(canonicalJsonKey([1, 2]));
  });

  it("writes an array hole as null, exactly like JSON.stringify", () => {
    // `Array.prototype.map` SKIPS holes, so a hole never reaches the
    // element serializer. Emitting nothing for it produced `[,1]` — not
    // valid JSON, and a canonical form no `JSON.parse` output can equal.
    const sparse = [, 1];
    expect(canonicalJsonKey(sparse)).toBe("[null,1]");
    expect(canonicalJsonKey(sparse)).toBe(JSON.stringify(sparse));
    expect(canonicalJsonKey(sparse)).toBe(canonicalJsonKey([undefined, 1]));
  });

  it("treats an undefined property as absent, matching filterUndefined", () => {
    expect(canonicalJsonKey({ a: 1, b: undefined })).toBe(
      canonicalJsonKey({ a: 1 }),
    );
  });

  it("serializes the JSON scalars exactly as JSON.stringify does", () => {
    expect(canonicalJsonKey(null)).toBe("null");
    expect(canonicalJsonKey(true)).toBe("true");
    expect(canonicalJsonKey(1.5)).toBe("1.5");
    expect(canonicalJsonKey("a")).toBe('"a"');
  });

  it("returns undefined rather than throwing for anything outside JSON", () => {
    // The caller treats `undefined` as "not equal" — fail closed. Nothing here
    // may escape as a throw: the only caller is a fund-diversion fence.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      cyclic,
      { fn: () => 1 },
      { big: 1n },
      { sym: Symbol("s") },
      { nan: Number.NaN },
      { inf: Number.POSITIVE_INFINITY },
      undefined,
    ]) {
      expect(() => canonicalJsonKey(value)).not.toThrow();
      expect(canonicalJsonKey(value)).toBeUndefined();
    }
  });

  it("returns undefined rather than throwing when a property read itself throws", () => {
    // "Never throws" has to mean never, not "never for the values we expect".
    // An enumerable getter that throws is not reachable from `JSON.parse`
    // output, but the contract is absolute because the only caller is a
    // fund-diversion fence: a throw there escapes as a 500 on the pay path
    // instead of the fail-closed "not equal" the caller is written for.
    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, "boom", {
      enumerable: true,
      get() {
        throw new Error("property read blew up");
      },
    });

    expect(() => canonicalJsonKey(throwingGetter)).not.toThrow();
    expect(canonicalJsonKey(throwingGetter)).toBeUndefined();
    // Nested behind a plain object, so the throw crosses a recursion level.
    expect(() => canonicalJsonKey({ a: throwingGetter })).not.toThrow();
    expect(canonicalJsonKey({ a: throwingGetter })).toBeUndefined();
  });

  it("returns undefined for a value nested deeper than the depth cap", () => {
    let deep: unknown = 1;
    for (let index = 0; index < 200; index += 1) {
      deep = { deep };
    }
    expect(() => canonicalJsonKey(deep)).not.toThrow();
    expect(canonicalJsonKey(deep)).toBeUndefined();
  });
});

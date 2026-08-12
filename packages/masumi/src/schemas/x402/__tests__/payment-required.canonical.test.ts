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
  });

  it("preserves array order and distinguishes an array from an object", () => {
    expect(canonicalJsonKey([1, 2])).toBe("[1,2]");
    expect(canonicalJsonKey([1, 2])).not.toBe(canonicalJsonKey([2, 1]));
    expect(canonicalJsonKey({ 0: 1, 1: 2 })).not.toBe(canonicalJsonKey([1, 2]));
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

  it("returns undefined for a value nested deeper than the depth cap", () => {
    let deep: unknown = 1;
    for (let index = 0; index < 200; index += 1) {
      deep = { deep };
    }
    expect(() => canonicalJsonKey(deep)).not.toThrow();
    expect(canonicalJsonKey(deep)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  boundedMapCheck,
  truncateEcho,
  X402_MAX_ECHOED_VALUE_LENGTH,
  X402_MAX_MAP_ENTRIES,
  X402_MAX_MAP_KEY_LENGTH,
  X402_MAX_SERIALIZED_LENGTH,
} from "../payment-required.limits.js";

describe("truncateEcho", () => {
  it("echoes a value at or under the cap in full", () => {
    const widest = "9".repeat(X402_MAX_ECHOED_VALUE_LENGTH);

    expect(truncateEcho("base-mainnet-typo")).toBe("base-mainnet-typo");
    expect(truncateEcho(widest)).toBe(widest);
  });

  it("caps a long value and names the true length", () => {
    expect(truncateEcho("n".repeat(200_000))).toBe(
      `${"n".repeat(X402_MAX_ECHOED_VALUE_LENGTH)}… (200000 chars)`,
    );
  });

  it("never cuts between the halves of a surrogate pair", () => {
    // `value.slice(0, 78)` lands at an odd offset in a string of astral
    // characters and leaves a LONE HIGH SURROGATE at the end. ES2019
    // `JSON.stringify` escapes it, so a JSON response survives — but a
    // Buffer/Postgres write silently substitutes U+FFFD and some log
    // shippers reject the value outright.
    for (const value of [
      `a${"😀".repeat(60)}`,
      "😀".repeat(60),
      `ab${"😀".repeat(60)}`,
      `${"漢".repeat(40)}${"😀".repeat(40)}`,
    ]) {
      const echoed = truncateEcho(value);

      // A lone surrogate does not survive a UTF-8 round trip: Node encodes it
      // as U+FFFD. That IS the reported failure, so assert against it rather
      // than against a predicate.
      expect(Buffer.from(echoed, "utf8").toString("utf8")).toBe(echoed);
      expect(echoed.length).toBeLessThanOrEqual(
        X402_MAX_ECHOED_VALUE_LENGTH + `… (${value.length} chars)`.length,
      );
    }
  });

  it("still echoes as much as a whole code point allows", () => {
    // Dropping the split pair may cost one code unit, never more.
    const echoed = truncateEcho(`a${"😀".repeat(60)}`);

    expect(echoed.startsWith(`a${"😀".repeat(38)}`)).toBe(true);
    expect(echoed).toMatch(/… \(121 chars\)$/);
  });
});

describe("boundedMapCheck", () => {
  it("accepts a map inside every bound", () => {
    expect(boundedMapCheck({ name: "USD Coin", version: "2" })).toBe(true);
  });

  it("refuses too many entries, too long a key, or too large a value", () => {
    expect(
      boundedMapCheck(
        Object.fromEntries(
          Array.from({ length: X402_MAX_MAP_ENTRIES + 1 }, (_v, index) => [
            `key-${index}`,
            "v",
          ]),
        ),
      ),
    ).toBe(false);
    expect(
      boundedMapCheck({ ["k".repeat(X402_MAX_MAP_KEY_LENGTH + 1)]: "v" }),
    ).toBe(false);
    expect(
      boundedMapCheck({ blob: "x".repeat(X402_MAX_SERIALIZED_LENGTH) }),
    ).toBe(false);
  });

  it("fails closed instead of throwing on an unserializable value", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => boundedMapCheck(cyclic)).not.toThrow();
    expect(boundedMapCheck(cyclic)).toBe(false);
    expect(boundedMapCheck({ big: 1n })).toBe(false);
  });
});

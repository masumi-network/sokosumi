import { describe, expect, it } from "vitest";

import { formatTaskIdentifier } from "./task-identifier.js";

describe("formatTaskIdentifier", () => {
  it("joins prefix and number", () => {
    expect(formatTaskIdentifier("SOK", 12)).toBe("SOK-12");
  });

  it.each([
    [null, 12],
    [undefined, 12],
    ["", 12],
    ["SOK", null],
    ["SOK", undefined],
  ] as const)("returns null for %j + %j", (prefix, number) => {
    expect(formatTaskIdentifier(prefix, number)).toBeNull();
  });
});

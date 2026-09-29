import { describe, expect, it } from "vitest";

import {
  isValidProjectIdentifier,
  sanitizeProjectIdentifier,
} from "./project-identifier";

describe("sanitizeProjectIdentifier", () => {
  it("uppercases, strips other characters and caps at 7", () => {
    expect(sanitizeProjectIdentifier("web-app_1 x")).toBe("WEBAPP1");
    expect(sanitizeProjectIdentifier("abcdefghij")).toBe("ABCDEFG");
    expect(sanitizeProjectIdentifier("äö!")).toBe("");
  });
});

describe("isValidProjectIdentifier", () => {
  it.each(["SOK", "AB", "A1B2C3D"])("accepts %s", (value) => {
    expect(isValidProjectIdentifier(value)).toBe(true);
  });

  it.each(["", "S", "1AB", "abc", "TOOLONG1", "AB-1"])(
    "rejects %s",
    (value) => {
      expect(isValidProjectIdentifier(value)).toBe(false);
    },
  );
});

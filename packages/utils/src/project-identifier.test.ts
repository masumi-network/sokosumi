import { describe, expect, it } from "vitest";

import {
  isValidProjectIdentifier,
  projectIdentifierSchema,
  sanitizeProjectIdentifier,
} from "./project-identifier.js";

describe("sanitizeProjectIdentifier", () => {
  it("uppercases, strips other characters and caps at 7", () => {
    expect(sanitizeProjectIdentifier("web-app_1 x")).toBe("WEBAPP1");
    expect(sanitizeProjectIdentifier("abcdefghij")).toBe("ABCDEFG");
    expect(sanitizeProjectIdentifier("äö!")).toBe("");
  });
});

describe("isValidProjectIdentifier", () => {
  it.each(["SOK", "AB", "A1B2C3D", "abc", " sok1 "])("accepts %s", (value) => {
    expect(isValidProjectIdentifier(value)).toBe(true);
  });

  it.each(["", "S", "1AB", "TOOLONG1", "AB-1"])("rejects %s", (value) => {
    expect(isValidProjectIdentifier(value)).toBe(false);
  });
});

describe("projectIdentifierSchema", () => {
  it("trims and uppercases", () => {
    expect(projectIdentifierSchema.parse(" sok1 ")).toBe("SOK1");
  });
});

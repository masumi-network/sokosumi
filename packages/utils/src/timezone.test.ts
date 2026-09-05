import { describe, expect, it } from "vitest";

import { isValidTimezone } from "./timezone";

describe("isValidTimezone", () => {
  it("accepts an IANA timezone", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
  });

  it("rejects an invalid timezone", () => {
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
  });

  it("rejects empty and nullish values", () => {
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});

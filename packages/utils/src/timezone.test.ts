import { describe, expect, it } from "vitest";

import { isValidTimezone } from "./timezone";

describe("isValidTimezone", () => {
  it.each([
    "America/New_York",
    "Europe/Prague",
    "Europe/Zurich",
    "UTC",
    "Etc/UTC",
  ])("accepts %s", (zone) => {
    expect(isValidTimezone(zone)).toBe(true);
  });

  it.each([
    "Mars/Olympus_Mons",
    "America/New York",
    " UTC",
    "UTC ",
    "Europe/Prague ",
  ])("rejects %s", (zone) => {
    expect(isValidTimezone(zone)).toBe(false);
  });

  it("rejects empty and nullish values", () => {
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});

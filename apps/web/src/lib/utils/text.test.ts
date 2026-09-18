import { describe, expect, it } from "vitest";
import { getInitials } from "./text";

describe("getInitials", () => {
  it("takes the first letter of each word for multi-word names", () => {
    expect(getInitials("Team Soko")).toBe("TS");
    expect(getInitials("John Ronald Tolkien")).toBe("JR");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(getInitials("general")).toBe("GE");
    expect(getInitials("  Jane ")).toBe("JA");
  });

  it("returns a placeholder for an empty name", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});

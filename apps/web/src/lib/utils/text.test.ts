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

  it("leaves out a trailing qualifier in parentheses", () => {
    expect(getInitials("Themis (Beta)")).toBe("TH");
    expect(getInitials("Soupie (Linear & Github)")).toBe("SO");
    expect(getInitials("(Beta)")).toBe("(B");
  });

  it("keeps every other name as it was", () => {
    expect(getInitials("Ada ’Njeri")).toBe("A’");
    expect(getInitials("@Sam Lee")).toBe("@L");
    expect(getInitials("@sam")).toBe("@S");
    expect(getInitials("Ada (Ops) Lee")).toBe("A(");
  });

  it("never splits a letter outside the basic plane", () => {
    expect(getInitials("\u{20BB7}田 太郎")).toBe("\u{20BB7}太");
    expect(getInitials("@A\u{20BB7}")).toBe("@A");
    expect(getInitials("\u{20BB7}\u{20BB7}\u{20BB7}")).toBe(
      "\u{20BB7}\u{20BB7}",
    );
  });

  it("returns a placeholder for an empty name", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});

import { describe, expect, it } from "vitest";

import { bareHost, nonEmptyText, squash } from "./text";

describe("competitor text helpers", () => {
  it("matches names by their letters and digits", () => {
    expect(squash("Cal.com")).toBe(squash("cal com"));
    expect(squash("Zürich Café")).toBe("zürichcafé");
  });

  it("reads a host without www", () => {
    expect(bareHost("WWW.Calendly.com")).toBe("calendly.com");
    expect(bareHost("community.calendly.com")).toBe("community.calendly.com");
  });

  it("keeps only text with something in it", () => {
    expect(nonEmptyText("  Pro  ")).toBe("Pro");
    expect(nonEmptyText(" ")).toBeNull();
    expect(nonEmptyText(12)).toBeNull();
  });
});

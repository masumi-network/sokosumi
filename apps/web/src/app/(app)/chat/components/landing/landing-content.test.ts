import { describe, expect, it } from "vitest";

import { resolveLandingGreetingName } from "./landing-content";

describe("resolveLandingGreetingName", () => {
  it("uses the given name only", () => {
    expect(resolveLandingGreetingName("Andreas Schmidt")).toBe("Andreas");
  });

  it("returns null when blank so the nameless greeting shows", () => {
    expect(resolveLandingGreetingName(null)).toBeNull();
    expect(resolveLandingGreetingName("   ")).toBeNull();
  });
});

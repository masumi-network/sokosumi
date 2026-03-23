import { describe, expect, it } from "vitest";
import { getOSFromUserAgent } from "@/lib/utils";

describe("getOSFromUserAgent", () => {
  it("returns default values when navigator is undefined", () => {
    const originalNavigator = global.navigator;

    Object.defineProperty(global, "navigator", {
      value: undefined,
      configurable: true,
    });

    expect(getOSFromUserAgent()).toEqual({
      os: "Unknown",
      isMobile: false,
    });

    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { getOSFromUserAgent, isApplePlatform } from "@/lib/utils";

function mockNavigator(userAgent: string) {
  Object.defineProperty(global, "navigator", {
    value: { userAgent },
    configurable: true,
  });
}

describe("getOSFromUserAgent", () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("returns default values when navigator is undefined", () => {
    Object.defineProperty(global, "navigator", {
      value: undefined,
      configurable: true,
    });

    expect(getOSFromUserAgent()).toEqual({
      os: "Unknown",
      isMobile: false,
    });
  });

  it("detects MacOS from user agent", () => {
    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    );

    expect(getOSFromUserAgent()).toEqual({
      os: "MacOS",
      isMobile: false,
    });
  });

  it("detects iOS from user agent", () => {
    mockNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );

    expect(getOSFromUserAgent()).toEqual({
      os: "iOS",
      isMobile: true,
    });
  });
});

describe("isApplePlatform", () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("returns false when navigator is undefined", () => {
    Object.defineProperty(global, "navigator", {
      value: undefined,
      configurable: true,
    });

    expect(isApplePlatform()).toBe(false);
  });

  it("returns true for MacOS", () => {
    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    );

    expect(isApplePlatform()).toBe(true);
  });

  it("returns true for iOS", () => {
    mockNavigator(
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );

    expect(isApplePlatform()).toBe(true);
  });

  it("returns false for Windows", () => {
    mockNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    expect(isApplePlatform()).toBe(false);
  });
});

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useOSDetection } from "./use-os-detection";

const originalUserAgent = navigator.userAgent;

function stubUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

describe("useOSDetection", () => {
  afterEach(() => {
    stubUserAgent(originalUserAgent);
  });

  it("returns iOS from the user agent", () => {
    stubUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );

    const { result } = renderHook(() => useOSDetection());
    expect(result.current).toEqual({ os: "iOS", isMobile: true });
  });

  it("returns Windows from the user agent", () => {
    stubUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    const { result } = renderHook(() => useOSDetection());
    expect(result.current).toEqual({ os: "Windows", isMobile: false });
  });
});

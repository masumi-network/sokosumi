import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const MockAnalytics = () => null;
const MockSpeedInsights = () => null;

vi.mock("@vercel/analytics/next", () => ({
  Analytics: MockAnalytics,
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: MockSpeedInsights,
}));

import { useClientAnalyticsModules } from "./use-client-analytics-modules";

describe("useClientAnalyticsModules", () => {
  it("loads Analytics and SpeedInsights modules after mount", async () => {
    const { result } = renderHook(() => useClientAnalyticsModules());

    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toEqual({
        Analytics: MockAnalytics,
        SpeedInsights: MockSpeedInsights,
      });
    });
  });

  it("ignores resolution after unmount", async () => {
    const { result, unmount } = renderHook(() => useClientAnalyticsModules());

    unmount();
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current).toBeNull();
  });
});

import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPAIGNS_STALE_MS,
  useFeatureBadgesNavigationRefresh,
} from "@/hooks/effects/use-feature-badges-navigation-refresh";

describe("useFeatureBadgesNavigationRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches on pathname change only when cached campaigns are at least CAMPAIGNS_STALE_MS old", () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const updatedAt = Date.now();

    const { rerender } = renderHook(
      ({
        pathname,
        dataUpdatedAt,
      }: {
        pathname: string;
        dataUpdatedAt: number;
      }) => {
        const lastPathname = useRef(pathname);
        useFeatureBadgesNavigationRefresh({
          pathname,
          lastPathname,
          dataUpdatedAt,
          refetch,
        });
      },
      { initialProps: { pathname: "/tasks", dataUpdatedAt: updatedAt } },
    );

    // Initial mount does not refetch.
    expect(refetch).not.toHaveBeenCalled();

    // Navigating while data is still fresh skips refetch.
    vi.advanceTimersByTime(CAMPAIGNS_STALE_MS - 1);
    rerender({ pathname: "/agents", dataUpdatedAt: updatedAt });
    expect(refetch).not.toHaveBeenCalled();

    // Navigating once stale triggers a refetch.
    vi.advanceTimersByTime(1);
    rerender({ pathname: "/drive", dataUpdatedAt: updatedAt });
    expect(refetch).toHaveBeenCalledTimes(1);

    // Re-rendering on the same pathname does not refetch again.
    rerender({ pathname: "/drive", dataUpdatedAt: updatedAt });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

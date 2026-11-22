import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioImageRetryCleanup } from "./use-studio-image-retry-cleanup";

describe("useStudioImageRetryCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears a pending retry timeout on unmount", () => {
    const onRetry = vi.fn();
    const { result, unmount } = renderHook(() => useStudioImageRetryCleanup());

    result.current.current = setTimeout(() => {
      onRetry();
    }, 400);
    unmount();

    vi.advanceTimersByTime(500);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("lets a scheduled timeout fire while still mounted", () => {
    const onRetry = vi.fn();
    const { result, unmount } = renderHook(() => useStudioImageRetryCleanup());

    result.current.current = setTimeout(() => {
      onRetry();
    }, 400);
    vi.advanceTimersByTime(400);
    expect(onRetry).toHaveBeenCalledTimes(1);

    unmount();
  });
});

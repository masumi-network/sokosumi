import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioStatePolling } from "./use-studio-state-polling";

describe("useStudioStatePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll when projectId is null", () => {
    const refresh = vi.fn(async () => {});
    renderHook(() => useStudioStatePolling(null, true, refresh));

    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("polls every 15s while idle, switches to 3s while active, and clears on unmount", () => {
    const refresh = vi.fn(async () => {});
    const { rerender, unmount } = renderHook(
      ({ hasActive, projectId, onRefresh }) =>
        useStudioStatePolling(projectId, hasActive, onRefresh),
      {
        initialProps: {
          projectId: "proj-1" as string | null,
          hasActive: false,
          onRefresh: refresh,
        },
      },
    );

    vi.advanceTimersByTime(14_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ projectId: "proj-1", hasActive: true, onRefresh: refresh });
    vi.advanceTimersByTime(3_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    const nextRefresh = vi.fn(async () => {});
    rerender({ projectId: "proj-1", hasActive: true, onRefresh: nextRefresh });
    vi.advanceTimersByTime(3_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(nextRefresh).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(30_000);
    expect(nextRefresh).toHaveBeenCalledTimes(1);
  });
});

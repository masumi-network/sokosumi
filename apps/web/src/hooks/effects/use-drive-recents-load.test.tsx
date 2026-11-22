import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDriveRecentsLoad } from "./use-drive-recents-load";

describe("useDriveRecentsLoad", () => {
  it("runs loadRecents on mount and reruns on identity change while aborting both controllers on cleanup", () => {
    const loadAbortRef = { current: new AbortController() };
    const loadMoreAbortRef = { current: new AbortController() };
    const firstLoad = vi.fn(async () => {});
    const secondLoad = vi.fn(async () => {});

    const { rerender, unmount } = renderHook(
      ({ load }) => useDriveRecentsLoad(load, loadAbortRef, loadMoreAbortRef),
      { initialProps: { load: firstLoad } },
    );

    expect(firstLoad).toHaveBeenCalledTimes(1);

    const firstController = loadAbortRef.current;
    const firstMoreController = loadMoreAbortRef.current;
    rerender({ load: secondLoad });

    expect(firstController.signal.aborted).toBe(true);
    expect(firstMoreController.signal.aborted).toBe(true);
    expect(secondLoad).toHaveBeenCalledTimes(1);

    const nextController = new AbortController();
    const nextMoreController = new AbortController();
    loadAbortRef.current = nextController;
    loadMoreAbortRef.current = nextMoreController;

    unmount();
    expect(nextController.signal.aborted).toBe(true);
    expect(nextMoreController.signal.aborted).toBe(true);
  });
});

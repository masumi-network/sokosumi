import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEmailStepPendingRequest } from "./use-email-step-pending-request";

describe("useEmailStepPendingRequest", () => {
  it("sets mountedRef true on mount and clears it while aborting pending controller on unmount", () => {
    const { result, unmount } = renderHook(() => useEmailStepPendingRequest());

    expect(result.current.mountedRef.current).toBe(true);

    const controller = new AbortController();
    result.current.pendingRef.current = controller;
    expect(controller.signal.aborted).toBe(false);

    unmount();

    expect(result.current.mountedRef.current).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });
});

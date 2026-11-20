import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import {
  useAbortController,
  useAbortControllers,
} from "./use-abort-controller";

describe("useAbortController", () => {
  it("tracks an active controller without aborting across ordinary rerenders", () => {
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => {
        void count;
        return useAbortController();
      },
      { initialProps: { count: 0 } },
    );

    expect(result.current.isActive()).toBe(false);
    const controller = result.current.start();
    expect(controller.signal.aborted).toBe(false);
    expect(result.current.isActive()).toBe(true);

    rerender({ count: 1 });
    expect(controller.signal.aborted).toBe(false);
    expect(result.current.isActive()).toBe(true);
  });

  it("aborts the previous controller when starting a new one and on manual abort", () => {
    const { result } = renderHook(() => useAbortController());

    const first = result.current.start();
    const second = result.current.start();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    result.current.abort();
    expect(second.signal.aborted).toBe(true);
    expect(result.current.isActive()).toBe(false);
  });

  it("releases only when the given controller is still active", () => {
    const { result } = renderHook(() => useAbortController());

    const first = result.current.start();
    const second = result.current.start();

    result.current.release(first);
    expect(result.current.isActive()).toBe(true);

    result.current.release(second);
    expect(result.current.isActive()).toBe(false);
  });

  it("aborts the active controller on unmount and on resetKey change", () => {
    const { result, rerender, unmount } = renderHook(
      ({ scope }: { scope: string }) => useAbortController(scope),
      { initialProps: { scope: "org-1" } },
    );

    const first = result.current.start();
    rerender({ scope: "org-1" });
    expect(first.signal.aborted).toBe(false);

    rerender({ scope: "org-2" });
    expect(first.signal.aborted).toBe(true);
    expect(result.current.isActive()).toBe(false);

    const second = result.current.start();
    expect(second.signal.aborted).toBe(false);

    unmount();
    expect(second.signal.aborted).toBe(true);
  });

  it("does not abort a finished controller after release and works in StrictMode", () => {
    const { result, unmount } = renderHook(() => useAbortController(), {
      wrapper: StrictMode,
    });

    const controller = result.current.start();
    act(() => {
      result.current.release(controller);
    });
    unmount();
    expect(controller.signal.aborted).toBe(false);
  });
});

describe("useAbortControllers", () => {
  it("tracks concurrent controllers independently and aborts remaining ones on unmount", () => {
    const { result, unmount } = renderHook(() => useAbortControllers());

    const first = result.current.create();
    const second = result.current.create();
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(false);

    result.current.release(first);
    unmount();

    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(true);
  });

  it("aborts all active controllers synchronously on abortAll and on resetKey change", () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useAbortControllers(scope),
      { initialProps: { scope: "a" } },
    );

    const first = result.current.create();
    const second = result.current.create();
    result.current.abortAll();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);

    const third = result.current.create();
    rerender({ scope: "a" });
    expect(third.signal.aborted).toBe(false);

    rerender({ scope: "b" });
    expect(third.signal.aborted).toBe(true);
  });
});

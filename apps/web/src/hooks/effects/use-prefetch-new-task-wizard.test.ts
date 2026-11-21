import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wizardModuleLoadSpy = vi.fn();

describe("usePrefetchNewTaskWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("@/app/components/new-task-wizard", () => {
      wizardModuleLoadSpy();
      return { NewTaskWizard: () => null };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules idle prefetch and cancels it on unmount when requestIdleCallback exists", async () => {
    const { usePrefetchNewTaskWizard } = await import(
      "./use-prefetch-new-task-wizard"
    );
    const idleCallbacks: Array<() => void> = [];
    const requestIdleCallback = vi.fn((cb: () => void) => {
      idleCallbacks.push(cb);
      return 42;
    });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

    const { unmount } = renderHook(() => usePrefetchNewTaskWizard());

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 2000,
    });

    unmount();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);

    const second = renderHook(() => usePrefetchNewTaskWizard());
    idleCallbacks.at(-1)?.();
    await waitFor(() => expect(wizardModuleLoadSpy).toHaveBeenCalledTimes(1));
    second.unmount();
  });

  it("falls back to a 2s timeout when requestIdleCallback is unavailable", async () => {
    const { usePrefetchNewTaskWizard } = await import(
      "./use-prefetch-new-task-wizard"
    );
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);

    const first = renderHook(() => usePrefetchNewTaskWizard());
    first.unmount();
    vi.advanceTimersByTime(2000);
    expect(wizardModuleLoadSpy).not.toHaveBeenCalled();

    const second = renderHook(() => usePrefetchNewTaskWizard());
    vi.advanceTimersByTime(1999);
    expect(wizardModuleLoadSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await waitFor(() => expect(wizardModuleLoadSpy).toHaveBeenCalledTimes(1));
    second.unmount();
  });
});

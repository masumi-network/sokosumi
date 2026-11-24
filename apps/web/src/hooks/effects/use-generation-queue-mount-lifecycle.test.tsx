import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationQueueMountLifecycle } from "./use-generation-queue-mount-lifecycle";

function createTrackedRef<T>(initial: T): {
  ref: RefObject<T>;
  writes: T[];
} {
  let value = initial;
  const writes: T[] = [];
  const ref: RefObject<T> = {
    get current() {
      return value;
    },
    set current(next: T) {
      value = next;
      writes.push(next);
    },
  };
  return { ref, writes };
}

describe("useGenerationQueueMountLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks mounted in passive effect phase and clears mounted plus any pending retry timer on unmount", async () => {
    const mountedRef: RefObject<boolean> = { current: false };
    const retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null> = {
      current: null,
    };
    const siblingLayoutSetup: boolean[] = [];
    const siblingLayoutCleanup: boolean[] = [];
    const onRetry = vi.fn();

    function Probe() {
      useGenerationQueueMountLifecycle(mountedRef, retryTimerRef);
      useLayoutEffect(() => {
        siblingLayoutSetup.push(mountedRef.current);
        return () => {
          siblingLayoutCleanup.push(mountedRef.current);
        };
      }, []);
      return null;
    }

    const { unmount } = render(<Probe />);
    // Passive effect runs after layout effects.
    expect(siblingLayoutSetup).toEqual([false]);
    expect(mountedRef.current).toBe(true);

    retryTimerRef.current = setTimeout(() => {
      onRetry();
    }, 4_000);

    const onAfterResolve = vi.fn();
    let resolveRequest!: () => void;
    const pendingRequest = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }).then(() => {
      if (mountedRef.current) {
        onAfterResolve();
      }
    });

    unmount();

    // Layout cleanup ran before passive cleanup flipped mountedRef.
    expect(siblingLayoutCleanup).toEqual([true]);
    expect(mountedRef.current).toBe(false);
    expect(retryTimerRef.current).toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(onRetry).not.toHaveBeenCalled();

    resolveRequest();
    await pendingRequest;
    expect(onAfterResolve).not.toHaveBeenCalled();
  });

  it("cancels pending retry timer on Activity hide, restores on reveal, and counts exact StrictMode writes", () => {
    const mounted = createTrackedRef(false);
    const retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null> = {
      current: null,
    };
    const siblingLayoutOnReveal: boolean[] = [];
    const onRetry = vi.fn();

    function Probe({ tick: _tick }: { tick?: number }) {
      useGenerationQueueMountLifecycle(mounted.ref, retryTimerRef);
      useLayoutEffect(() => {
        siblingLayoutOnReveal.push(mounted.ref.current);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe tick={1} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.writes).toEqual([true, false, true]);
    expect(mounted.ref.current).toBe(true);
    expect(siblingLayoutOnReveal).toEqual([false, false]);

    // Rerendering while visible does not re-run the mount lifecycle effect.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe tick={2} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.writes).toEqual([true, false, true]);

    retryTimerRef.current = setTimeout(() => {
      onRetry();
    }, 4_000);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe tick={2} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.ref.current).toBe(false);
    expect(retryTimerRef.current).toBeNull();
    expect(mounted.writes).toEqual([true, false, true, false]);
    vi.advanceTimersByTime(5_000);
    expect(onRetry).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe tick={2} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.ref.current).toBe(true);
    // Passive restore happens after sibling layout effects on Activity reveal.
    expect(siblingLayoutOnReveal).toEqual([false, false, false, false]);
    expect(mounted.writes).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);

    unmount();
    expect(mounted.writes).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });
});

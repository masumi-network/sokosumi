import { render } from "@testing-library/react";
import {
  Activity,
  type RefObject,
  StrictMode,
  useEffect,
  useLayoutEffect,
} from "react";
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

  it("marks mounted in layout phase and clears mounted plus any pending retry timer before passive cleanup on unmount", async () => {
    const mountedRef: RefObject<boolean> = { current: false };
    const retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null> = {
      current: null,
    };
    const siblingLayoutSetup: boolean[] = [];
    const passiveCleanupObserved: boolean[] = [];
    const onRetry = vi.fn();

    function Probe() {
      // Registered before the hook: its passive cleanup only observes false if
      // the lifecycle hook clears mountedRef in useLayoutEffect.
      useEffect(() => {
        return () => {
          passiveCleanupObserved.push(mountedRef.current);
        };
      }, []);

      useGenerationQueueMountLifecycle(mountedRef, retryTimerRef);

      useLayoutEffect(() => {
        siblingLayoutSetup.push(mountedRef.current);
      }, []);
      return null;
    }

    const { unmount } = render(<Probe />);
    // Layout effect runs before sibling layout effects registered after it.
    expect(siblingLayoutSetup).toEqual([true]);
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

    // Layout cleanup flipped mountedRef before passive cleanup ran.
    expect(passiveCleanupObserved).toEqual([false]);
    expect(mountedRef.current).toBe(false);
    expect(retryTimerRef.current).toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(onRetry).not.toHaveBeenCalled();

    resolveRequest();
    await pendingRequest;
    expect(onAfterResolve).not.toHaveBeenCalled();
  });

  it("cancels pending retry timer before passive cleanup on Activity hide, restores in layout phase on reveal, and counts exact StrictMode writes", () => {
    const mounted = createTrackedRef(false);
    const retryTimerRef: RefObject<ReturnType<typeof setTimeout> | null> = {
      current: null,
    };
    const siblingLayoutOnReveal: boolean[] = [];
    const passiveCleanupObserved: boolean[] = [];
    const onRetry = vi.fn();

    function Probe({ tick: _tick }: { tick?: number }) {
      useEffect(() => {
        return () => {
          passiveCleanupObserved.push(mounted.ref.current);
        };
      }, []);
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
    expect(siblingLayoutOnReveal).toEqual([true, true]);

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

    passiveCleanupObserved.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe tick={2} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.ref.current).toBe(false);
    expect(passiveCleanupObserved).toEqual([false]);
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
    // Layout restore happens before sibling layout effects on Activity reveal.
    expect(siblingLayoutOnReveal).toEqual([true, true, true, true]);
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

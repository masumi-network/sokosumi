import { render } from "@testing-library/react";
import {
  Activity,
  type RefObject,
  StrictMode,
  useEffect,
  useLayoutEffect,
} from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoChatLifecycle } from "./use-seo-chat-lifecycle";

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

describe("useSeoChatLifecycle", () => {
  it("marks alive before passive effects and retires an in-flight send on unmount", async () => {
    const alive: RefObject<boolean> = { current: false };
    const controller: RefObject<AbortController | null> = { current: null };
    const pendingAttempt: RefObject<{
      fingerprint: string;
      key: string;
    } | null> = {
      current: { fingerprint: "fp-1", key: "key-1" },
    };
    const passiveObserved: boolean[] = [];

    function Probe() {
      useSeoChatLifecycle(alive, controller, pendingAttempt);
      useEffect(() => {
        passiveObserved.push(alive.current);
        return () => {
          // Layout cleanup runs before passive cleanup.
          passiveObserved.push(alive.current);
        };
      }, []);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(alive.current).toBe(true);
    expect(passiveObserved).toEqual([true]);

    const abortController = new AbortController();
    controller.current = abortController;
    const onAfterResolve = vi.fn();
    let resolveRequest!: () => void;
    const pendingRequest = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }).then(() => {
      if (alive.current && !abortController.signal.aborted) {
        onAfterResolve();
      }
    });

    unmount();

    expect(alive.current).toBe(false);
    expect(abortController.signal.aborted).toBe(true);
    expect(pendingAttempt.current).toBeNull();
    expect(passiveObserved).toEqual([true, false]);

    resolveRequest();
    await pendingRequest;
    expect(onAfterResolve).not.toHaveBeenCalled();
  });

  it("restores alive before a sibling layout effect on Activity reveal and retires send before sibling layout cleanup on hide", () => {
    const alive: RefObject<boolean> = { current: false };
    const controller: RefObject<AbortController | null> = { current: null };
    const pendingAttempt: RefObject<{
      fingerprint: string;
      key: string;
    } | null> = { current: null };
    const siblingLayoutSetup: boolean[] = [];
    const siblingLayoutCleanup: Array<{
      alive: boolean;
      aborted: boolean;
      pending: { fingerprint: string; key: string } | null;
    }> = [];

    function Probe() {
      useSeoChatLifecycle(alive, controller, pendingAttempt);
      useLayoutEffect(() => {
        siblingLayoutSetup.push(alive.current);
        return () => {
          siblingLayoutCleanup.push({
            alive: alive.current,
            aborted: controller.current?.signal.aborted ?? false,
            pending: pendingAttempt.current,
          });
        };
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(alive.current).toBe(true);
    expect(siblingLayoutSetup).toEqual([true]);

    const hideController = new AbortController();
    controller.current = hideController;
    pendingAttempt.current = { fingerprint: "fp-hide", key: "key-hide" };

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(alive.current).toBe(false);
    expect(hideController.signal.aborted).toBe(true);
    expect(pendingAttempt.current).toBeNull();
    expect(siblingLayoutCleanup).toEqual([
      { alive: false, aborted: true, pending: null },
    ]);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(alive.current).toBe(true);
    expect(siblingLayoutSetup).toEqual([true, true]);

    const unmountController = new AbortController();
    controller.current = unmountController;
    pendingAttempt.current = { fingerprint: "fp-end", key: "key-end" };

    unmount();
    expect(alive.current).toBe(false);
    expect(unmountController.signal.aborted).toBe(true);
    expect(pendingAttempt.current).toBeNull();
    expect(siblingLayoutCleanup).toEqual([
      { alive: false, aborted: true, pending: null },
      { alive: false, aborted: true, pending: null },
    ]);
  });

  it("counts exact StrictMode writes across mount, Activity hide/reveal, and unmount", () => {
    const alive = createTrackedRef(true);
    const controller: RefObject<AbortController | null> = { current: null };
    const pendingAttempt = createTrackedRef<{
      fingerprint: string;
      key: string;
    } | null>(null);
    const siblingLayoutSetup: boolean[] = [];

    function Probe() {
      useSeoChatLifecycle(alive.ref, controller, pendingAttempt.ref);
      useLayoutEffect(() => {
        siblingLayoutSetup.push(alive.ref.current);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(alive.writes).toEqual([true, false, true]);
    expect(pendingAttempt.writes).toEqual([null]);
    expect(siblingLayoutSetup).toEqual([true, true]);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(alive.writes).toEqual([true, false, true, false]);
    expect(pendingAttempt.writes).toEqual([null, null]);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(alive.writes).toEqual([true, false, true, false, true, false, true]);
    expect(pendingAttempt.writes).toEqual([null, null, null]);
    expect(siblingLayoutSetup).toEqual([true, true, true, true]);

    unmount();
    expect(alive.writes).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(pendingAttempt.writes).toEqual([null, null, null, null]);
  });
});

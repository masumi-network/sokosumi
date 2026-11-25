import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAuthSessionProbeLifecycle } from "./use-auth-session-probe-lifecycle";

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

describe("useAuthSessionProbeLifecycle", () => {
  it("runs probe in passive phase and invalidates an in-flight probe on unmount", async () => {
    const mountedRef: RefObject<boolean> = { current: false };
    const probeGenerationRef: RefObject<number> = { current: 0 };
    const siblingLayoutSetup: boolean[] = [];
    const siblingLayoutCleanup: boolean[] = [];
    const onAfterResolve = vi.fn();

    let resolveRequest!: () => void;
    let pendingRequest: Promise<void> | undefined;
    const probe = vi.fn(() => {
      expect(mountedRef.current).toBe(true);
      const generation = ++probeGenerationRef.current;
      pendingRequest = new Promise<void>((resolve) => {
        resolveRequest = resolve;
      }).then(() => {
        if (mountedRef.current && generation === probeGenerationRef.current) {
          onAfterResolve();
        }
      });
      return pendingRequest;
    });

    function Probe() {
      useAuthSessionProbeLifecycle(mountedRef, probeGenerationRef, probe);
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
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probeGenerationRef.current).toBe(1);

    unmount();

    // Layout cleanup ran before passive cleanup flipped mountedRef.
    expect(siblingLayoutCleanup).toEqual([true]);
    expect(mountedRef.current).toBe(false);
    expect(probeGenerationRef.current).toBe(2);

    resolveRequest();
    await pendingRequest;
    expect(onAfterResolve).not.toHaveBeenCalled();
  });

  it("invalidates on Activity hide, re-probes on reveal, and counts exact StrictMode writes", () => {
    const mounted = createTrackedRef(false);
    const probeGeneration = createTrackedRef(0);
    const siblingLayoutOnReveal: boolean[] = [];
    const probe = vi.fn();

    function Probe({
      tick: _tick,
      onProbe,
    }: {
      tick?: number;
      onProbe: () => void;
    }) {
      useAuthSessionProbeLifecycle(mounted.ref, probeGeneration.ref, onProbe);
      useLayoutEffect(() => {
        siblingLayoutOnReveal.push(mounted.ref.current);
      }, []);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe tick={1} onProbe={probe} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.writes).toEqual([true, false, true]);
    expect(probeGeneration.writes).toEqual([1]);
    expect(mounted.ref.current).toBe(true);
    expect(probeGeneration.ref.current).toBe(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(siblingLayoutOnReveal).toEqual([false, false]);

    // Rerendering while visible with the same probe does not re-run the effect.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe tick={2} onProbe={probe} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.writes).toEqual([true, false, true]);
    expect(probeGeneration.writes).toEqual([1]);
    expect(probe).toHaveBeenCalledTimes(2);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe tick={2} onProbe={probe} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.ref.current).toBe(false);
    expect(probeGeneration.ref.current).toBe(2);
    expect(mounted.writes).toEqual([true, false, true, false]);
    expect(probeGeneration.writes).toEqual([1, 2]);
    expect(probe).toHaveBeenCalledTimes(2);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe tick={2} onProbe={probe} />
        </Activity>
      </StrictMode>,
    );
    expect(mounted.ref.current).toBe(true);
    expect(probeGeneration.ref.current).toBe(3);
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
    expect(probeGeneration.writes).toEqual([1, 2, 3]);
    expect(probe).toHaveBeenCalledTimes(4);

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
    expect(probeGeneration.writes).toEqual([1, 2, 3, 4]);
  });

  it("invalidates the previous probe and runs the new one when probe changes", () => {
    const mountedRef: RefObject<boolean> = { current: false };
    const probeGenerationRef: RefObject<number> = { current: 0 };
    const probeA = vi.fn();
    const probeB = vi.fn();

    function Probe({ probe }: { probe: () => void }) {
      useAuthSessionProbeLifecycle(mountedRef, probeGenerationRef, probe);
      return null;
    }

    const { rerender, unmount } = render(<Probe probe={probeA} />);
    expect(probeA).toHaveBeenCalledTimes(1);
    expect(probeGenerationRef.current).toBe(0);

    rerender(<Probe probe={probeB} />);
    expect(mountedRef.current).toBe(true);
    expect(probeGenerationRef.current).toBe(1);
    expect(probeB).toHaveBeenCalledTimes(1);

    unmount();
    expect(mountedRef.current).toBe(false);
    expect(probeGenerationRef.current).toBe(2);
  });
});

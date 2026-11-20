import { render, renderHook } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import { useIsMountedRef, useLayoutIsMountedRef } from "./use-is-mounted-ref";

describe("useIsMountedRef", () => {
  it("starts false during initial render, becomes true after commit, and flips false on unmount", () => {
    const duringRender: boolean[] = [];
    const exposed: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const ref = useIsMountedRef();
      duringRender.push(ref.current);
      exposed.ref = ref;
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(duringRender).toEqual([false]);
    expect(exposed.ref?.current).toBe(true);

    unmount();
    expect(exposed.ref?.current).toBe(false);
  });

  it("flips false when hidden by React Activity and back to true on reveal", () => {
    const exposed: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      exposed.ref = useIsMountedRef();
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(exposed.ref?.current).toBe(true);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(exposed.ref?.current).toBe(false);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(exposed.ref?.current).toBe(true);
  });
});

describe("useLayoutIsMountedRef", () => {
  it("starts true during render, stays true after layout commit, and flips false on unmount", () => {
    const { result, unmount } = renderHook(() => useLayoutIsMountedRef());
    expect(result.current.current).toBe(true);

    unmount();
    expect(result.current.current).toBe(false);
  });

  it("flips false when hidden by React Activity and back to true on reveal", () => {
    const exposed: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      exposed.ref = useLayoutIsMountedRef();
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(exposed.ref?.current).toBe(true);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(exposed.ref?.current).toBe(false);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(exposed.ref?.current).toBe(true);
  });
});

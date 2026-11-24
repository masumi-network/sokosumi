import { act, render } from "@testing-library/react";
import {
  Activity,
  type RefObject,
  StrictMode,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
} from "react";
import { describe, expect, it } from "vitest";

import { useTasksBoardAlive } from "./use-tasks-board-alive";

describe("useTasksBoardAlive", () => {
  it("starts false during render, becomes true on layout commit, and clears before passive cleanup on unmount", () => {
    const observed: boolean[] = [];
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const alive = useTasksBoardAlive();
      captured.ref = alive;
      observed.push(alive.current);
      useEffect(() => {
        observed.push(alive.current);
        return () => {
          // Layout cleanup runs before passive cleanup.
          observed.push(alive.current);
        };
      }, [alive]);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(observed).toEqual([false, true]);
    expect(captured.ref?.current).toBe(true);

    unmount();
    expect(captured.ref?.current).toBe(false);
    expect(observed).toEqual([false, true, false]);
  });

  it("clears before sibling layout cleanup on Activity hide and restores before sibling layout setup on reveal", () => {
    const siblingLayoutSetup: boolean[] = [];
    const siblingLayoutCleanup: boolean[] = [];
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const alive = useTasksBoardAlive();
      captured.ref = alive;
      useLayoutEffect(() => {
        siblingLayoutSetup.push(alive.current);
        return () => {
          siblingLayoutCleanup.push(alive.current);
        };
      }, [alive]);
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(captured.ref?.current).toBe(true);
    expect(siblingLayoutSetup).toEqual([true]);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(captured.ref?.current).toBe(false);
    expect(siblingLayoutCleanup).toEqual([false]);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(captured.ref?.current).toBe(true);
    expect(siblingLayoutSetup).toEqual([true, true]);

    unmount();
    expect(captured.ref?.current).toBe(false);
    expect(siblingLayoutCleanup).toEqual([false, false]);
  });

  it("survives StrictMode replay across mount, Activity hide/reveal, and unmount", () => {
    const siblingLayoutSetup: boolean[] = [];
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const alive = useTasksBoardAlive();
      captured.ref = alive;
      useLayoutEffect(() => {
        siblingLayoutSetup.push(alive.current);
      }, [alive]);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(true);
    expect(siblingLayoutSetup).toEqual([true, true]);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(false);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(true);
    expect(siblingLayoutSetup).toEqual([true, true, true, true]);

    unmount();
    expect(captured.ref?.current).toBe(false);
  });

  it("stays false for a suspended render that never commits", async () => {
    const gate = Promise.withResolvers<void>();
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function SuspendedProbe() {
      captured.ref = useTasksBoardAlive();
      use(gate.promise);
      return null;
    }

    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <SuspendedProbe />
        </Suspense>,
      );
    });

    expect(captured.ref?.current).toBe(false);
  });
});

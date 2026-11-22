import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useEffect } from "react";
import { describe, expect, it } from "vitest";

import { useSeoConnectionAlive } from "./use-seo-connection-alive";

describe("useSeoConnectionAlive", () => {
  it("keeps alive.current true during render and before passive effects, and flips it to false on unmount", () => {
    const observed: boolean[] = [];
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const alive = useSeoConnectionAlive();
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
    expect(observed).toEqual([true, true]);
    expect(captured.ref?.current).toBe(true);

    unmount();
    expect(captured.ref?.current).toBe(false);
    expect(observed).toEqual([true, true, false]);
  });

  it("survives StrictMode replay and flips across React Activity hide and reveal", () => {
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      captured.ref = useSeoConnectionAlive();
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

    unmount();
    expect(captured.ref?.current).toBe(false);
  });
});

import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useRoomsClientHeaderParticipantsShown } from "./use-rooms-client-header-participants-shown";

describe("useRoomsClientHeaderParticipantsShown", () => {
  it("commits false for the first painted frame and flips to true only in passive effect phase", () => {
    function Probe({ tick }: { tick: number }) {
      const shown = useRoomsClientHeaderParticipantsShown();
      return (
        <span data-testid="shown" data-tick={tick}>
          {String(shown)}
        </span>
      );
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      // flushSync inside act runs render + all useLayoutEffects (including any
      // layout-phase state updates) synchronously while passive useEffects wait
      // until act() exits. A useLayoutEffect or render-time swap would already
      // paint "true" before act() finishes.
      let paintedBeforePassive = "";
      act(() => {
        flushSync(() => {
          root.render(<Probe tick={1} />);
        });
        paintedBeforePassive = host.textContent ?? "";
      });
      expect(paintedBeforePassive).toBe("false");
      expect(host.textContent).toBe("true");

      // Later renders stay true without resetting to false.
      act(() => {
        root.render(<Probe tick={2} />);
      });
      expect(host.textContent).toBe("true");
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("stays true across StrictMode mount and Activity hide/reveal", () => {
    const firstCommitted: boolean[] = [];

    function Probe() {
      const shown = useRoomsClientHeaderParticipantsShown();
      useLayoutEffect(() => {
        firstCommitted.push(shown);
      }, []);
      return <span data-testid="shown">{String(shown)}</span>;
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(firstCommitted[0]).toBe(false);
    expect(screen.getByTestId("shown")).toHaveTextContent("true");

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("shown")).toHaveTextContent("true");
  });
});

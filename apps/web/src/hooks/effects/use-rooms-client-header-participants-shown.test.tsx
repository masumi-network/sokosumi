import { render, screen } from "@testing-library/react";
import {
  Activity,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { describe, expect, it } from "vitest";

import { useRoomsClientHeaderParticipantsShown } from "./use-rooms-client-header-participants-shown";

describe("useRoomsClientHeaderParticipantsShown", () => {
  it("commits false first and flips to true in passive effect phase", () => {
    const phases: string[] = [];

    function Probe({ tick }: { tick: number }) {
      const domRef = useRef<HTMLSpanElement | null>(null);
      useEffect(() => {
        phases.push(`passive-before-hook:${domRef.current?.textContent}`);
      });
      const shown = useRoomsClientHeaderParticipantsShown();
      useLayoutEffect(() => {
        phases.push(`layout:${String(shown)}`);
      });
      return (
        <span ref={domRef} data-testid="shown" data-tick={tick}>
          {String(shown)}
        </span>
      );
    }

    const { rerender } = render(<Probe tick={1} />);

    // First committed frame must stay false through layout and into passive
    // phase before the hook's mount passive effect reveals participant avatars.
    expect(phases).toEqual([
      "layout:false",
      "passive-before-hook:false",
      "layout:true",
      "passive-before-hook:true",
    ]);
    expect(screen.getByTestId("shown")).toHaveTextContent("true");

    // Later renders stay true without resetting to false.
    rerender(<Probe tick={2} />);
    expect(screen.getByTestId("shown")).toHaveTextContent("true");
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

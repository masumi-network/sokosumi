import { render } from "@testing-library/react";
import {
  Activity,
  type RefObject,
  StrictMode,
  useEffect,
  useLayoutEffect,
} from "react";
import { describe, expect, it } from "vitest";

import { useRoomsClientTranscriptActive } from "./use-rooms-client-transcript-active";

describe("useRoomsClientTranscriptActive", () => {
  it("keeps activeRef.current true during render and before passive effects, and flips it to false on unmount", () => {
    const observed: boolean[] = [];
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const activeRef = useRoomsClientTranscriptActive();
      captured.ref = activeRef;
      observed.push(activeRef.current);
      useEffect(() => {
        observed.push(activeRef.current);
        return () => {
          // Layout cleanup runs before passive cleanup.
          observed.push(activeRef.current);
        };
      }, [activeRef]);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(observed).toEqual([true, true]);
    expect(captured.ref?.current).toBe(true);

    unmount();
    expect(captured.ref?.current).toBe(false);
    expect(observed).toEqual([true, true, false]);
  });

  it("restores activeRef.current before a sibling layout effect on Activity reveal and clears it before sibling layout cleanup on hide", () => {
    const siblingLayoutSetup: boolean[] = [];
    const siblingLayoutCleanup: boolean[] = [];
    const captured: { ref: RefObject<boolean> | null } = { ref: null };

    function Probe() {
      const activeRef = useRoomsClientTranscriptActive();
      captured.ref = activeRef;
      useLayoutEffect(() => {
        siblingLayoutSetup.push(activeRef.current);
        return () => {
          siblingLayoutCleanup.push(activeRef.current);
        };
      }, [activeRef]);
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
      const activeRef = useRoomsClientTranscriptActive();
      captured.ref = activeRef;
      useLayoutEffect(() => {
        siblingLayoutSetup.push(activeRef.current);
      }, [activeRef]);
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
});

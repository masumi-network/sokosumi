import { act, render } from "@testing-library/react";
import { Activity, StrictMode, useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";

import { useTaskFilesExpanded } from "./use-task-files-expanded";

describe("useTaskFilesExpanded", () => {
  it("starts collapsed, toggles on demand, and preserves state across normal rerenders", () => {
    const captured: {
      latest: ReturnType<typeof useTaskFilesExpanded> | null;
    } = { latest: null };

    function Probe({ tick }: { tick: number }) {
      captured.latest = useTaskFilesExpanded();
      return <span data-tick={tick} />;
    }

    const { rerender, unmount } = render(<Probe tick={0} />);
    expect(captured.latest?.expanded).toBe(false);

    act(() => {
      captured.latest?.toggle();
    });
    expect(captured.latest?.expanded).toBe(true);

    rerender(<Probe tick={1} />);
    expect(captured.latest?.expanded).toBe(true);

    act(() => {
      captured.latest?.toggle();
    });
    expect(captured.latest?.expanded).toBe(false);

    unmount();
  });

  it("collapses before paint on Activity hide so a sibling layout effect sees collapsed on reveal", () => {
    const siblingLayoutSeen: boolean[] = [];
    const captured: {
      latest: ReturnType<typeof useTaskFilesExpanded> | null;
    } = { latest: null };

    function Probe() {
      const state = useTaskFilesExpanded();
      captured.latest = state;
      useLayoutEffect(() => {
        siblingLayoutSeen.push(state.expanded);
      }, [state.expanded]);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.latest?.expanded).toBe(false);
    expect(siblingLayoutSeen).toEqual([false, false]);

    act(() => {
      captured.latest?.toggle();
    });
    expect(captured.latest?.expanded).toBe(true);

    siblingLayoutSeen.length = 0;
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
    expect(captured.latest?.expanded).toBe(false);
    // Sibling layout effect on reveal never observes stale expanded=true.
    expect(siblingLayoutSeen).toEqual([false, false]);

    unmount();
  });
});

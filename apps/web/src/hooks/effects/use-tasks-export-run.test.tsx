import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode, useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";

import { useTasksExportRun } from "./use-tasks-export-run";

describe("useTasksExportRun", () => {
  it("increments run when closing from open, and does not increment again when unmounting after close", () => {
    const captured: { ref: RefObject<number> | null } = { ref: null };

    function Probe({ open }: { open: boolean }) {
      captured.ref = useTasksExportRun(open);
      return null;
    }

    const { rerender, unmount } = render(<Probe open={true} />);
    expect(captured.ref?.current).toBe(0);

    // Closing while open bumps run (cancels an export started while open).
    rerender(<Probe open={false} />);
    expect(captured.ref?.current).toBe(1);

    // Unmounting while already closed leaves run unchanged (export started during exit animation still completes).
    unmount();
    expect(captured.ref?.current).toBe(1);
  });

  it("increments run when unmounting directly while open, in the passive cleanup phase", () => {
    const siblingLayoutCleanupRun: number[] = [];
    const captured: { ref: RefObject<number> | null } = { ref: null };

    function Probe({ open }: { open: boolean }) {
      const run = useTasksExportRun(open);
      captured.ref = run;
      useLayoutEffect(() => {
        return () => {
          siblingLayoutCleanupRun.push(run.current);
        };
      }, [run]);
      return null;
    }

    const { unmount } = render(<Probe open={true} />);
    expect(captured.ref?.current).toBe(0);

    unmount();
    // Passive cleanup runs after layout cleanup.
    expect(siblingLayoutCleanupRun).toEqual([0]);
    expect(captured.ref?.current).toBe(1);
  });

  it("matches StrictMode replay and Activity hide/reveal run counts", () => {
    const captured: { ref: RefObject<number> | null } = { ref: null };

    function Probe({ open }: { open: boolean }) {
      captured.ref = useTasksExportRun(open);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe open={true} />
        </Activity>
      </StrictMode>,
    );
    // StrictMode runs passive cleanup once during mount replay while open=true.
    expect(captured.ref?.current).toBe(1);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe open={true} />
        </Activity>
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(2);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe open={true} />
        </Activity>
      </StrictMode>,
    );
    // Reveal runs StrictMode replay cleanup once -> 3.
    expect(captured.ref?.current).toBe(3);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe open={false} />
        </Activity>
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(4);

    // Hiding while open=false does not bump run.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe open={false} />
        </Activity>
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(4);

    unmount();
    expect(captured.ref?.current).toBe(4);
  });
});

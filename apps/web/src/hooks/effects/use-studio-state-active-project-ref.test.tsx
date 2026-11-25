import { render } from "@testing-library/react";
import {
  Activity,
  type RefObject,
  StrictMode,
  useEffect,
  useLayoutEffect,
} from "react";
import { describe, expect, it } from "vitest";

import { useStudioStateActiveProjectRef } from "./use-studio-state-active-project-ref";

describe("useStudioStateActiveProjectRef", () => {
  it("tracks the committed project in layout phase and clears before passive cleanup on switch, Activity hide, and unmount", () => {
    let ref!: RefObject<string | null>;
    const siblingLayoutObserved: Array<string | null> = [];
    const passiveCleanupObserved: Array<string | null> = [];

    function Probe({ projectId }: { projectId: string | null }) {
      // Registered before the hook: passive cleanup only sees null if the hook
      // clears in useLayoutEffect.
      useEffect(() => {
        return () => {
          passiveCleanupObserved.push(ref.current);
        };
      }, [projectId]);

      ref = useStudioStateActiveProjectRef(projectId);

      useLayoutEffect(() => {
        siblingLayoutObserved.push(ref.current);
      });

      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe projectId="project-a" />
      </Activity>,
    );

    expect(siblingLayoutObserved).toEqual(["project-a"]);
    expect(ref.current).toBe("project-a");

    // Switching projects updates the ref in layout phase.
    rerender(
      <Activity mode="visible">
        <Probe projectId="project-b" />
      </Activity>,
    );
    expect(ref.current).toBe("project-b");

    // Hiding under Activity clears the ref in layout phase before passive cleanups run.
    passiveCleanupObserved.length = 0;
    rerender(
      <Activity mode="hidden">
        <Probe projectId="project-b" />
      </Activity>,
    );
    expect(ref.current).toBeNull();
    expect(passiveCleanupObserved).toEqual([null]);

    // Revealing restores the project id in layout phase before paint.
    siblingLayoutObserved.length = 0;
    rerender(
      <Activity mode="visible">
        <Probe projectId="project-b" />
      </Activity>,
    );
    expect(siblingLayoutObserved).toEqual(["project-b"]);
    expect(ref.current).toBe("project-b");

    // Unmounting clears the ref before passive cleanups run.
    passiveCleanupObserved.length = 0;
    unmount();
    expect(ref.current).toBeNull();
    expect(passiveCleanupObserved).toEqual([null]);
  });

  it("leaves the active project installed after StrictMode mount and clears on unmount", () => {
    let ref!: RefObject<string | null>;

    function Probe() {
      ref = useStudioStateActiveProjectRef("project-strict");
      return null;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(ref.current).toBe("project-strict");

    unmount();
    expect(ref.current).toBeNull();
  });
});

import { render } from "@testing-library/react";
import { Activity, StrictMode, useEffect, useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";

import { useRoomsClientRoomSurfaceGuard } from "./use-rooms-client-room-surface-guard";

describe("useRoomsClientRoomSurfaceGuard", () => {
  it("retires in-flight async work in layout phase on room switch, Activity hide, and unmount, and restores on Activity reveal", async () => {
    const selectedRoomIdRef = { current: "room-1" as string | null };
    const boundaryLoadGenerationRef = { current: 0 };
    const threadLoadGenerationRef = { current: 0 };
    const siblingLayoutObserved: Array<string | null> = [];
    const passiveCleanupObserved: Array<{
      selectedRoomId: string | null;
      boundaryGen: number;
      threadGen: number;
    }> = [];

    function Probe({ roomId }: { roomId: string | null }) {
      // Registered before the guard: its passive cleanup runs after the guard's
      // layout cleanup only if the guard stays in useLayoutEffect.
      useEffect(() => {
        return () => {
          passiveCleanupObserved.push({
            selectedRoomId: selectedRoomIdRef.current,
            boundaryGen: boundaryLoadGenerationRef.current,
            threadGen: threadLoadGenerationRef.current,
          });
        };
      }, [roomId]);

      useRoomsClientRoomSurfaceGuard(
        roomId,
        selectedRoomIdRef,
        boundaryLoadGenerationRef,
        threadLoadGenerationRef,
      );

      // Sibling layout effect after the guard observes the restored room id
      // before paint on mount and on Activity reveal.
      useLayoutEffect(() => {
        siblingLayoutObserved.push(selectedRoomIdRef.current);
      });

      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe roomId="room-1" />
      </Activity>,
    );

    expect(siblingLayoutObserved).toEqual(["room-1"]);
    expect(selectedRoomIdRef.current).toBe("room-1");

    // Start pending room-bound async work while room-1 is active.
    const startedBoundaryGen = boundaryLoadGenerationRef.current;
    const startedThreadGen = threadLoadGenerationRef.current;
    let resolvePending!: () => void;
    const pendingWork = new Promise<void>((resolve) => {
      resolvePending = resolve;
    }).then(() => ({
      stillSelected: selectedRoomIdRef.current === "room-1",
      boundaryStillCurrent:
        boundaryLoadGenerationRef.current === startedBoundaryGen,
      threadStillCurrent: threadLoadGenerationRef.current === startedThreadGen,
    }));

    // Switching rooms retires the previous surface in layout phase before
    // passive cleanups run, then installs the new room id.
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-2" />
      </Activity>,
    );
    expect(selectedRoomIdRef.current).toBe("room-2");
    expect(boundaryLoadGenerationRef.current).toBe(startedBoundaryGen + 1);
    expect(threadLoadGenerationRef.current).toBe(startedThreadGen + 1);

    resolvePending();
    expect(await pendingWork).toEqual({
      stillSelected: false,
      boundaryStillCurrent: false,
      threadStillCurrent: false,
    });

    // Hiding under Activity clears selectedRoomIdRef and bumps both generations
    // before passive cleanups run.
    const beforeHideBoundaryGen = boundaryLoadGenerationRef.current;
    const beforeHideThreadGen = threadLoadGenerationRef.current;
    passiveCleanupObserved.length = 0;

    rerender(
      <Activity mode="hidden">
        <Probe roomId="room-2" />
      </Activity>,
    );
    expect(selectedRoomIdRef.current).toBeNull();
    expect(boundaryLoadGenerationRef.current).toBe(beforeHideBoundaryGen + 1);
    expect(threadLoadGenerationRef.current).toBe(beforeHideThreadGen + 1);
    expect(passiveCleanupObserved).toEqual([
      {
        selectedRoomId: null,
        boundaryGen: beforeHideBoundaryGen + 1,
        threadGen: beforeHideThreadGen + 1,
      },
    ]);

    // Revealing under Activity restores selectedRoomIdRef in layout phase so
    // sibling layout effects immediately see the active room id.
    siblingLayoutObserved.length = 0;
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-2" />
      </Activity>,
    );
    expect(siblingLayoutObserved).toEqual(["room-2"]);
    expect(selectedRoomIdRef.current).toBe("room-2");

    // Unmounting clears selectedRoomIdRef and bumps both generations before
    // passive cleanups run.
    const beforeUnmountBoundaryGen = boundaryLoadGenerationRef.current;
    const beforeUnmountThreadGen = threadLoadGenerationRef.current;
    passiveCleanupObserved.length = 0;

    unmount();
    expect(selectedRoomIdRef.current).toBeNull();
    expect(boundaryLoadGenerationRef.current).toBe(
      beforeUnmountBoundaryGen + 1,
    );
    expect(threadLoadGenerationRef.current).toBe(beforeUnmountThreadGen + 1);
    expect(passiveCleanupObserved).toEqual([
      {
        selectedRoomId: null,
        boundaryGen: beforeUnmountBoundaryGen + 1,
        threadGen: beforeUnmountThreadGen + 1,
      },
    ]);
  });

  it("leaves the active room id installed after StrictMode mount and clears it on unmount", () => {
    const selectedRoomIdRef = { current: null as string | null };
    const boundaryLoadGenerationRef = { current: 0 };
    const threadLoadGenerationRef = { current: 0 };

    function Probe() {
      useRoomsClientRoomSurfaceGuard(
        "room-strict",
        selectedRoomIdRef,
        boundaryLoadGenerationRef,
        threadLoadGenerationRef,
      );
      return null;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(selectedRoomIdRef.current).toBe("room-strict");

    const genBeforeUnmount = boundaryLoadGenerationRef.current;
    unmount();
    expect(selectedRoomIdRef.current).toBeNull();
    expect(boundaryLoadGenerationRef.current).toBe(genBeforeUnmount + 1);
    expect(threadLoadGenerationRef.current).toBe(genBeforeUnmount + 1);
  });
});

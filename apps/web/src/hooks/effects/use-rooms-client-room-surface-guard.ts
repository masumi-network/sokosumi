"use client";

import { type RefObject, useLayoutEffect } from "react";

/**
 * Keeps `selectedRoomIdRef` synced to the mounted `RoomsClient` room surface in
 * the layout phase and retires room-bound async work when the room changes,
 * hides under React `<Activity>`, or unmounts.
 */
export function useRoomsClientRoomSurfaceGuard(
  selectedRoomId: string | null,
  selectedRoomIdRef: RefObject<string | null>,
  boundaryLoadGenerationRef: RefObject<number>,
  threadLoadGenerationRef: RefObject<number>,
): void {
  useLayoutEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
    return () => {
      selectedRoomIdRef.current = null;
      boundaryLoadGenerationRef.current += 1;
      threadLoadGenerationRef.current += 1;
    };
  }, [selectedRoomId]);
}

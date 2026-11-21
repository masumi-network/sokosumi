"use client";

import { useEffect } from "react";

interface DirtyMarkableRoomCache {
  markDirty: (roomId: string) => void;
}

/**
 * Marks a retained room's cache entry dirty when leaving that room or switching
 * caches, so the next visit reconciles against fresh state.
 */
export function useMarkRoomCacheDirtyOnExit(
  cache: DirtyMarkableRoomCache,
  roomId: string,
): void {
  useEffect(() => () => cache.markDirty(roomId), [cache, roomId]);
}

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMarkRoomCacheDirtyOnExit } from "./use-room-cache-dirty";

describe("useMarkRoomCacheDirtyOnExit", () => {
  it("marks the room dirty when roomId changes and on unmount", () => {
    const cache = { markDirty: vi.fn() };
    const { rerender, unmount } = renderHook(
      ({ roomId }) => useMarkRoomCacheDirtyOnExit(cache, roomId),
      { initialProps: { roomId: "room-1" } },
    );

    expect(cache.markDirty).not.toHaveBeenCalled();

    rerender({ roomId: "room-2" });
    expect(cache.markDirty).toHaveBeenCalledExactlyOnceWith("room-1");

    unmount();
    expect(cache.markDirty).toHaveBeenNthCalledWith(2, "room-2");
    expect(cache.markDirty).toHaveBeenCalledTimes(2);
  });

  it("marks the previous cache dirty when the cache instance changes", () => {
    const cacheA = { markDirty: vi.fn() };
    const cacheB = { markDirty: vi.fn() };
    const { rerender, unmount } = renderHook(
      ({ cache }) => useMarkRoomCacheDirtyOnExit(cache, "room-1"),
      { initialProps: { cache: cacheA } },
    );

    rerender({ cache: cacheB });
    expect(cacheA.markDirty).toHaveBeenCalledExactlyOnceWith("room-1");
    expect(cacheB.markDirty).not.toHaveBeenCalled();

    unmount();
    expect(cacheB.markDirty).toHaveBeenCalledExactlyOnceWith("room-1");
  });
});

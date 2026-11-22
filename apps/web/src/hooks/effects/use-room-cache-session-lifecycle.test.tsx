import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoomTranscriptCache } from "@/app/chat/utils/room-transcript-cache";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { useRoomCacheSessionLifecycle } from "./use-room-cache-session-lifecycle";

function Probe({
  cache,
  router,
}: {
  cache: RoomTranscriptCache;
  router: { replace: (href: string) => void };
}) {
  const generation = useRoomCacheSessionLifecycle(cache, router);
  return <span data-testid="gen">{generation}</span>;
}

describe("useRoomCacheSessionLifecycle", () => {
  it("activates cache, handles session-ended and room join/remove events, and clears on unmount", () => {
    const cache = {
      activate: vi.fn(() => true),
      clear: vi.fn(),
      joined: vi.fn(),
      evict: vi.fn(),
    } as unknown as RoomTranscriptCache;
    const router = { replace: vi.fn() };

    window.history.replaceState(null, "", "/chat/rooms/r-gone");
    const { unmount } = render(<Probe cache={cache} router={router} />);
    expect(cache.activate).toHaveBeenCalledOnce();
    expect(screen.getByTestId("gen")).toHaveTextContent("1");

    act(() => {
      notifyOrganizationChatRoomsChanged({ joinedRoomId: "r-joined" });
    });
    expect(cache.joined).toHaveBeenCalledWith("r-joined");
    expect(screen.getByTestId("gen")).toHaveTextContent("2");

    act(() => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r-gone" });
    });
    expect(cache.evict).toHaveBeenCalledWith("r-gone");
    expect(router.replace).toHaveBeenCalledWith("/?notice=room-unavailable");
    expect(screen.getByTestId("gen")).toHaveTextContent("3");

    act(() => {
      window.dispatchEvent(new Event("chat-session-ended"));
    });
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("gen")).toHaveTextContent("4");

    unmount();
    expect(cache.clear).toHaveBeenCalledTimes(2);

    // Events after unmount are ignored.
    act(() => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: "r-after" });
    });
    expect(cache.evict).toHaveBeenCalledTimes(1);
  });
});

import type { ChatRoom } from "@sokosumi/core-client";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_ROOM_UNREAD_RECHECK_MS,
  useOpenRoomUnreadRecheck,
} from "./use-open-room-unread-recheck";

function room(channelUnreadCount: number, updatedAt = "2026-09-30T16:50:00Z") {
  return {
    id: "room-1",
    channelUnreadCount,
    updatedAt: new Date(updatedAt),
  } as ChatRoom;
}

function mount(initial: { room: ChatRoom | null; messagesPending: boolean }) {
  const requestRefresh = vi.fn();
  const hook = renderHook(
    (props: { room: ChatRoom | null; messagesPending: boolean }) =>
      useOpenRoomUnreadRecheck({ ...props, requestRefresh }),
    { initialProps: initial },
  );
  return { ...hook, requestRefresh };
}

describe("useOpenRoomUnreadRecheck", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads once when the open room stays unread", () => {
    const { requestRefresh } = mount({
      room: room(1),
      messagesPending: false,
    });
    vi.advanceTimersByTime(OPEN_ROOM_UNREAD_RECHECK_MS - 1);
    expect(requestRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestRefresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(OPEN_ROOM_UNREAD_RECHECK_MS * 3);
    expect(requestRefresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing when read attention clears the count in time", () => {
    const { rerender, requestRefresh } = mount({
      room: room(1),
      messagesPending: false,
    });
    vi.advanceTimersByTime(1_000);
    rerender({ room: room(0), messagesPending: false });
    vi.advanceTimersByTime(OPEN_ROOM_UNREAD_RECHECK_MS * 2);
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("checks again for a newer unread message", () => {
    const { rerender, requestRefresh } = mount({
      room: room(1),
      messagesPending: false,
    });
    vi.advanceTimersByTime(OPEN_ROOM_UNREAD_RECHECK_MS);
    rerender({
      room: room(2, "2026-09-30T16:51:00Z"),
      messagesPending: false,
    });
    vi.advanceTimersByTime(OPEN_ROOM_UNREAD_RECHECK_MS);
    expect(requestRefresh).toHaveBeenCalledTimes(2);
  });

  it("waits while history is still loading", () => {
    const { requestRefresh } = mount({
      room: room(1),
      messagesPending: true,
    });
    vi.advanceTimersByTime(OPEN_ROOM_UNREAD_RECHECK_MS * 2);
    expect(requestRefresh).not.toHaveBeenCalled();
  });
});

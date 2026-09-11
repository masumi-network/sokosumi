import { describe, expect, it } from "vitest";
import { isThreadUnreadEvent } from "@/app/chat/utils/thread-unread-event";
import type { ChatRoomMessageEventData } from "@/lib/ably/schema";

function fullEvent(
  eventType: "create" | "update" | "delete",
  overrides: { roomId?: string; parentMessageId?: string | null } = {},
): ChatRoomMessageEventData {
  return {
    eventType,
    message: {
      id: "message-1",
      roomId: overrides.roomId ?? "room-1",
      parentMessageId:
        overrides.parentMessageId === undefined
          ? "thread-1"
          : overrides.parentMessageId,
      content: "Hello",
      createdAt: "2026-09-11T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      sender: null,
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: null,
      quote: null,
      membership: null,
      unfurls: null,
    },
  } as ChatRoomMessageEventData;
}

function envelope(
  eventType: "create" | "update" | "delete",
  overrides: { roomId?: string; parentMessageId?: string | null } = {},
): ChatRoomMessageEventData {
  return {
    eventType,
    messageId: "message-1",
    roomId: overrides.roomId ?? "room-1",
    parentMessageId:
      overrides.parentMessageId === undefined
        ? "thread-1"
        : overrides.parentMessageId,
  } as ChatRoomMessageEventData;
}

describe("isThreadUnreadEvent", () => {
  it("counts a reply in the open room, whichever shape it arrives in", () => {
    expect(isThreadUnreadEvent(fullEvent("create"), "room-1")).toBe(true);
    expect(isThreadUnreadEvent(envelope("create"), "room-1")).toBe(true);
  });

  it("counts a deleted reply, because Core stops counting it", () => {
    expect(isThreadUnreadEvent(fullEvent("delete"), "room-1")).toBe(true);
    expect(isThreadUnreadEvent(envelope("delete"), "room-1")).toBe(true);
  });

  it("ignores a top-level message", () => {
    expect(
      isThreadUnreadEvent(
        fullEvent("create", { parentMessageId: null }),
        "room-1",
      ),
    ).toBe(false);
    expect(
      isThreadUnreadEvent(
        envelope("create", { parentMessageId: null }),
        "room-1",
      ),
    ).toBe(false);
  });

  it("ignores a reply in another room", () => {
    expect(
      isThreadUnreadEvent(fullEvent("create", { roomId: "room-2" }), "room-1"),
    ).toBe(false);
  });

  it("ignores a field patch, which is not a new reply", () => {
    const reaction = {
      eventType: "reaction",
      messageId: "message-1",
      roomId: "room-1",
      parentMessageId: "thread-1",
      patch: { reactions: [] },
    } as ChatRoomMessageEventData;

    expect(isThreadUnreadEvent(reaction, "room-1")).toBe(false);
  });

  it("ignores everything when no room is open", () => {
    expect(isThreadUnreadEvent(fullEvent("create"), null)).toBe(false);
  });
});

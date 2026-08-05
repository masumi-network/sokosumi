import { describe, expect, it } from "vitest";

import {
  filterTopLevelChatRoomMessages,
  isReplyUnderThreadParent,
  isTopLevelChatRoomMessage,
  routeRealtimeChatRoomMessage,
  shouldApplyRealtimeMessageToOpenThread,
} from "../chat-room-message-scope";

describe("isTopLevelChatRoomMessage", () => {
  it("treats null parent as top-level", () => {
    expect(isTopLevelChatRoomMessage({ parentMessageId: null })).toBe(true);
  });

  it("treats missing parent as top-level", () => {
    expect(isTopLevelChatRoomMessage({})).toBe(true);
  });

  it("treats set parent as thread reply", () => {
    expect(isTopLevelChatRoomMessage({ parentMessageId: "parent-1" })).toBe(
      false,
    );
  });
});

describe("filterTopLevelChatRoomMessages", () => {
  it("keeps only top-level rows and drops thread replies", () => {
    const filtered = filterTopLevelChatRoomMessages([
      { id: "a", parentMessageId: null },
      { id: "b", parentMessageId: "parent-1" },
      { id: "c" },
    ]);
    expect(filtered.map((message) => message.id)).toEqual(["a", "c"]);
  });
});

describe("isReplyUnderThreadParent", () => {
  it("matches direct replies to the parent", () => {
    expect(
      isReplyUnderThreadParent({ parentMessageId: "parent-1" }, "parent-1"),
    ).toBe(true);
  });

  it("rejects top-level and other threads", () => {
    expect(
      isReplyUnderThreadParent({ parentMessageId: null }, "parent-1"),
    ).toBe(false);
    expect(
      isReplyUnderThreadParent({ parentMessageId: "other" }, "parent-1"),
    ).toBe(false);
  });
});

describe("shouldApplyRealtimeMessageToOpenThread", () => {
  it("returns false when no thread is open", () => {
    expect(
      shouldApplyRealtimeMessageToOpenThread(
        { id: "reply-1", parentMessageId: "parent-1" },
        null,
      ),
    ).toBe(false);
  });

  it("accepts the open thread root itself", () => {
    expect(
      shouldApplyRealtimeMessageToOpenThread(
        { id: "parent-1", parentMessageId: null },
        "parent-1",
      ),
    ).toBe(true);
  });

  it("accepts replies under the open thread root", () => {
    expect(
      shouldApplyRealtimeMessageToOpenThread(
        { id: "reply-1", parentMessageId: "parent-1" },
        "parent-1",
      ),
    ).toBe(true);
  });

  it("rejects replies under a different thread root", () => {
    expect(
      shouldApplyRealtimeMessageToOpenThread(
        { id: "reply-1", parentMessageId: "other-parent" },
        "parent-1",
      ),
    ).toBe(false);
  });
});

describe("routeRealtimeChatRoomMessage", () => {
  it("routes a top-level message to the room only when no thread is open", () => {
    expect(
      routeRealtimeChatRoomMessage(
        { id: "msg-1", parentMessageId: null },
        null,
      ),
    ).toEqual({
      mergeIntoRoomTimeline: true,
      mergeIntoOpenThread: false,
    });
  });

  it("routes a top-level open-thread parent to room and thread", () => {
    expect(
      routeRealtimeChatRoomMessage(
        { id: "parent-1", parentMessageId: null },
        "parent-1",
      ),
    ).toEqual({
      mergeIntoRoomTimeline: true,
      mergeIntoOpenThread: true,
    });
  });

  it("routes a thread reply only to the open thread, never the room", () => {
    expect(
      routeRealtimeChatRoomMessage(
        { id: "reply-1", parentMessageId: "parent-1" },
        "parent-1",
      ),
    ).toEqual({
      mergeIntoRoomTimeline: false,
      mergeIntoOpenThread: true,
    });
  });

  it("routes a reply under a closed/other thread nowhere", () => {
    expect(
      routeRealtimeChatRoomMessage(
        { id: "reply-1", parentMessageId: "parent-1" },
        null,
      ),
    ).toEqual({
      mergeIntoRoomTimeline: false,
      mergeIntoOpenThread: false,
    });
    expect(
      routeRealtimeChatRoomMessage(
        { id: "reply-1", parentMessageId: "parent-1" },
        "other-parent",
      ),
    ).toEqual({
      mergeIntoRoomTimeline: false,
      mergeIntoOpenThread: false,
    });
  });
});

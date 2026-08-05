import { describe, expect, it } from "vitest";

import {
  isTopLevelChatRoomMessage,
  shouldApplyRealtimeMessageToOpenThread,
  shouldMergeRealtimeMessageIntoRoomTimeline,
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

describe("shouldMergeRealtimeMessageIntoRoomTimeline", () => {
  it("accepts top-level messages for the main room transcript", () => {
    expect(
      shouldMergeRealtimeMessageIntoRoomTimeline({ parentMessageId: null }),
    ).toBe(true);
  });

  it("rejects thread replies so they do not appear in the room and thread", () => {
    expect(
      shouldMergeRealtimeMessageIntoRoomTimeline({
        parentMessageId: "parent-1",
      }),
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

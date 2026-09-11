import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listRoomMessagesAction } from "@/app/chat/actions";
import { scrollRoomTranscriptToMessage } from "@/app/chat/chat-message-list";
import { highlightRoomMessageElement } from "@/app/chat/components/room-helpers";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { useRoomMessageJumps } from "./use-room-message-jumps";

vi.mock("@/app/chat/actions", () => ({
  getRoomThreadAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
}));
vi.mock("@/app/chat/components/room-helpers", () => ({
  highlightRoomMessageElement: vi.fn(() => false),
}));
vi.mock("@/app/chat/chat-message-list", () => ({
  scrollRoomTranscriptToMessage: vi.fn(() => true),
}));

type Params = Parameters<typeof useRoomMessageJumps>[0];

function params(): Params {
  return {
    roomId: "room-1",
    topLevelRoomMessages: [],
    threadParentMessage: null,
    isStillSelectedRoom: vi.fn(() => true),
    suppressStickToBottom: vi.fn(),
    releaseStickToBottomSuppress: vi.fn(),
    setSearchHoldOffBottom: vi.fn(),
    setMessagesState: vi.fn(),
    setOlderNextCursor: vi.fn(),
    historicalTimelineRef: { current: false },
    historicalThreadRef: { current: false },
    setThreadMessages: vi.fn(),
    setThreadOlderNextCursor: vi.fn(),
    handleOpenThreadFromMessage: vi.fn(async () => true),
  };
}

function message(): ChatRoomMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Hello",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    deletedAt: null,
    editedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
  };
}

describe("useRoomMessageJumps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(highlightRoomMessageElement).mockReturnValue(false);
  });

  it("discards an invalidated room window and releases its hold", async () => {
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof listRoomMessagesAction>>
      >();
    vi.mocked(listRoomMessagesAction).mockReturnValue(pending.promise);
    const options = params();
    const { result } = renderHook(() => useRoomMessageJumps(options));

    const jump = result.current.handleJumpToMessage("message-1");
    expect(options.suppressStickToBottom).toHaveBeenCalledOnce();
    result.current.invalidateJump();
    pending.resolve({
      ok: true,
      value: { messages: [message()], nextCursor: "older" },
    });
    await jump;

    expect(options.setMessagesState).not.toHaveBeenCalled();
    expect(options.setOlderNextCursor).not.toHaveBeenCalled();
    expect(highlightRoomMessageElement).toHaveBeenCalledTimes(1);
    expect(options.releaseStickToBottomSuppress).toHaveBeenCalledOnce();
    expect(options.setSearchHoldOffBottom).toHaveBeenLastCalledWith(false);
  });

  it("merges a current room window without marking the timeline historical", async () => {
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: { messages: [message()], nextCursor: "older" },
    });
    const options = params();
    const { result } = renderHook(() => useRoomMessageJumps(options));

    await result.current.handleJumpToMessage("message-1");

    expect(options.setMessagesState).toHaveBeenCalledWith(expect.any(Function));
    expect(options.setOlderNextCursor).toHaveBeenCalledWith("older");
    expect(options.historicalTimelineRef.current).toBe(false);
    expect(highlightRoomMessageElement).toHaveBeenCalledTimes(2);
    expect(options.releaseStickToBottomSuppress).toHaveBeenCalledOnce();
  });

  it("opens a loaded search parent and releases the hold when its reply is visible", async () => {
    const parent = message();
    const reply = { ...message(), id: "reply-1", parentMessageId: parent.id };
    const options = params();
    options.topLevelRoomMessages = [parent];
    vi.mocked(highlightRoomMessageElement).mockReturnValue(true);
    const { result } = renderHook(() => useRoomMessageJumps(options));

    await result.current.handleSearchJump(reply);

    expect(options.handleOpenThreadFromMessage).toHaveBeenCalledWith(parent);
    expect(highlightRoomMessageElement).toHaveBeenCalledWith(reply.id);
    expect(options.releaseStickToBottomSuppress).toHaveBeenCalledOnce();
    expect(options.setThreadMessages).not.toHaveBeenCalled();
    // The transcript follows the thread: without this the reader lands on a
    // reply with the room still sitting on the newest message.
    expect(scrollRoomTranscriptToMessage).toHaveBeenCalledWith(parent.id);
  });
});

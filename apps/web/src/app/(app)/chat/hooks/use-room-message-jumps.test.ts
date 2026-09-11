import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listRoomMessagesAction } from "@/app/chat/actions";
import {
  highlightRoomTranscriptMessage,
  highlightThreadMessage,
} from "@/app/chat/utils/room-message-highlight";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { useRoomMessageJumps } from "./use-room-message-jumps";

vi.mock("@/app/chat/actions", () => ({
  getRoomThreadAction: vi.fn(),
  listRoomMessagesAction: vi.fn(),
  listThreadMessagesAction: vi.fn(),
}));
vi.mock("@/app/chat/utils/room-message-highlight", () => ({
  highlightThreadMessage: vi.fn(() => false),
  highlightRoomTranscriptMessage: vi.fn(() => false),
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
    vi.mocked(highlightThreadMessage).mockReturnValue(false);
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
    await expect(jump).resolves.toBe(false);

    expect(options.setMessagesState).not.toHaveBeenCalled();
    expect(options.setOlderNextCursor).not.toHaveBeenCalled();
    // The room jump lands in the transcript, so it asks the transcript alone:
    // an open thread renders its parent too, and answering from there would
    // end the jump with the transcript untouched.
    expect(highlightRoomTranscriptMessage).toHaveBeenCalledTimes(1);
    expect(highlightThreadMessage).not.toHaveBeenCalled();
    expect(options.releaseStickToBottomSuppress).toHaveBeenCalledOnce();
    expect(options.setSearchHoldOffBottom).not.toHaveBeenCalled();
  });

  it("merges a current room window without marking the timeline historical", async () => {
    vi.mocked(listRoomMessagesAction).mockResolvedValue({
      ok: true,
      value: { messages: [message()], nextCursor: "older" },
    });
    vi.mocked(highlightRoomTranscriptMessage)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const options = params();
    const { result } = renderHook(() => useRoomMessageJumps(options));

    await expect(result.current.handleJumpToMessage("message-1")).resolves.toBe(
      true,
    );

    expect(options.setMessagesState).toHaveBeenCalledWith(expect.any(Function));
    expect(options.setOlderNextCursor).toHaveBeenCalledWith("older");
    expect(options.historicalTimelineRef.current).toBe(false);
    expect(highlightRoomTranscriptMessage).toHaveBeenCalledTimes(2);
    expect(options.releaseStickToBottomSuppress).toHaveBeenCalledOnce();
  });

  it("opens a loaded search parent and releases the hold when its reply is visible", async () => {
    const parent = message();
    const reply = { ...message(), id: "reply-1", parentMessageId: parent.id };
    const options = params();
    options.topLevelRoomMessages = [parent];
    vi.mocked(highlightThreadMessage).mockReturnValue(true);
    const { result } = renderHook(() => useRoomMessageJumps(options));

    await result.current.handleSearchJump(reply);

    expect(options.handleOpenThreadFromMessage).toHaveBeenCalledWith(parent);
    expect(highlightThreadMessage).toHaveBeenCalledWith(reply.id);
    expect(options.releaseStickToBottomSuppress).toHaveBeenCalledOnce();
    expect(options.setThreadMessages).not.toHaveBeenCalled();
    // The transcript follows the thread: without this the reader lands on a
    // reply with the room still sitting on the newest message.
    expect(highlightRoomTranscriptMessage).toHaveBeenCalledWith(parent.id);
  });
});

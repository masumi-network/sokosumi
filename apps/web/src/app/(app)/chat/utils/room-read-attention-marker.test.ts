import { describe, expect, it } from "vitest";

import { roomReadAttentionMarker } from "@/app/chat/utils/room-read-attention-marker";

describe("roomReadAttentionMarker", () => {
  it("changes when an open thread parent is set so room mark-read re-fires", () => {
    const before = roomReadAttentionMarker({
      roomId: "room-1",
      latestTopLevelMessageId: "msg-top",
      openThreadParentId: null,
      latestOpenThreadMessageId: null,
    });
    const after = roomReadAttentionMarker({
      roomId: "room-1",
      latestTopLevelMessageId: "msg-top",
      openThreadParentId: "msg-top",
      latestOpenThreadMessageId: null,
    });

    expect(before).not.toBe(after);
    expect(after).toContain("msg-top:msg-top:none");
  });

  it("changes when a new reply lands in the open thread", () => {
    const before = roomReadAttentionMarker({
      roomId: "room-1",
      latestTopLevelMessageId: "msg-top",
      openThreadParentId: "msg-top",
      latestOpenThreadMessageId: "reply-1",
    });
    const after = roomReadAttentionMarker({
      roomId: "room-1",
      latestTopLevelMessageId: "msg-top",
      openThreadParentId: "msg-top",
      latestOpenThreadMessageId: "reply-2",
    });

    expect(before).not.toBe(after);
  });

  it("stays stable when only unrelated fields are absent the same way", () => {
    expect(
      roomReadAttentionMarker({
        roomId: "room-1",
        latestTopLevelMessageId: undefined,
        openThreadParentId: undefined,
        latestOpenThreadMessageId: undefined,
      }),
    ).toBe("room-1:empty:none:none");
  });
});

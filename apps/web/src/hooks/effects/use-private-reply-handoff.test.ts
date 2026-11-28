import type { ChatRoomMessage } from "@sokosumi/core-client";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { handOffPrivateReply } from "@/app/chat/utils/private-reply-handoff";

import { usePrivateReplyHandoff } from "./use-private-reply-handoff";

const message = {
  id: "msg-1",
  roomId: "room-channel",
  content: "Ship it?",
  sender: {
    type: "user",
    user: {
      id: "user-2",
      name: "Grace",
      email: "grace@example.com",
      image: null,
      presence: "online",
    },
  },
} as ChatRoomMessage;

describe("usePrivateReplyHandoff", () => {
  it("hands the quote over when its Direct opens, once", () => {
    const onQuote = vi.fn();
    const { rerender } = renderHook(
      ({ roomId }: { roomId: string | null }) =>
        usePrivateReplyHandoff(roomId, onQuote),
      { initialProps: { roomId: "room-channel" as string | null } },
    );
    handOffPrivateReply("room-dm", message);
    expect(onQuote).not.toHaveBeenCalled();

    rerender({ roomId: "room-dm" });
    expect(onQuote).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ messageId: "msg-1", roomId: "room-channel" }),
    );

    rerender({ roomId: "room-channel" });
    rerender({ roomId: "room-dm" });
    expect(onQuote).toHaveBeenCalledTimes(1);
  });

  it("hands the quote over when the Direct mounts with it", () => {
    const onQuote = vi.fn();
    handOffPrivateReply("room-dm", message);

    renderHook(() => usePrivateReplyHandoff("room-dm", onQuote));

    expect(onQuote).toHaveBeenCalledTimes(1);
  });
});

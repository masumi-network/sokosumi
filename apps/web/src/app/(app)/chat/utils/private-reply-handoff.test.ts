import type { ChatRoomMessage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  CHAT_PRIVATE_REPLY_PARAM,
  handOffPrivateReply,
  takePrivateReply,
} from "./private-reply-handoff";

const message = {
  id: "msg-1",
  roomId: "room-channel",
  content: "Can we move the launch to Friday?",
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

function nonceOf(href: string): string | null {
  return new URL(href, "https://app.test").searchParams.get(
    CHAT_PRIVATE_REPLY_PARAM,
  );
}

describe("private reply handoff", () => {
  it("sends the navigation to the Direct with a nonce for its quote", () => {
    const href = handOffPrivateReply("/chat/rooms/room-dm", message);

    expect(href).toMatch(/^\/chat\/rooms\/room-dm\?reply=/);
    expect(takePrivateReply(nonceOf(href))).toEqual({
      messageId: "msg-1",
      authorName: "Grace",
      snippet: "Can we move the launch to Friday?",
      attachments: [],
      roomId: "room-channel",
    });
  });

  it("gives the quote once", () => {
    const nonce = nonceOf(handOffPrivateReply("/chat/rooms/room-dm", message));
    takePrivateReply(nonce);

    expect(takePrivateReply(nonce)).toBeNull();
  });

  it("gives nothing to an arrival that carries no nonce or another one", () => {
    const nonce = nonceOf(handOffPrivateReply("/chat/rooms/room-dm", message));

    expect(takePrivateReply(null)).toBeNull();
    expect(takePrivateReply("other")).toBeNull();
    expect(takePrivateReply(nonce)).not.toBeNull();
  });

  it("drops an earlier navigation's quote when a newer one starts", () => {
    const first = nonceOf(handOffPrivateReply("/chat/rooms/room-a", message));
    const second = nonceOf(handOffPrivateReply("/chat/rooms/room-b", message));

    expect(takePrivateReply(first)).toBeNull();
    expect(takePrivateReply(second)).not.toBeNull();
  });
});

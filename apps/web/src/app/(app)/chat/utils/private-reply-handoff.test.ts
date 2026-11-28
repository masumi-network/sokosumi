import type { ChatRoomMessage } from "@sokosumi/core-client";
import { afterEach, describe, expect, it } from "vitest";

import { handOffPrivateReply, takePrivateReply } from "./private-reply-handoff";

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

describe("private reply handoff", () => {
  afterEach(() => {
    takePrivateReply("room-dm");
  });

  it("gives the Direct a quote of the channel message, naming its room", () => {
    handOffPrivateReply("room-dm", message);

    expect(takePrivateReply("room-dm")).toEqual({
      messageId: "msg-1",
      authorName: "Grace",
      snippet: "Can we move the launch to Friday?",
      attachments: [],
      roomId: "room-channel",
    });
  });

  it("gives the quote once", () => {
    handOffPrivateReply("room-dm", message);
    takePrivateReply("room-dm");

    expect(takePrivateReply("room-dm")).toBeNull();
  });

  it("keeps the quote from another room", () => {
    handOffPrivateReply("room-dm", message);

    expect(takePrivateReply("room-other")).toBeNull();
    expect(takePrivateReply("room-dm")).not.toBeNull();
  });
});

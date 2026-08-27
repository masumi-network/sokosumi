import { describe, expect, it } from "vitest";

import { CHAT_ROOM_MESSAGE_EVENT_TYPES } from "./chat-room-message-event-type";

describe("CHAT_ROOM_MESSAGE_EVENT_TYPES", () => {
  it("lists the stable Ably chat_room_message intents", () => {
    expect([...CHAT_ROOM_MESSAGE_EVENT_TYPES]).toEqual([
      "create",
      "update",
      "delete",
      "reaction",
      "unfurl",
      "mention_status",
    ]);
  });
});

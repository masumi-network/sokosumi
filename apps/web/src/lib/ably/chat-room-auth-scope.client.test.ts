import { describe, expect, it } from "vitest";

import {
  getAblyChatRoomScope,
  registerAblyChatRoomScope,
} from "./chat-room-auth-scope.client";

describe("Ably active chat room scope", () => {
  it("keeps the room granted until both message and typing subscribers leave", () => {
    const releaseMessages = registerAblyChatRoomScope(["room-a"]);
    const releaseTyping = registerAblyChatRoomScope(["room-a"]);
    expect(getAblyChatRoomScope()).toEqual(["room-a"]);

    releaseMessages();
    releaseMessages();
    expect(getAblyChatRoomScope()).toEqual(["room-a"]);

    releaseTyping();
    expect(getAblyChatRoomScope()).toEqual([]);
  });

  it("retains another mounted room while one subscriber changes rooms", () => {
    const releaseOldRoom = registerAblyChatRoomScope(["room-a", "room-a"]);
    const releaseNewRoom = registerAblyChatRoomScope(["room-b"]);
    expect(getAblyChatRoomScope()).toEqual(["room-a", "room-b"]);

    releaseOldRoom();
    expect(getAblyChatRoomScope()).toEqual(["room-b"]);

    releaseNewRoom();
    expect(getAblyChatRoomScope()).toEqual([]);
  });
});

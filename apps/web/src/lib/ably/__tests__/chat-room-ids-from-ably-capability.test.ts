import { describe, expect, it } from "vitest";

import { chatRoomIdsFromAblyCapability } from "../chat-room-ids-from-ably-capability";

describe("chatRoomIdsFromAblyCapability", () => {
  it("parses JSON string capability and ignores non-room channels", () => {
    const capability = JSON.stringify({
      "chat_rooms:room_room-a": ["subscribe"],
      "chat_rooms:room_room-b": ["subscribe"],
      "notifications:all:user_x": ["subscribe"],
      "agent_jobs:*:user_x": ["subscribe"],
    });

    expect(chatRoomIdsFromAblyCapability(capability)).toEqual(
      new Set(["room-a", "room-b"]),
    );
  });

  it("parses object capability and returns empty set when no rooms", () => {
    expect(
      chatRoomIdsFromAblyCapability({
        "notifications:all:user_x": ["subscribe"],
      }),
    ).toEqual(new Set());
  });

  it("returns null for missing or malformed capability", () => {
    expect(chatRoomIdsFromAblyCapability(undefined)).toBeNull();
    expect(chatRoomIdsFromAblyCapability(null)).toBeNull();
    expect(chatRoomIdsFromAblyCapability("not-json")).toBeNull();
    expect(chatRoomIdsFromAblyCapability(["chat_rooms:room_a"])).toBeNull();
  });
});

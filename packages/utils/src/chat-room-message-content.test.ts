import { describe, expect, it } from "vitest";

import {
  CHAT_ROOM_MESSAGE_CONTENT_COUNT_VISIBLE_AT,
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE,
} from "./chat-room-message-content";

describe("CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH", () => {
  it("is 10_000 for human room-message create and update", () => {
    expect(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH).toBe(10_000);
  });

  it("shows the composer count 500 characters before the max", () => {
    expect(CHAT_ROOM_MESSAGE_CONTENT_COUNT_VISIBLE_AT).toBe(9_500);
    expect(CHAT_ROOM_MESSAGE_CONTENT_COUNT_VISIBLE_AT).toBe(
      CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH - 500,
    );
  });

  it("names the max in the too-long API copy", () => {
    expect(CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE).toContain("too long");
    expect(CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE).toContain(
      String(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH),
    );
  });
});

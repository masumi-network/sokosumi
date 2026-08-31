import { describe, expect, it } from "vitest";

import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE,
} from "./chat-room-message-content";

describe("CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH", () => {
  it("is 40_000 so a typical research-note paste (~12k) can send", () => {
    expect(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH).toBe(40_000);
    expect(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH).toBeGreaterThan(11_699);
  });

  it("names the max in the too-long API copy", () => {
    expect(CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE).toContain("too long");
    expect(CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE).toContain(
      String(CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  CHAT_ROOM_COLLECTIONS,
  CHAT_ROOMS_CHANGED_EVENT_NAME,
} from "./chat-rooms-changed";

describe("chat rooms changed contract", () => {
  it("exports a stable Ably event name", () => {
    expect(CHAT_ROOMS_CHANGED_EVENT_NAME).toBe("chat_rooms_changed");
  });

  it("lists the sidebar collections Core can invalidate", () => {
    expect([...CHAT_ROOM_COLLECTIONS]).toEqual([
      "active",
      "archived",
      "invitations",
    ]);
  });
});

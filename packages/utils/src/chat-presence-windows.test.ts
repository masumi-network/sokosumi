import { describe, expect, it } from "vitest";

import {
  CHAT_PRESENCE_AFK_WINDOW_MS,
  CHAT_PRESENCE_ONLINE_WINDOW_MS,
} from "./chat-presence-windows.js";

describe("chat presence windows", () => {
  it("keeps online shorter than afk", () => {
    expect(CHAT_PRESENCE_ONLINE_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(CHAT_PRESENCE_AFK_WINDOW_MS).toBe(30 * 60 * 1000);
    expect(CHAT_PRESENCE_ONLINE_WINDOW_MS).toBeLessThan(
      CHAT_PRESENCE_AFK_WINDOW_MS,
    );
  });
});

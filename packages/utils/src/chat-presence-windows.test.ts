import { describe, expect, it } from "vitest";

import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "./chat-presence-windows.js";

describe("chat presence windows", () => {
  it("keeps a five-minute online window", () => {
    expect(CHAT_PRESENCE_ONLINE_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});

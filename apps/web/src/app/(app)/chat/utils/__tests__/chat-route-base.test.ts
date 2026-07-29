import { describe, expect, it } from "vitest";

import {
  CHAT_API_PATH,
  CHAT_APP_ROUTE_PREFIX,
  isChatShellPathname,
} from "../chat-route-base";

describe("chat-route-base", () => {
  it("exposes room-keyed BFF path constants", () => {
    expect(CHAT_APP_ROUTE_PREFIX).toBe("/chat");
    expect(CHAT_API_PATH).toBe("/api/chat");
  });

  it("isChatShellPathname recognizes only /chat tree", () => {
    expect(isChatShellPathname("/chat")).toBe(true);
    expect(isChatShellPathname("/chat/rooms/r1")).toBe(true);
    expect(isChatShellPathname("/new-chat")).toBe(false);
    expect(isChatShellPathname("/new-chat/foo")).toBe(false);
    expect(isChatShellPathname(null)).toBe(false);
  });
});

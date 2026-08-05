import { describe, expect, it } from "vitest";

import {
  CHAT_API_PATH,
  CHAT_APP_ROUTE_PREFIX,
  classifyChatChromeSurface,
  isChatChatsPathname,
  isChatRoomPathname,
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
    expect(isChatShellPathname("/chat/chats")).toBe(true);
    expect(isChatShellPathname("/new-chat")).toBe(false);
    expect(isChatShellPathname("/new-chat/foo")).toBe(false);
    expect(isChatShellPathname(null)).toBe(false);
  });

  it("isChatRoomPathname matches /chat/rooms/:roomId", () => {
    expect(isChatRoomPathname("/chat/rooms/r1")).toBe(true);
    expect(isChatRoomPathname("/chat/rooms/r1/extra")).toBe(true);
    expect(isChatRoomPathname("/chat/rooms/")).toBe(false);
    expect(isChatRoomPathname("/chat")).toBe(false);
    expect(isChatRoomPathname("/chat/rooms")).toBe(false);
    expect(isChatRoomPathname("/chat/chats")).toBe(false);
    expect(isChatRoomPathname(null)).toBe(false);
  });

  it("isChatChatsPathname matches /chat/chats exactly", () => {
    expect(isChatChatsPathname("/chat/chats")).toBe(true);
    expect(isChatChatsPathname("/chat/chats/extra")).toBe(false);
    expect(isChatChatsPathname("/chat")).toBe(false);
    expect(isChatChatsPathname(null)).toBe(false);
  });

  describe("classifyChatChromeSurface", () => {
    it("returns room for room pathnames", () => {
      expect(classifyChatChromeSurface("/chat/rooms/abc")).toBe("room");
      expect(classifyChatChromeSurface("/chat/rooms/abc/thread")).toBe("room");
    });

    it("returns chats for /chat/chats", () => {
      expect(classifyChatChromeSurface("/chat/chats")).toBe("chats");
    });

    it("returns home for bare /chat", () => {
      expect(classifyChatChromeSurface("/chat")).toBe("home");
      expect(classifyChatChromeSurface("/chat", new URLSearchParams())).toBe(
        "home",
      );
    });

    it("returns other-chat for draft query on /chat", () => {
      expect(
        classifyChatChromeSurface(
          "/chat",
          new URLSearchParams("create=channel"),
        ),
      ).toBe("other-chat");
      expect(
        classifyChatChromeSurface("/chat", new URLSearchParams("dm=new")),
      ).toBe("other-chat");
      expect(
        classifyChatChromeSurface("/chat", {
          get: (k) => (k === "dm" ? "new" : null),
        }),
      ).toBe("other-chat");
    });

    it("returns other-chat for nested non-room chat and non-chat", () => {
      expect(classifyChatChromeSurface("/chat/something")).toBe("other-chat");
      expect(classifyChatChromeSurface("/tasks")).toBe("other-chat");
      expect(classifyChatChromeSurface(null)).toBe("other-chat");
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  CHAT_API_PATH,
  CHAT_APP_ROUTE_PREFIX,
  CHAT_CHATS_LEGACY_PATH,
  CHAT_CHATS_LIST_PATH,
  CHAT_WELCOME_PATH,
  classifyChatChromeSurface,
  hasChatDraftOrNoticeFromRecord,
  hasChatDraftOrNoticeQuery,
  isChatChatsPathname,
  isChatRoomPathname,
  isChatShellPathname,
  pathWithSearch,
  toURLSearchParamsFromRecord,
} from "../chat-route-base";

describe("chat-route-base", () => {
  it("exposes room-keyed BFF path constants", () => {
    expect(CHAT_APP_ROUTE_PREFIX).toBe("/chat");
    expect(CHAT_API_PATH).toBe("/api/chat");
    expect(CHAT_CHATS_LIST_PATH).toBe("/chat");
    expect(CHAT_CHATS_LEGACY_PATH).toBe("/chat/chats");
    expect(CHAT_WELCOME_PATH).toBe("/");
  });

  it("isChatShellPathname recognizes only /chat tree", () => {
    expect(isChatShellPathname("/chat")).toBe(true);
    expect(isChatShellPathname("/chat/rooms/r1")).toBe(true);
    expect(isChatShellPathname("/chat/chats")).toBe(true);
    expect(isChatShellPathname("/")).toBe(false);
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

  it("isChatChatsPathname matches bare /chat exactly", () => {
    expect(isChatChatsPathname("/chat")).toBe(true);
    expect(isChatChatsPathname("/chat/chats")).toBe(false);
    expect(isChatChatsPathname("/chat/extra")).toBe(false);
    expect(isChatChatsPathname("/")).toBe(false);
    expect(isChatChatsPathname(null)).toBe(false);
  });

  describe("draft/notice redirect helpers", () => {
    it("detects dm=new, create=channel, and notice", () => {
      expect(hasChatDraftOrNoticeQuery(new URLSearchParams("dm=new"))).toBe(
        true,
      );
      expect(
        hasChatDraftOrNoticeQuery(new URLSearchParams("create=channel")),
      ).toBe(true);
      expect(
        hasChatDraftOrNoticeQuery(
          new URLSearchParams("notice=room-unavailable"),
        ),
      ).toBe(true);
      expect(hasChatDraftOrNoticeQuery(new URLSearchParams("notice="))).toBe(
        true,
      );
      expect(hasChatDraftOrNoticeQuery(new URLSearchParams())).toBe(false);
      expect(hasChatDraftOrNoticeQuery(new URLSearchParams("welcome=1"))).toBe(
        false,
      );
      expect(hasChatDraftOrNoticeQuery(new URLSearchParams("dm=other"))).toBe(
        false,
      );
    });

    it("detects draft/notice from Next searchParams records", () => {
      expect(hasChatDraftOrNoticeFromRecord({ dm: "new" })).toBe(true);
      expect(hasChatDraftOrNoticeFromRecord({ create: "channel" })).toBe(true);
      expect(
        hasChatDraftOrNoticeFromRecord({ notice: "room-unavailable" }),
      ).toBe(true);
      expect(hasChatDraftOrNoticeFromRecord({ foo: "bar" })).toBe(false);
      expect(hasChatDraftOrNoticeFromRecord({})).toBe(false);
    });

    it("pathWithSearch preserves query strings", () => {
      expect(pathWithSearch("/chat", new URLSearchParams())).toBe("/chat");
      expect(pathWithSearch("/chat", new URLSearchParams("dm=new"))).toBe(
        "/chat?dm=new",
      );
      expect(
        pathWithSearch(
          "/",
          toURLSearchParamsFromRecord({ notice: "x", a: "1" }),
        ),
      ).toBe("/?notice=x&a=1");
    });
  });

  describe("classifyChatChromeSurface", () => {
    it("returns room for room pathnames", () => {
      expect(classifyChatChromeSurface("/chat/rooms/abc")).toBe("room");
      expect(classifyChatChromeSurface("/chat/rooms/abc/thread")).toBe("room");
    });

    it("returns chats for bare /chat", () => {
      expect(classifyChatChromeSurface("/chat")).toBe("chats");
      expect(classifyChatChromeSurface("/chat", new URLSearchParams())).toBe(
        "chats",
      );
    });

    it("returns home for Welcome at /", () => {
      expect(classifyChatChromeSurface("/")).toBe("home");
      expect(classifyChatChromeSurface("/", new URLSearchParams())).toBe(
        "home",
      );
    });

    it("returns draft for compose query on Welcome or bare /chat", () => {
      expect(
        classifyChatChromeSurface("/", new URLSearchParams("create=channel")),
      ).toBe("draft");
      expect(
        classifyChatChromeSurface("/", new URLSearchParams("dm=new")),
      ).toBe("draft");
      expect(
        classifyChatChromeSurface("/", {
          get: (k) => (k === "dm" ? "new" : null),
        }),
      ).toBe("draft");
      expect(
        classifyChatChromeSurface(
          "/chat",
          new URLSearchParams("create=channel"),
        ),
      ).toBe("draft");
      expect(
        classifyChatChromeSurface("/chat", new URLSearchParams("dm=new")),
      ).toBe("draft");
    });

    it("returns other-chat for nested non-room chat and non-chat", () => {
      expect(classifyChatChromeSurface("/chat/something")).toBe("other-chat");
      expect(classifyChatChromeSurface("/chat/chats")).toBe("other-chat");
      expect(classifyChatChromeSurface("/tasks")).toBe("other-chat");
      expect(classifyChatChromeSurface(null)).toBe("other-chat");
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  CHAT_API_PATH,
  CHAT_APP_ROUTE_PREFIX,
  CHAT_CHATS_LIST_PATH,
  CHAT_WELCOME_PATH,
  classifyChatChromeSurface,
  hasChatNoticeFromRecord,
  hasChatNoticeQuery,
  isChatChatsPathname,
  isChatRoomPathname,
  isChatShellPathname,
  pathWithSearch,
  toURLSearchParamsFromRecord,
} from "./chat-route-base";

describe("chat-route-base", () => {
  it("exposes room-keyed BFF path constants", () => {
    expect(CHAT_APP_ROUTE_PREFIX).toBe("/chat");
    expect(CHAT_API_PATH).toBe("/api/chat");
    expect(CHAT_CHATS_LIST_PATH).toBe("/chat");
    expect(CHAT_WELCOME_PATH).toBe("/");
  });

  it("isChatShellPathname recognizes only /chat tree", () => {
    expect(isChatShellPathname("/chat")).toBe(true);
    expect(isChatShellPathname("/chat/rooms/r1")).toBe(true);
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
    expect(isChatRoomPathname(null)).toBe(false);
  });

  it("isChatChatsPathname matches bare /chat exactly", () => {
    expect(isChatChatsPathname("/chat")).toBe(true);
    expect(isChatChatsPathname("/chat/extra")).toBe(false);
    expect(isChatChatsPathname("/")).toBe(false);
    expect(isChatChatsPathname(null)).toBe(false);
  });

  describe("notice redirect helpers", () => {
    it("detects notice and ignores retired compose queries", () => {
      expect(hasChatNoticeQuery(new URLSearchParams("dm=new"))).toBe(false);
      expect(hasChatNoticeQuery(new URLSearchParams("create=channel"))).toBe(
        false,
      );
      expect(
        hasChatNoticeQuery(new URLSearchParams("notice=room-unavailable")),
      ).toBe(true);
      expect(hasChatNoticeQuery(new URLSearchParams("notice="))).toBe(true);
      expect(hasChatNoticeQuery(new URLSearchParams())).toBe(false);
      expect(hasChatNoticeQuery(new URLSearchParams("welcome=1"))).toBe(false);
    });

    it("detects notice from Next searchParams records", () => {
      expect(hasChatNoticeFromRecord({ dm: "new" })).toBe(false);
      expect(hasChatNoticeFromRecord({ create: "channel" })).toBe(false);
      expect(hasChatNoticeFromRecord({ notice: "room-unavailable" })).toBe(
        true,
      );
      expect(hasChatNoticeFromRecord({ foo: "bar" })).toBe(false);
      expect(hasChatNoticeFromRecord({})).toBe(false);
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

    it("toURLSearchParamsFromRecord appends repeated keys from arrays", () => {
      const qs = toURLSearchParamsFromRecord({ tag: ["a", "b"], solo: "1" });
      expect(qs.getAll("tag")).toEqual(["a", "b"]);
      expect(qs.get("solo")).toBe("1");
      expect(pathWithSearch("/", qs)).toBe("/?tag=a&tag=b&solo=1");
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

    it("ignores retired compose queries on Welcome and bare /chat", () => {
      expect(
        classifyChatChromeSurface("/", new URLSearchParams("create=channel")),
      ).toBe("home");
      expect(
        classifyChatChromeSurface("/", new URLSearchParams("dm=new")),
      ).toBe("home");
      expect(
        classifyChatChromeSurface(
          "/chat",
          new URLSearchParams("create=channel"),
        ),
      ).toBe("chats");
      expect(
        classifyChatChromeSurface("/chat", new URLSearchParams("dm=new")),
      ).toBe("chats");
    });

    it("returns other-chat for nested non-room chat and non-chat", () => {
      expect(classifyChatChromeSurface("/chat/something")).toBe("other-chat");
      expect(classifyChatChromeSurface("/tasks")).toBe("other-chat");
      expect(classifyChatChromeSurface(null)).toBe("other-chat");
    });
  });
});

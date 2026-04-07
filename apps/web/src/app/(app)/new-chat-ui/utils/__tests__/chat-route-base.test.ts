import { describe, expect, it } from "vitest";

import {
  CHAT_APP_ROUTE_PREFIX,
  getBucketSlugFromChatPathname,
  getChatApiPathForRoutePrefix,
  getConversationIdFromChatPathname,
  isChatShellPathname,
  NEW_CHAT_APP_ROUTE_PREFIX,
} from "../chat-route-base";

describe("chat-route-base", () => {
  it("parses bucket and conversation id under /chat", () => {
    expect(
      getBucketSlugFromChatPathname("/chat/claude/x", CHAT_APP_ROUTE_PREFIX),
    ).toBe("claude");
    expect(
      getConversationIdFromChatPathname(
        "/chat/claude/conversation/conv-1",
        CHAT_APP_ROUTE_PREFIX,
      ),
    ).toBe("conv-1");
  });

  it("parses bucket and conversation id under /new-chat", () => {
    expect(
      getBucketSlugFromChatPathname(
        "/new-chat/claude/x",
        NEW_CHAT_APP_ROUTE_PREFIX,
      ),
    ).toBe("claude");
    expect(
      getConversationIdFromChatPathname(
        "/new-chat/claude/conversation/conv-1",
        NEW_CHAT_APP_ROUTE_PREFIX,
      ),
    ).toBe("conv-1");
  });

  it("maps shell to BFF path (legacy vs AI SDK)", () => {
    expect(getChatApiPathForRoutePrefix(CHAT_APP_ROUTE_PREFIX)).toBe(
      "/api/chat",
    );
    expect(getChatApiPathForRoutePrefix(NEW_CHAT_APP_ROUTE_PREFIX)).toBe(
      "/api/new-chat",
    );
  });

  it("isChatShellPathname recognizes /chat and /new-chat trees", () => {
    expect(isChatShellPathname("/chat")).toBe(true);
    expect(isChatShellPathname("/chat/foo")).toBe(true);
    expect(isChatShellPathname("/new-chat")).toBe(true);
    expect(isChatShellPathname("/new-chat/foo")).toBe(true);
    expect(isChatShellPathname("/feed")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  CHAT_API_PATH,
  CHAT_APP_ROUTE_PREFIX,
  getBucketSlugFromChatPathname,
  getConversationIdFromChatPathname,
  getPendingConversationStorageKey,
  isChatShellPathname,
} from "../chat-route-base";

describe("chat-route-base", () => {
  it("parses bucket and conversation id under /chat", () => {
    expect(getBucketSlugFromChatPathname("/chat/claude/x")).toBe("claude");
    expect(
      getConversationIdFromChatPathname("/chat/claude/conversation/conv-1"),
    ).toBe("conv-1");
  });

  it("does not treat /new-chat as the chat shell", () => {
    expect(getBucketSlugFromChatPathname("/new-chat/claude/x")).toBeNull();
    expect(
      getConversationIdFromChatPathname("/new-chat/claude/conversation/conv-1"),
    ).toBeNull();
  });

  it("exposes a single BFF path for the chat UI", () => {
    expect(CHAT_API_PATH).toBe("/api/chat");
  });

  it("isChatShellPathname recognizes only /chat tree", () => {
    expect(isChatShellPathname("/chat")).toBe(true);
    expect(isChatShellPathname("/chat/foo")).toBe(true);
    expect(isChatShellPathname("/new-chat")).toBe(false);
    expect(isChatShellPathname("/new-chat/foo")).toBe(false);
  });

  it("getPendingConversationStorageKey is stable", () => {
    expect(getPendingConversationStorageKey()).toBe(
      "chat-pending-conversation-id",
    );
    expect(CHAT_APP_ROUTE_PREFIX).toBe("/chat");
  });
});

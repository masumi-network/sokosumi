import { describe, expect, it, vi } from "vitest";

import { buildRoomMentionPrompt } from "./chat-room-coworker-dispatch.service";

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/lib/sokosumi-ai-provider", () => ({
  getSokosumiProvider: vi.fn(),
}));

vi.mock("@/routes/v1/chats/stream/coworker-conversation", () => ({
  createCoworkerConversation: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

describe("buildRoomMentionPrompt", () => {
  it("returns the bare mention block when there is no context", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "@hannah what's up?",
      isThreadReply: false,
      contextMessages: [],
    });

    expect(prompt).toBe(
      "Patrick mentioned you in #general:\n\n@hannah what's up?",
    );
  });

  it("prefixes recent messages with a CONTEXT block, oldest first", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "@hannah summarize this",
      isThreadReply: false,
      contextMessages: [
        { senderName: "Andreas", isCoworker: false, content: "First message" },
        { senderName: "Hannah", isCoworker: true, content: "Second\nmessage" },
      ],
    });

    expect(prompt).toBe(
      [
        "CONTEXT (last 2 messages in #general):",
        "- Andreas: First message",
        "- Hannah (AI coworker): Second message",
        "",
        "Patrick mentioned you in #general:",
        "",
        "@hannah summarize this",
      ].join("\n"),
    );
  });

  it("labels thread replies instead of claiming a mention", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "sounds good, go ahead",
      isThreadReply: true,
      contextMessages: [],
    });

    expect(prompt).toBe(
      "Patrick replied to a thread you are part of in #general:\n\nsounds good, go ahead",
    );
  });

  it("truncates oversized context messages", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "@hannah tldr?",
      isThreadReply: false,
      contextMessages: [
        { senderName: "Andreas", isCoworker: false, content: "x".repeat(800) },
      ],
    });

    expect(prompt).toContain(`- Andreas: ${"x".repeat(500)}…`);
    expect(prompt).not.toContain("x".repeat(501));
  });
});

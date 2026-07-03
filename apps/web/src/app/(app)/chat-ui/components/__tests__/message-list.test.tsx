import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { Chat } from "@/app/chat/utils/types";

import MessageList from "../message-list";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: () => "10:00",
  }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/chat/hooks/use-scroll-to-bottom", () => ({
  useScrollToBottom: () => ({
    containerRef: { current: null },
    endRef: { current: null },
    scrollToMax: vi.fn(),
  }),
}));

vi.mock("@/app/chat/components/chat-message", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="chat-message">{content}</div>
  ),
}));

vi.mock("@/app/chat/components/day-separator", () => ({
  default: () => <div data-testid="day-separator" />,
}));

vi.mock("@/components/chat/chat-model-icon", () => ({
  ChatModelIcon: ({ modelName }: { modelName: string }) => (
    <span>{modelName}</span>
  ),
}));

describe("MessageList", () => {
  it("shows streaming thought summary on the assistant row for model chats when live reasoning arrives before assistant content", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Create an image" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [],
      },
    ] satisfies UIMessage[];
    const chats = [
      {
        id: "conversation-1",
        title: "GPT-5.4",
        createdAt: new Date("2026-05-05T09:00:00.000Z"),
        updatedAt: new Date("2026-05-05T09:00:00.000Z"),
        status: "active",
        model: { id: "gpt-5-4", name: "GPT-5.4" },
      },
    ] satisfies Chat[];

    render(
      <MessageList
        chats={chats}
        isCoworker={false}
        isLoading={true}
        messages={messages}
        reasoningMessages={[
          { id: "reasoning-1", message: "Planning image generation" },
        ]}
        selectedChatId="conversation-1"
        userImageUrl=""
      />,
    );

    expect(screen.getByText("reasoning.expandSteps")).toBeInTheDocument();
    expect(screen.queryByText("reasoning.processing")).toBeNull();
  });

  it("shows a day separator when a dated message follows an undated one on a new calendar day", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hi" }],
        createdAt: new Date("2026-05-10T10:00:00.000Z"),
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Undated reply" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Next calendar day" }],
        createdAt: new Date("2026-05-11T10:00:00.000Z"),
      },
    ] as UIMessage[];
    const chats = [
      {
        id: "conversation-1",
        title: "Test",
        createdAt: new Date("2026-05-10T09:00:00.000Z"),
        updatedAt: new Date("2026-05-10T09:00:00.000Z"),
        status: "active",
        model: { id: "gpt-5", name: "GPT" },
      },
    ] satisfies Chat[];

    render(
      <MessageList
        chats={chats}
        isCoworker={false}
        isLoading={false}
        messages={messages}
        selectedChatId="conversation-1"
        userImageUrl=""
      />,
    );

    expect(screen.getAllByTestId("day-separator")).toHaveLength(2);
  });

  it("shows warmup notice and suppresses pending error when warmupPending", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [],
      },
    ] satisfies UIMessage[];
    const chats = [
      {
        id: "conversation-1",
        title: "Elena",
        createdAt: new Date("2026-05-10T09:00:00.000Z"),
        updatedAt: new Date("2026-05-10T09:00:00.000Z"),
        status: "active",
        coworker: { id: "coworker-1", name: "Elena", slug: "elena" },
      },
    ] satisfies Chat[];

    render(
      <MessageList
        chats={chats}
        conversationCoworkerFallback={{
          id: "coworker-1",
          name: "Elena",
        }}
        isCoworker={true}
        isLoading={false}
        messages={messages}
        selectedChatId="conversation-1"
        userImageUrl=""
        warmupPending={true}
        warmupCoworkerName="Elena"
      />,
    );

    expect(screen.getByText("coworkerWarmingUp")).toBeInTheDocument();
    expect(screen.queryByText("pendingResponseFailed")).toBeNull();
  });
});

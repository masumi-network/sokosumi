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
});

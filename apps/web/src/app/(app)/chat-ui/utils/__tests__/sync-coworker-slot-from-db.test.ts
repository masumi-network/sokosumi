import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { fetchConversationUiMessages } from "@/app/chat-ui/utils/fetch-conversation-ui-messages";
import {
  cancelCoworkerDbSync,
  hasGoodCoworkerAssistantTail,
  isStaleCoworkerAssistantTail,
  shouldKeepPollingCoworkerDbSync,
  shouldRejectCoworkerMessageRegression,
  syncCoworkerSlotFromDbWithRetry,
} from "@/app/chat-ui/utils/sync-coworker-slot-from-db";

vi.mock("@/app/chat-ui/utils/fetch-conversation-ui-messages", () => ({
  fetchConversationUiMessages: vi.fn(),
}));

describe("isStaleCoworkerAssistantTail", () => {
  it("returns true for empty assistant tails", () => {
    expect(
      isStaleCoworkerAssistantTail([
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "" }] },
      ]),
    ).toBe(true);
  });

  it("returns true for Elena agent error text", () => {
    expect(
      isStaleCoworkerAssistantTail([
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Something went wrong while processing your task. Please try again.",
            },
          ],
        },
      ]),
    ).toBe(true);
  });
});

describe("hasGoodCoworkerAssistantTail", () => {
  it("returns true for non-error assistant text", () => {
    expect(
      hasGoodCoworkerAssistantTail([
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Task created with enough content to display.",
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("returns false for suspiciously short assistant text", () => {
    expect(
      hasGoodCoworkerAssistantTail([
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "Done" }],
        },
      ]),
    ).toBe(false);
  });
});

describe("shouldRejectCoworkerMessageRegression", () => {
  it("rejects replacing a good assistant tail with an agent error", () => {
    const prev = [
      {
        id: "a1",
        role: "assistant" as const,
        parts: [{ type: "text", text: "Task created with enough detail." }],
      },
    ] as UIMessage[];
    const next = [
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          {
            type: "text",
            text: "Something went wrong while processing your task.",
          },
        ],
      },
    ] as UIMessage[];
    expect(shouldRejectCoworkerMessageRegression(prev, next)).toBe(true);
  });

  it("allows replacing a suspicious short tail with good db content", () => {
    const prev = [
      {
        id: "a1",
        role: "assistant" as const,
        parts: [{ type: "text", text: "Done" }],
      },
    ] as UIMessage[];
    const next = [
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          {
            type: "text",
            text: "Task created with enough detail to show in the chat bubble.",
          },
        ],
      },
    ] as UIMessage[];
    expect(shouldRejectCoworkerMessageRegression(prev, next)).toBe(false);
  });

  it("allows recovery when message count drops but db tail is good", () => {
    const prev = [
      ...Array.from({ length: 75 }, (_, index) => ({
        id: `m-${index}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "msg" }],
      })),
      {
        id: "a-bad",
        role: "assistant" as const,
        parts: [{ type: "text", text: "Done" }],
      },
    ] as UIMessage[];
    const next = [
      ...Array.from({ length: 69 }, (_, index) => ({
        id: `db-${index}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "db" }],
      })),
      {
        id: "a-good",
        role: "assistant" as const,
        parts: [
          {
            type: "text",
            text: "Task created with enough detail to show in the chat bubble.",
          },
        ],
      },
    ] as UIMessage[];
    expect(shouldRejectCoworkerMessageRegression(prev, next)).toBe(false);
  });
});

describe("syncCoworkerSlotFromDbWithRetry", () => {
  it("cancels an in-flight sync when a newer sync starts", async () => {
    vi.mocked(fetchConversationUiMessages).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  id: "a1",
                  role: "assistant",
                  parts: [{ type: "text", text: "late" }],
                },
              ] as UIMessage[]),
            50,
          );
        }),
    );

    const first = syncCoworkerSlotFromDbWithRetry({
      conversationId: "conv-cancel",
      slotMessages: [],
      onApply: vi.fn(),
      timeoutMs: 5_000,
    });
    cancelCoworkerDbSync("conv-cancel");
    const second = syncCoworkerSlotFromDbWithRetry({
      conversationId: "conv-cancel",
      slotMessages: [],
      onApply: vi.fn(),
      timeoutMs: 100,
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.cancelled).toBe(true);
    expect(secondResult.cancelled).not.toBe(true);
  });

  it("keeps polling until db has a good assistant tail", async () => {
    vi.mocked(fetchConversationUiMessages)
      .mockResolvedValueOnce([
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Something went wrong while processing your task.",
            },
          ],
        },
      ] as UIMessage[])
      .mockResolvedValueOnce([
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "I've created a task for you." }],
        },
      ] as UIMessage[]);

    const slotMessages = [
      {
        id: "u1",
        role: "user" as const,
        parts: [{ type: "text", text: "hello" }],
      },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: "Something went wrong while processing your task.",
          },
        ],
      },
    ] as UIMessage[];

    const onApply = vi.fn();
    const result = await syncCoworkerSlotFromDbWithRetry({
      conversationId: "conv-1",
      slotMessages,
      onApply,
      timeoutMs: 5_000,
    });

    expect(result.applied).toBe(true);
    expect(result.attempts).toBe(2);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]?.[1]).toMatchObject({
      parts: [{ type: "text", text: "I've created a task for you." }],
    });
  });
});

describe("shouldKeepPollingCoworkerDbSync", () => {
  it("returns true when db has not persisted the assistant yet", () => {
    const slot = [
      {
        id: "u1",
        role: "user" as const,
        parts: [{ type: "text", text: "hi" }],
      },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [{ type: "text", text: "" }],
      },
    ] as UIMessage[];
    const db = [
      {
        id: "u1",
        role: "user" as const,
        parts: [{ type: "text", text: "hi" }],
      },
    ] as UIMessage[];
    expect(shouldKeepPollingCoworkerDbSync(slot, db)).toBe(true);
  });
});

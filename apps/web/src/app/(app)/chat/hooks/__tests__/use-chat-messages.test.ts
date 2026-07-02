import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationWithMessages } from "@/lib/actions/conversation/core-api-actions";

const getConversationMessagesMock = vi.fn();

vi.mock("@/lib/actions/conversation/core-api-actions", () => ({
  getConversationMessages: (...args: unknown[]) =>
    getConversationMessagesMock(...args),
}));

import { useChatMessages } from "@/app/chat/hooks/use-chat-messages";

const CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";

function createSelectedConversation(
  messages: ConversationWithMessages["messages"],
): ConversationWithMessages {
  return {
    id: CONVERSATION_ID,
    userId: "user-1",
    title: "Chat",
    metadata: null,
    createdAt: "2026-05-11T10:00:00.000Z",
    updatedAt: "2026-05-11T10:00:00.000Z",
    messages,
  };
}

describe("useChatMessages", () => {
  beforeEach(() => {
    getConversationMessagesMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches database messages when the selected conversation has an empty messages array", async () => {
    getConversationMessagesMock.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: 1,
          },
        ],
        pagination: null,
      },
    });
    const setMessagesForConversation = vi.fn();
    const previousChatIdRef = { current: null };
    const messagesChatIdRef = { current: null };
    const chatMessagesRef = { current: new Map<string, unknown[]>() };

    renderHook(() =>
      useChatMessages({
        selectedChatId: CONVERSATION_ID,
        selectedConversation: createSelectedConversation([]),
        setMessagesForConversation,
        previousChatIdRef,
        messagesChatIdRef,
        chatMessagesRef,
      }),
    );

    await waitFor(() => {
      expect(getConversationMessagesMock).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        limit: 100,
      });
    });
    await waitFor(() => {
      expect(setMessagesForConversation).toHaveBeenLastCalledWith(
        CONVERSATION_ID,
        [
          expect.objectContaining({
            id: "msg-1",
            role: "user",
            content: "Hello",
          }),
        ],
      );
    });
    expect(messagesChatIdRef.current).toBe(CONVERSATION_ID);
    expect(chatMessagesRef.current.get(CONVERSATION_ID)).toHaveLength(1);
  });

  it("refreshes database messages when selected conversation messages are stale", async () => {
    getConversationMessagesMock.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: 1,
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "Fresh answer",
            createdAt: 2,
          },
        ],
        pagination: null,
      },
    });
    const setMessagesForConversation = vi.fn();
    const previousChatIdRef = { current: null };
    const messagesChatIdRef = { current: null };
    const chatMessagesRef = { current: new Map<string, unknown[]>() };

    renderHook(() =>
      useChatMessages({
        selectedChatId: CONVERSATION_ID,
        selectedConversation: createSelectedConversation([
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: 1,
          },
        ]),
        setMessagesForConversation,
        previousChatIdRef,
        messagesChatIdRef,
        chatMessagesRef,
      }),
    );

    await waitFor(() => {
      expect(getConversationMessagesMock).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        limit: 100,
      });
    });
    await waitFor(() => {
      expect(setMessagesForConversation).toHaveBeenLastCalledWith(
        CONVERSATION_ID,
        [
          expect.objectContaining({
            id: "msg-1",
            content: "Hello",
          }),
          expect.objectContaining({
            id: "msg-2",
            content: "Fresh answer",
          }),
        ],
      );
    });
  });

  it("retries once when the refreshed database messages still end with a user message", async () => {
    vi.useFakeTimers();
    getConversationMessagesMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Hello",
              createdAt: 1,
            },
          ],
          pagination: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Hello",
              createdAt: 1,
            },
            {
              id: "msg-2",
              role: "assistant",
              content: "Fresh answer",
              createdAt: 2,
            },
          ],
          pagination: null,
        },
      });
    const setMessagesForConversation = vi.fn();
    const previousChatIdRef = { current: null };
    const messagesChatIdRef = { current: null };
    const chatMessagesRef = { current: new Map<string, unknown[]>() };

    renderHook(() =>
      useChatMessages({
        selectedChatId: CONVERSATION_ID,
        selectedConversation: createSelectedConversation([]),
        setMessagesForConversation,
        previousChatIdRef,
        messagesChatIdRef,
        chatMessagesRef,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getConversationMessagesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(getConversationMessagesMock).toHaveBeenCalledTimes(2);
    expect(setMessagesForConversation).toHaveBeenLastCalledWith(
      CONVERSATION_ID,
      [
        expect.objectContaining({
          id: "msg-1",
          content: "Hello",
        }),
        expect.objectContaining({
          id: "msg-2",
          content: "Fresh answer",
        }),
      ],
    );
  });

  it("refreshes database messages when cached messages exist for a re-selected conversation", async () => {
    getConversationMessagesMock.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: 1,
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "Fresh answer",
            createdAt: 2,
          },
        ],
        pagination: null,
      },
    });
    const setMessagesForConversation = vi.fn();
    const previousChatIdRef = { current: null };
    const messagesChatIdRef = { current: null };
    const chatMessagesRef = {
      current: new Map<string, unknown[]>([
        [
          CONVERSATION_ID,
          [
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ],
        ],
      ]),
    };

    renderHook(() =>
      useChatMessages({
        selectedChatId: CONVERSATION_ID,
        selectedConversation: null,
        setMessagesForConversation,
        previousChatIdRef,
        messagesChatIdRef,
        chatMessagesRef,
      }),
    );

    await waitFor(() => {
      expect(getConversationMessagesMock).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        limit: 100,
      });
    });
    await waitFor(() => {
      expect(setMessagesForConversation).toHaveBeenLastCalledWith(
        CONVERSATION_ID,
        [
          expect.objectContaining({
            id: "msg-1",
            content: "Hello",
          }),
          expect.objectContaining({
            id: "msg-2",
            content: "Fresh answer",
          }),
        ],
      );
    });
  });

  it("loads database messages after welcome creation flags clear", async () => {
    vi.useFakeTimers();
    getConversationMessagesMock.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            createdAt: 1,
          },
        ],
        pagination: null,
      },
    });
    const setMessagesForConversation = vi.fn();
    const previousChatIdRef = { current: null };
    const messagesChatIdRef = { current: null };
    const chatMessagesRef = { current: new Map<string, unknown[]>() };
    const welcomeCreationInFlightRef = { current: true };

    renderHook(() =>
      useChatMessages({
        selectedChatId: CONVERSATION_ID,
        selectedConversation: null,
        setMessagesForConversation,
        previousChatIdRef,
        messagesChatIdRef,
        chatMessagesRef,
        welcomeCreationInFlightRef,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getConversationMessagesMock).not.toHaveBeenCalled();

    welcomeCreationInFlightRef.current = false;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(getConversationMessagesMock).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      limit: 100,
    });
  });
});

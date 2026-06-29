import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getConversationMessagesMock = vi.fn();

vi.mock("@/lib/actions/conversation/core-api-actions", () => ({
  getConversationMessages: (...args: unknown[]) =>
    getConversationMessagesMock(...args),
}));

import { useCoworkerPostRefreshAssistantPoll } from "@/app/chat/hooks/use-coworker-post-refresh-assistant-poll";

const CONV_ID = "550e8400-e29b-41d4-a716-446655440000";

const userMessage: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

const displayedMessagesFixture: UIMessage[] = [userMessage];

const pendingMetadataFixture = {
  pending_responses_api_response_id: "resp_pending",
};

function userOnlyMessagesResponse() {
  return {
    ok: true as const,
    data: {
      messages: [
        {
          id: "u1",
          role: "user",
          content: [{ type: "text", text: "hello" }],
          createdAt: 1,
        },
      ],
    },
  };
}

function userAndAssistantMessagesResponse() {
  return {
    ok: true as const,
    data: {
      messages: [
        {
          id: "u1",
          role: "user",
          content: [{ type: "text", text: "hello" }],
          createdAt: 1,
        },
        {
          id: "a1",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "This is a complete coworker reply with enough text.",
            },
          ],
          createdAt: 2,
        },
      ],
    },
  };
}

describe("useCoworkerPostRefreshAssistantPoll", () => {
  beforeEach(() => {
    getConversationMessagesMock.mockReset();
    delete (globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number })
      .__SOKOSUMI_TEST_POLL_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number })
      .__SOKOSUMI_TEST_POLL_TIMEOUT_MS;
  });

  it("does not poll while chat is streaming", () => {
    vi.useFakeTimers();
    const messagesChatIdRef = { current: CONV_ID };
    renderHook(() =>
      useCoworkerPostRefreshAssistantPoll({
        conversationId: CONV_ID,
        isCoworkerThread: true,
        isChatStreaming: true,
        conversationMetadata: pendingMetadataFixture,
        messagesChatIdRef,
        displayedMessages: displayedMessagesFixture,
        setMessagesForConversation: vi.fn(),
        refreshConversations: vi.fn(),
      }),
    );

    expect(getConversationMessagesMock).not.toHaveBeenCalled();
  });

  it("fetches messages and stops when an assistant turn appears", async () => {
    getConversationMessagesMock.mockResolvedValue(
      userAndAssistantMessagesResponse(),
    );
    const setMessages = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const messagesChatIdRef = { current: CONV_ID };

    renderHook(() =>
      useCoworkerPostRefreshAssistantPoll({
        conversationId: CONV_ID,
        isCoworkerThread: true,
        isChatStreaming: false,
        conversationMetadata: pendingMetadataFixture,
        messagesChatIdRef,
        displayedMessages: displayedMessagesFixture,
        setMessagesForConversation: setMessages,
        refreshConversations: refresh,
      }),
    );

    await waitFor(() => {
      expect(getConversationMessagesMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("sets failed after overall timeout when assistant never appears", async () => {
    (
      globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number }
    ).__SOKOSUMI_TEST_POLL_TIMEOUT_MS = 250;
    getConversationMessagesMock.mockResolvedValue(userOnlyMessagesResponse());
    const messagesChatIdRef = { current: CONV_ID };
    const setMessagesForConversation = vi.fn();
    const refreshConversations = vi.fn();

    const { result } = renderHook(() =>
      useCoworkerPostRefreshAssistantPoll({
        conversationId: CONV_ID,
        isCoworkerThread: true,
        isChatStreaming: false,
        conversationMetadata: pendingMetadataFixture,
        messagesChatIdRef,
        displayedMessages: displayedMessagesFixture,
        setMessagesForConversation,
        refreshConversations,
      }),
    );

    await waitFor(() => {
      expect(getConversationMessagesMock).toHaveBeenCalled();
    });
    await waitFor(
      () => {
        expect(result.current.userTailRecoveryFailed).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(result.current.userTailRecoveryLoading).toBe(false);
    expect(
      getConversationMessagesMock.mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not throw when unmounted mid-poll", async () => {
    vi.useFakeTimers();
    getConversationMessagesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(userOnlyMessagesResponse()), 50);
        }),
    );
    const messagesChatIdRef = { current: CONV_ID };
    const setMessagesForConversation = vi.fn();
    const refreshConversations = vi.fn();

    const { unmount } = renderHook(() =>
      useCoworkerPostRefreshAssistantPoll({
        conversationId: CONV_ID,
        isCoworkerThread: true,
        isChatStreaming: false,
        conversationMetadata: pendingMetadataFixture,
        messagesChatIdRef,
        displayedMessages: displayedMessagesFixture,
        setMessagesForConversation,
        refreshConversations,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  });
});

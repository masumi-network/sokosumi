import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getConversationWarmupMock = vi.fn();

vi.mock("@/lib/actions/conversation/core-api-actions", () => ({
  getConversationWarmup: (...args: unknown[]) =>
    getConversationWarmupMock(...args),
}));

import { useConversationWarmup } from "@/app/chat/hooks/use-conversation-warmup";

const CONV_ID = "550e8400-e29b-41d4-a716-446655440000";

function pendingWarmupResponse() {
  return {
    ok: true as const,
    data: {
      state: "pending" as const,
      completedAt: null,
      attempts: 1,
      source: "redis" as const,
    },
  };
}

function readyWarmupResponse() {
  return {
    ok: true as const,
    data: {
      state: "ready" as const,
      completedAt: "2026-07-03T12:00:00.000Z",
      attempts: 2,
      source: "redis" as const,
    },
  };
}

function failedWarmupResponse() {
  return {
    ok: true as const,
    data: {
      state: "failed" as const,
      completedAt: "2026-07-03T12:00:00.000Z",
      attempts: 3,
      source: "metadata" as const,
    },
  };
}

describe("useConversationWarmup", () => {
  beforeEach(() => {
    getConversationWarmupMock.mockReset();
    delete (globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number })
      .__SOKOSUMI_TEST_POLL_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number })
      .__SOKOSUMI_TEST_POLL_TIMEOUT_MS;
  });

  it("does not poll when disabled", () => {
    renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: false,
      }),
    );

    expect(getConversationWarmupMock).not.toHaveBeenCalled();
  });

  it("sets warmupPending while state is pending", async () => {
    getConversationWarmupMock.mockResolvedValue(pendingWarmupResponse());

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(getConversationWarmupMock).toHaveBeenCalledWith({
        conversationId: CONV_ID,
      });
    });
    await waitFor(() => {
      expect(result.current.warmupPending).toBe(true);
      expect(result.current.warmupFailed).toBe(false);
      expect(result.current.warmupState).toBe("pending");
    });
  });

  it("clears pending when state becomes ready", async () => {
    getConversationWarmupMock.mockResolvedValue(readyWarmupResponse());

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.warmupPending).toBe(false);
      expect(result.current.warmupFailed).toBe(false);
      expect(result.current.warmupState).toBe("ready");
    });
  });

  it("clears pending when state is failed", async () => {
    getConversationWarmupMock.mockResolvedValue(failedWarmupResponse());

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.warmupPending).toBe(false);
      expect(result.current.warmupFailed).toBe(true);
      expect(result.current.warmupState).toBe("failed");
    });
  });

  it("polls pending state every two seconds", async () => {
    vi.useFakeTimers();
    getConversationWarmupMock.mockResolvedValue(pendingWarmupResponse());

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.warmupPending).toBe(true);
    expect(getConversationWarmupMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(getConversationWarmupMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getConversationWarmupMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(getConversationWarmupMock).toHaveBeenCalledTimes(3);
  });

  it("clears pending after timeout while still pending", async () => {
    vi.useFakeTimers();
    (
      globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number }
    ).__SOKOSUMI_TEST_POLL_TIMEOUT_MS = 250;
    getConversationWarmupMock.mockResolvedValue(pendingWarmupResponse());

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getConversationWarmupMock).toHaveBeenCalledTimes(1);
    expect(result.current.warmupPending).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(result.current.warmupPending).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.warmupPending).toBe(false);
    expect(result.current.warmupFailed).toBe(true);
  });

  it("does not block on fetch error", async () => {
    getConversationWarmupMock.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(getConversationWarmupMock).toHaveBeenCalled();
    });
    expect(result.current.warmupPending).toBe(false);
    expect(result.current.warmupFailed).toBe(false);
  });

  it("does not block on action error result", async () => {
    getConversationWarmupMock.mockResolvedValue({
      ok: false,
      error: { message: "unauthorized", code: "BAD_INPUT" },
    });

    const { result } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(getConversationWarmupMock).toHaveBeenCalled();
    });
    expect(result.current.warmupPending).toBe(false);
    expect(result.current.warmupFailed).toBe(false);
  });

  it("does not throw when unmounted mid-poll", async () => {
    vi.useFakeTimers();
    getConversationWarmupMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(pendingWarmupResponse()), 50);
        }),
    );

    const { unmount } = renderHook(() =>
      useConversationWarmup({
        conversationId: CONV_ID,
        enabled: true,
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

import { AVATAR_DONE_MS } from "@sokosumi/soko-bot";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatBot,
  ChatTurn,
  SokoBotChatState,
} from "@/lib/soko-bot/chat-state";
import { useChatAvatarState } from "./avatar-state";

function completedChat(
  completedAt: string,
  bot: Partial<ChatBot> = {},
): SokoBotChatState {
  return {
    bot: { status: "IDLE", pendingDecisions: [], ...bot } as ChatBot,
    turns: [{ status: "COMPLETED", completedAt } as ChatTurn],
  };
}

describe("useChatAvatarState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("celebrates a newly completed turn and returns to idle after AVATAR_DONE_MS", () => {
    const state = completedChat(new Date(Date.now()).toISOString());
    const { result, unmount } = renderHook(
      ({ value }: { value: SokoBotChatState }) => useChatAvatarState(value),
      { initialProps: { value: state } },
    );

    expect(result.current).toBe("done");

    act(() => {
      vi.advanceTimersByTime(AVATAR_DONE_MS - 100);
    });
    expect(result.current).toBe("done");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("idle");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts the celebration timer when a newer completed turn arrives", () => {
    const first = completedChat(new Date(Date.now()).toISOString());
    const { result, rerender } = renderHook(
      ({ value }: { value: SokoBotChatState }) => useChatAvatarState(value),
      { initialProps: { value: first } },
    );

    act(() => {
      vi.advanceTimersByTime(AVATAR_DONE_MS - 500);
    });
    expect(result.current).toBe("done");

    const newer = completedChat(new Date(Date.now()).toISOString());
    rerender({ value: newer });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe("done");

    act(() => {
      vi.advanceTimersByTime(AVATAR_DONE_MS);
    });
    expect(result.current).toBe("idle");
  });
});

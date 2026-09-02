import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
import { useSokoBotState } from "../use-soko-bot-state";

function state(
  botStatus: SokoBotChatState["bot"]["status"],
  turns: SokoBotChatState["turns"] = [],
): SokoBotChatState {
  return {
    bot: { status: botStatus } as SokoBotChatState["bot"],
    turns,
  };
}

describe("useSokoBotState polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ state: null }) })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls fast while the bot is working, even with no turn in the list yet", async () => {
    // Conversation happens in the chat rooms, so the console watches turns it
    // did not start. Waiting for one to appear in the list before speeding up
    // means a short turn is only ever seen after it finished.
    renderHook(() => useSokoBotState(state("RUNNING")));

    await vi.advanceTimersByTimeAsync(2_600);

    expect(fetch).toHaveBeenCalled();
  });

  it("does not poll fast when the bot is idle and nothing is running", async () => {
    renderHook(() => useSokoBotState(state("IDLE")));

    await vi.advanceTimersByTimeAsync(2_600);
    expect(fetch).not.toHaveBeenCalled();

    // The heartbeat still has to be quick enough to catch a turn that starts
    // and finishes between two ticks.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(fetch).toHaveBeenCalled();
  });
});

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
import { useSokoBotState } from "../use-soko-bot-state";

const TURN_ID = "00000000-0000-4000-8000-000000000001";
const IDLE = { status: "IDLE", activeTurnId: null, lastTurnAt: "t0" };
const RUNNING = { status: "RUNNING", activeTurnId: TURN_ID, lastTurnAt: "t1" };
const SETTLED = { status: "IDLE", activeTurnId: null, lastTurnAt: "t1" };

function chatState(turnStatus: string): SokoBotChatState {
  return {
    bot: { status: "IDLE" } as SokoBotChatState["bot"],
    turns: [
      { id: TURN_ID, status: turnStatus } as SokoBotChatState["turns"][number],
    ],
  };
}

function emptyState(): SokoBotChatState {
  return { bot: { status: "IDLE" } as SokoBotChatState["bot"], turns: [] };
}

/**
 * Activity answers are read in sequence, so a test can walk a turn through
 * idle → running → settled the way a real poll would see it.
 */
function mockEndpoints(options: {
  activity: unknown[];
  state?: () => unknown;
  stateDelayMs?: number;
}) {
  let index = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/activity")) {
      const activity =
        options.activity[Math.min(index, options.activity.length - 1)];
      index += 1;
      return { ok: true, json: async () => ({ activity }) };
    }
    if (options.stateDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.stateDelayMs));
    }
    return {
      ok: true,
      json: async () => ({ state: options.state?.() ?? emptyState() }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function countOf(fetchMock: ReturnType<typeof mockEndpoints>, part: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(part))
    .length;
}

describe("useSokoBotState polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("surfaces a turn while it is still running", async () => {
    // The console watches turns started elsewhere. Seeing one only after it
    // settles is the reported bug: the answer appears, the orb never does.
    const fetchMock = mockEndpoints({
      activity: [IDLE, RUNNING, RUNNING, SETTLED],
      state: () => chatState("RUNNING"),
    });
    const { result } = renderHook(() => useSokoBotState(emptyState()));

    await vi.advanceTimersByTimeAsync(5_100);

    expect(countOf(fetchMock, "/activity")).toBeGreaterThanOrEqual(2);
    expect(result.current.state.turns[0]?.status).toBe("RUNNING");
  });

  it("fetches once more when a turn settles, even though nothing is active", async () => {
    // lastTurnAt still moved, so the changed signature has to pull the answer
    // in. Drop it from the signature and this test fails.
    const fetchMock = mockEndpoints({
      activity: [IDLE, SETTLED, SETTLED],
      state: () => chatState("COMPLETED"),
    });
    renderHook(() => useSokoBotState(emptyState()));

    await vi.advanceTimersByTimeAsync(5_100);

    // Once on mount to establish the signature, once when lastTurnAt changed.
    expect(countOf(fetchMock, "/state")).toBe(2);
  });

  it("leaves the heavy state alone while nothing moves", async () => {
    const fetchMock = mockEndpoints({ activity: [IDLE] });
    renderHook(() => useSokoBotState(emptyState()));

    await vi.advanceTimersByTimeAsync(12_600);

    expect(countOf(fetchMock, "/activity")).toBeGreaterThanOrEqual(5);
    expect(countOf(fetchMock, "/state")).toBe(1);
  });

  it("does not let a slow state read starve itself", async () => {
    // Cancelling the previous read meant that when /state ran longer than one
    // probe interval, every response during the turn was aborted and only the
    // one after it settled ever arrived — the original symptom, restored.
    const fetchMock = mockEndpoints({
      activity: [RUNNING],
      state: () => chatState("RUNNING"),
      stateDelayMs: 6_000,
    });
    const { result } = renderHook(() => useSokoBotState(emptyState()));

    // Stepped, so the delayed read's own timer is reached and its resolution
    // is flushed before the assertion.
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.advanceTimersByTimeAsync(8_100);

    // Overlapping ticks are skipped, not cancelled, so reads complete.
    expect(result.current.state.turns[0]?.status).toBe("RUNNING");
    expect(countOf(fetchMock, "/state")).toBeLessThan(
      countOf(fetchMock, "/activity"),
    );
  });
});

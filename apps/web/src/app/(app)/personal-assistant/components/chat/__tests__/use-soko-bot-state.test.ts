import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
import { useSokoBotState } from "../use-soko-bot-state";

const IDLE = { status: "IDLE", activeTurnId: null, lastTurnAt: "t0" };
const RUNNING = {
  status: "RUNNING",
  activeTurnId: "00000000-0000-4000-8000-000000000001",
  lastTurnAt: "t0",
};

function emptyState(): SokoBotChatState {
  return { bot: { status: "IDLE" } as SokoBotChatState["bot"], turns: [] };
}

function mockEndpoints(activity: unknown) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("/activity")
        ? { activity }
        : { state: { bot: { status: "IDLE" }, turns: [] } },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof mockEndpoints>, part: string) {
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

  it("keeps refetching state while a turn is running", async () => {
    // The console watches turns started elsewhere. It has to notice one while
    // it is still going, or the orb and its steps never render at all.
    const fetchMock = mockEndpoints(RUNNING);
    renderHook(() => useSokoBotState(emptyState()));

    await vi.advanceTimersByTimeAsync(7_600);

    expect(calls(fetchMock, "/activity")).toBeGreaterThanOrEqual(3);
    expect(calls(fetchMock, "/state")).toBeGreaterThanOrEqual(3);
  });

  it("probes cheaply and leaves the heavy state alone while nothing moves", async () => {
    // The full state loads the bot plus twenty turns with their events and
    // decisions, so an idle tab must not ask for it every couple of seconds.
    const fetchMock = mockEndpoints(IDLE);
    renderHook(() => useSokoBotState(emptyState()));

    await vi.advanceTimersByTimeAsync(12_600);

    expect(calls(fetchMock, "/activity")).toBeGreaterThanOrEqual(4);
    // One fetch when the first probe establishes the signature, none after.
    expect(calls(fetchMock, "/state")).toBe(1);
  });
});

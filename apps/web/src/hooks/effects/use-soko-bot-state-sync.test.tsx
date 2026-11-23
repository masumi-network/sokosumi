import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSokoBotStateSync } from "@/hooks/effects/use-soko-bot-state-sync";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

function makeState(
  botStatus: SokoBotChatState["bot"]["status"],
  turnIds: string[] = [],
): SokoBotChatState {
  return {
    bot: { status: botStatus } as SokoBotChatState["bot"],
    turns: turnIds.map(
      (id) =>
        ({
          id,
          status: "RUNNING",
        }) as SokoBotChatState["turns"][number],
    ),
  };
}

describe("useSokoBotStateSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("syncs local state when a new initial snapshot arrives", () => {
    const first = makeState("IDLE", ["turn-1"]);
    const second = makeState("RUNNING", ["turn-1", "turn-2"]);

    const { result, rerender } = renderHook(
      ({ initial }: { initial: SokoBotChatState }) =>
        useSokoBotStateSync(initial, "/api/personal-assistant/state"),
      { initialProps: { initial: first } },
    );

    expect(result.current.state).toBe(first);

    rerender({ initial: second });

    expect(result.current.state).toBe(second);
  });

  it("fetches stateEndpoint on refresh and coalesces overlapping calls into one follow-up read", async () => {
    let resolveFirst!: (value: unknown) => void;
    const updated1 = makeState("RUNNING", ["turn-1"]);
    const updated2 = makeState("IDLE", ["turn-1", "turn-2"]);

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: updated2 }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const initial = makeState("IDLE");
    const { result } = renderHook(() =>
      useSokoBotStateSync(initial, "/api/personal-assistant/state?botId=bot-1"),
    );

    let firstRefresh!: Promise<void>;
    act(() => {
      firstRefresh = result.current.refresh();
      void result.current.refresh();
      void result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/personal-assistant/state?botId=bot-1",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );

    await act(async () => {
      resolveFirst({ ok: true, json: async () => ({ state: updated1 }) });
      await firstRefresh;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual(updated2);
  });

  it("aborts a stalled state read after the 15s deadline so later refreshes can run", async () => {
    const recovered = makeState("IDLE", ["turn-recovered"]);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: recovered }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const initial = makeState("IDLE");
    const { result } = renderHook(() =>
      useSokoBotStateSync(initial, "/api/personal-assistant/state"),
    );

    let stalled!: Promise<void>;
    act(() => {
      stalled = result.current.refresh();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await stalled;
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual(recovered);
  });
});

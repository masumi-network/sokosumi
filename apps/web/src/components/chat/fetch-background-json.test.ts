import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";

import { fetchBackgroundJson } from "./fetch-background-json";
import { useChatRefreshScheduler } from "./use-chat-refresh-scheduler";

const TIMEOUT_MS = 20_000;

function response(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe("fetchBackgroundJson", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Mid-range jitter is the nominal delay, so the timings below read as the
    // constants they pin. The spread itself is covered separately.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    resetChatReadThrottleForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetChatReadThrottleForTests();
  });

  it("returns the payload on the first success", async () => {
    fetchMock.mockResolvedValue(response(200, { data: ["room-1"] }));

    await expect(
      fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS),
    ).resolves.toEqual({ data: ["room-1"] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a 503 after 1s and returns the retried payload", async () => {
    fetchMock
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, { data: ["room-1"] }));

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toEqual({ data: ["room-1"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after two spaced retries of a 503", async () => {
    fetchMock.mockResolvedValue(response(503));

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 400, 502])(
    "does not retry a %i, which is an answer rather than a stall",
    async (status) => {
      fetchMock.mockResolvedValue(response(status));

      await expect(
        fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS),
      ).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("retries a request that never completed, like a deployment rollover", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(200, { data: ["room-1"] }));

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toEqual({ data: ["room-1"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an attempt that never answers and retries it", async () => {
    // The route has no timeout of its own around the Core read, so it can hang
    // forever. Without a per-attempt ceiling that one request would spend the
    // caller's whole budget and nothing would be retried.
    fetchMock
      .mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      )
      .mockResolvedValueOnce(response(200, { data: ["room-1"] }));

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(9_000 + 1_000);

    await expect(result).resolves.toEqual({ data: ["room-1"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0, 750],
    [1, 1_250],
  ])(
    "spreads the first retry by a quarter (random %s waits %ims)",
    async (random, expectedDelay) => {
      // Three sidebar collections and the unread bell stall on the same tick.
      // Retrying in lockstep would hit the recovering function as one burst.
      vi.spyOn(Math, "random").mockReturnValue(random);
      fetchMock
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200, { data: ["room-1"] }));

      const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toEqual({ data: ["room-1"] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("retries a 200 whose body never arrives", async () => {
    // The headers landed, then the connection dropped mid-body. That is the
    // same stall as a request that never answered, not an answer.
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new TypeError("network error");
        },
      })
      .mockResolvedValueOnce(response(200, { data: ["room-1"] }));

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toEqual({ data: ["room-1"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 200 whose body will not parse", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    await expect(
      fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry when the caller's own deadline aborts the request", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const result = fetchBackgroundJson("/api/chat/rooms", 500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stops when the deadline has already passed as the 503 lands", async () => {
    // The response arrives after the deadline, so the signal is already
    // aborted when the retry wait starts.
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(() => resolve(response(503)), 1_000);
        }),
    );

    const result = fetchBackgroundJson("/api/chat/rooms", 500);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps every retry inside the caller's deadline", async () => {
    fetchMock.mockResolvedValue(response(503));

    // Deadline shorter than the first retry delay: the wait is aborted rather
    // than outliving the budget the caller asked for.
    const result = fetchBackgroundJson("/api/chat/rooms", 500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("resolves null with a single attempt on a 429, never a stall retry", async () => {
    fetchMock.mockResolvedValue(
      response(
        429,
        {
          error: "Chat rooms unavailable",
          kind: "message_read_budget_exceeded",
          retryAfterSeconds: 30,
        },
        { "retry-after": "30" },
      ),
    );

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("resolves null on a 429 whose body carries the delay alone", async () => {
    fetchMock.mockResolvedValue(
      response(429, {
        error: "Chat rooms unavailable",
        kind: "message_read_budget_exceeded",
        retryAfterSeconds: 45,
      }),
    );

    await expect(
      fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("resolves null on a bare 429 instead of retrying it as a stall", async () => {
    fetchMock.mockResolvedValue(response(429, {}));

    const result = fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("still resolves null when the 429 body never arrives", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => {
        throw new TypeError("network error");
      },
    });

    await expect(
      fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("arms the shared clock on a 429, quieting a consulting scheduler", async () => {
    // The arming is observable only through a consulting reader: a scheduler
    // whose explicit request lands inside the window must not read at once.
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useChatRefreshScheduler({
        key: "room-1",
        refresh,
        healthy: false,
        fallbackIntervalMs: 3_000,
      }),
    );
    fetchMock.mockResolvedValue(response(429, {}, { "retry-after": "30" }));

    await expect(
      fetchBackgroundJson("/api/chat/rooms", TIMEOUT_MS),
    ).resolves.toBeNull();
    await act(async () => {
      result.current();
    });
    expect(refresh).not.toHaveBeenCalled();

    unmount();
  });
});

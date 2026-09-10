import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRoomMessages } from "./fetch-room-messages";

const fetchMock = vi.fn();
const timestamp = "2026-09-08T10:00:00.000Z";

function response(data: unknown[], nextCursor: string | null = null) {
  return new Response(
    JSON.stringify({
      data,
      meta: {
        timestamp,
        requestId: "request-1",
        pagination: { cursor: null, nextCursor, limit: data.length },
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

describe("fetchRoomMessages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("reads the room page over GET and restores generated dates", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      response(
        [
          {
            id: "msg-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            editedAt: null,
            deletedAt: null,
          },
        ],
        "cursor-2",
      ),
    );
    const page = await fetchRoomMessages("room-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/room-1/messages", {
      cache: "no-store",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(page?.messages[0]).toMatchObject({
      id: "msg-1",
      createdAt: new Date(timestamp),
    });
    expect(page?.nextCursor).toBe("cursor-2");
  });

  it("names the thread parent in the query", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(response([]));
    await fetchRoomMessages("room-1", "parent/1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/room-1/messages?parentMessageId=parent%2F1",
      expect.anything(),
    );
  });

  it("aborts a stalled request after 30 seconds and returns null", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const pending = fetchRoomMessages("room-1");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["a failed status", () => new Response("{}", { status: 502 })],
    ["a network error", () => Promise.reject(new Error("offline"))],
  ])("returns null on %s", async (_label, make) => {
    // A request that never completes is a stall, so it retries at 1s and 3s,
    // each jittered by up to a quarter. Fake timers keep that off the suite's
    // wall clock; 5s covers the widest spread.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockImplementation(() => make());
      const pending = fetchRoomMessages("room-1");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

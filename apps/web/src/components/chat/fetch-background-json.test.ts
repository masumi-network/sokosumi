import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBackgroundJson } from "./fetch-background-json";

const TIMEOUT_MS = 20_000;

function response(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchBackgroundJson", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("keeps every retry inside the caller's deadline", async () => {
    fetchMock.mockResolvedValue(response(503));

    // Deadline shorter than the first retry delay: the wait is aborted rather
    // than outliving the budget the caller asked for.
    const result = fetchBackgroundJson("/api/chat/rooms", 500);
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

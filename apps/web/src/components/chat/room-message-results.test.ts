import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadRoomMessageResults,
  primeRoomMessageResults,
} from "./room-message-results";

const roomId = "00000000-0000-4000-8000-000000000001";
const first = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
const unavailable = (id: string) => ({ id, state: "unavailable" as const });

function respondWith(entries: { messageId: string; results: unknown[] }[]) {
  return new Response(
    JSON.stringify({
      data: entries,
      meta: { timestamp: new Date().toISOString(), requestId: "r" },
    }),
  );
}

describe("room message results", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("reads every row that mounts in the same task with one request", async () => {
    fetchMock.mockResolvedValue(
      respondWith([
        { messageId: first, results: [unavailable("a")] },
        { messageId: second, results: [unavailable("b")] },
      ]),
    );
    const [a, b] = await Promise.all([
      loadRoomMessageResults("viewer", roomId, first),
      loadRoomMessageResults("viewer", roomId, second),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/chat/${roomId}/message-results?messageIds=${first},${second}`,
    );
    expect(a).toEqual([unavailable("a")]);
    expect(b).toEqual([unavailable("b")]);
  });

  it("fails a row whose message the read omits", async () => {
    fetchMock.mockResolvedValue(respondWith([]));
    await expect(
      loadRoomMessageResults("viewer", roomId, first),
    ).rejects.toThrow("Results unavailable");
  });

  it("serves the server-started read once, then reads fresh", async () => {
    primeRoomMessageResults(
      "primed-viewer",
      roomId,
      Promise.resolve([{ messageId: first, results: [unavailable("p")] }]),
    );
    await expect(
      loadRoomMessageResults("primed-viewer", roomId, first),
    ).resolves.toEqual([unavailable("p")]);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(
      respondWith([{ messageId: first, results: [unavailable("f")] }]),
    );
    await expect(
      loadRoomMessageResults("primed-viewer", roomId, first),
    ).resolves.toEqual([unavailable("f")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads in the browser when the server read failed or belongs to another viewer", async () => {
    primeRoomMessageResults("failed-viewer", roomId, Promise.resolve(null));
    primeRoomMessageResults(
      "other-viewer",
      roomId,
      Promise.resolve([{ messageId: first, results: [unavailable("x")] }]),
    );
    fetchMock.mockImplementation(async () =>
      respondWith([{ messageId: first, results: [unavailable("f")] }]),
    );
    await expect(
      loadRoomMessageResults("failed-viewer", roomId, first),
    ).resolves.toEqual([unavailable("f")]);
    await expect(
      loadRoomMessageResults("someone-else", roomId, first),
    ).resolves.toEqual([unavailable("f")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

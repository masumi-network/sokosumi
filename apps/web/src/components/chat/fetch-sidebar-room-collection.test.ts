import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";

const fetchMock = vi.fn();
const timestamp = "2026-09-08T10:00:00.000Z";

function response(data: unknown[]) {
  return new Response(
    JSON.stringify({
      data,
      meta: {
        timestamp,
        requestId: "request-1",
        pagination: { nextCursor: null },
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

describe("sidebar collection GET requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  it("uses a GET outside the action queue and restores generated room dates", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      response([
        {
          id: "room-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          starredAt: timestamp,
          mutedAt: null,
        },
      ]),
    );
    const page = await fetchSidebarRoomCollection("active");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/rooms?collection=active",
      {
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
    expect(page?.rooms[0]).toMatchObject({
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      starredAt: new Date(timestamp),
      mutedAt: null,
    });
    expect(page?.nextCursor).toBeNull();
  });

  it("restores invitation dates", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      response([
        { id: "invite-1", createdAt: timestamp, expiresAt: timestamp },
      ]),
    );
    expect(await fetchSidebarRoomCollection("invitations")).toEqual([
      {
        id: "invite-1",
        createdAt: new Date(timestamp),
        expiresAt: new Date(timestamp),
      },
    ]);
  });

  it.each([401, 502])(
    "retains existing rows when HTTP %s is returned",
    async (status) => {
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockResolvedValue(new Response("{}", { status }));
      expect(await fetchSidebarRoomCollection("active")).toBeNull();
    },
  );

  it("rejects sign-in HTML and malformed JSON", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("<html>Sign in</html>"));
    expect(await fetchSidebarRoomCollection("active")).toBeNull();
    fetchMock.mockResolvedValue(new Response("{}"));
    expect(await fetchSidebarRoomCollection("active")).toBeNull();
  });

  it("aborts a stalled read so a later poll can succeed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const stalled = fetchSidebarRoomCollection("active");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal?.aborted).toBe(true);
    expect(await stalled).toBeNull();

    fetchMock.mockResolvedValue(response([]));
    expect(await fetchSidebarRoomCollection("active")).toEqual({
      rooms: [],
      nextCursor: null,
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSidebarRoom,
  fetchSidebarRoomCollection,
} from "./fetch-sidebar-room-collection";

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
          // A room DTO always carries its roster, and the transformer walks it
          // for each member's Room last-read.
          userMembers: [],
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

  it("answers Elsewhere rooms as a plain list, with their dates", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      response([
        {
          id: "room-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          starredAt: null,
          mutedAt: null,
          userMembers: [],
        },
      ]),
    );
    const rooms = await fetchSidebarRoomCollection("elsewhere");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/chat/rooms?collection=elsewhere",
    );
    expect(rooms?.[0]).toMatchObject({
      id: "room-1",
      updatedAt: new Date(timestamp),
    });
  });

  it("sends reads asked for together as one request, each with its own answer", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const room = {
      id: "room-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      starredAt: null,
      mutedAt: null,
      userMembers: [],
    };
    const envelope = (data: unknown[]) => ({
      data,
      meta: {
        timestamp,
        requestId: "request-1",
        pagination: { nextCursor: null },
      },
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            active: envelope([room]),
            invitations: envelope([
              { id: "invite-1", createdAt: timestamp, expiresAt: timestamp },
            ]),
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    const [active, alsoActive, invitations] = await Promise.all([
      fetchSidebarRoomCollection("active"),
      fetchSidebarRoomCollection("active"),
      fetchSidebarRoomCollection("invitations"),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/chat/rooms?collections=active,invitations",
    );
    expect(active?.rooms[0]).toMatchObject({
      id: "room-1",
      updatedAt: new Date(timestamp),
    });
    expect(alsoActive?.rooms[0]).not.toBe(active?.rooms[0]);
    expect(invitations?.[0]).toMatchObject({
      id: "invite-1",
      createdAt: new Date(timestamp),
    });
  });

  it("asks one by one when the server refuses a list of collections", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 400 }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]));
    const [active, invitations] = await Promise.all([
      fetchSidebarRoomCollection("active"),
      fetchSidebarRoomCollection("invitations"),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/chat/rooms?collections=active,invitations",
      "/api/chat/rooms?collection=active",
      "/api/chat/rooms?collection=invitations",
    ]);
    expect(active).toEqual({ rooms: [], nextCursor: null });
    expect(invitations).toEqual([]);
  });

  it("asks again on its own for a part that never reached Core", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              active: {
                data: [],
                meta: {
                  timestamp,
                  requestId: "request-1",
                  pagination: { nextCursor: null },
                },
              },
              invitations: { stalled: true },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(response([]));
    const [active, invitations] = await Promise.all([
      fetchSidebarRoomCollection("active"),
      fetchSidebarRoomCollection("invitations"),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/chat/rooms?collections=active,invitations",
      "/api/chat/rooms?collection=invitations",
    ]);
    expect(active).toEqual({ rooms: [], nextCursor: null });
    expect(invitations).toEqual([]);
  });

  it("answers the other parts without waiting for a stalled part's re-read", async () => {
    vi.stubGlobal("fetch", fetchMock);
    let answerInvitations: (value: Response) => void = () => {};
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              active: {
                data: [],
                meta: {
                  timestamp,
                  requestId: "request-1",
                  pagination: { nextCursor: null },
                },
              },
              invitations: { stalled: true },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerInvitations = resolve;
        }),
      );
    const active = fetchSidebarRoomCollection("active");
    const invitations = fetchSidebarRoomCollection("invitations");
    expect(await active).toEqual({ rooms: [], nextCursor: null });
    answerInvitations(response([]));
    expect(await invitations).toEqual([]);
  });

  it("answers null for a collection the batch left out", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { active: null } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [active, invitations] = await Promise.all([
      fetchSidebarRoomCollection("active"),
      fetchSidebarRoomCollection("invitations"),
    ]);
    expect(active).toBeNull();
    expect(invitations).toBeNull();
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

describe("one-room sidebar read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function answer(data: unknown) {
    return new Response(
      JSON.stringify({
        data,
        meta: { timestamp, requestId: "request-1" },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  it("asks for the room by id and restores its dates", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      answer({
        id: "room-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        userMembers: [],
      }),
    );

    const room = await fetchSidebarRoom("room-1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat/rooms?roomId=room-1");
    expect(room).toMatchObject({ updatedAt: new Date(timestamp) });
  });

  it("tells a room the reader can no longer open from a read that failed", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(answer(null));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 502 }));

    await expect(fetchSidebarRoom("room-1")).resolves.toBe("gone");
    await expect(fetchSidebarRoom("room-1")).resolves.toBeNull();
  });
});

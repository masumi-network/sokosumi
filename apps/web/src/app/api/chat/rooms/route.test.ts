import { err, ok } from "neverthrow";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_READ_THROTTLE_FALLBACK_SECONDS } from "@/lib/chat/chat-read-throttle";
import { CoreApiRequestError } from "@/lib/clients/core.request";

const {
  getSessionResultMock,
  getRoomMock,
  listRoomsMock,
  listArchivedMock,
  listElsewhereMock,
  listPendingMock,
} = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  getRoomMock: vi.fn(),
  listRoomsMock: vi.fn(),
  listArchivedMock: vi.fn(),
  listElsewhereMock: vi.fn(),
  listPendingMock: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    getRoom: getRoomMock,
    listRooms: listRoomsMock,
    listArchivedRooms: listArchivedMock,
    listElsewhereRooms: listElsewhereMock,
    listPendingInvitations: listPendingMock,
  },
}));

import { GET } from "./route";

function request(collection: string) {
  return new NextRequest(
    `https://app.test/api/chat/rooms?collection=${collection}`,
  );
}

describe("GET /api/chat/rooms", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "user-1" } }));
    listRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1" }],
      nextCursor: null,
    });
    listArchivedMock.mockResolvedValue({ rooms: [], nextCursor: null });
    listPendingMock.mockResolvedValue([]);
  });

  it("answers the one room a message event named, not the list", async () => {
    const roomId = "0198c3a2-7b1e-7c44-9d0a-3f5e6a7b8c9d";
    getRoomMock.mockResolvedValue({ id: roomId });
    const result = await GET(
      new NextRequest(`https://app.test/api/chat/rooms?roomId=${roomId}`),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: { id: roomId } });
    expect(getRoomMock).toHaveBeenCalledExactlyOnceWith(roomId);
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("answers null for a room the reader can no longer open", async () => {
    getRoomMock.mockResolvedValue(null);
    const result = await GET(
      new NextRequest(
        "https://app.test/api/chat/rooms?roomId=0198c3a2-7b1e-7c44-9d0a-3f5e6a7b8c9d",
      ),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: null });
  });

  it("refuses a room id that is not a UUID before asking Core", async () => {
    const result = await GET(
      new NextRequest("https://app.test/api/chat/rooms?roomId=..%2Fadmin"),
    );
    expect(result.status).toBe(400);
    expect(getRoomMock).not.toHaveBeenCalled();
  });

  it("answers Elsewhere rooms as Core lists them", async () => {
    listElsewhereMock.mockResolvedValue([{ id: "room-2" }]);
    const result = await GET(request("elsewhere"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: [{ id: "room-2" }] });
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("uses the existing full room list without waiting for invitations", async () => {
    listPendingMock.mockReturnValue(new Promise(() => {}));
    const result = await GET(request("active"));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      data: [{ id: "room-1" }],
      meta: { pagination: { nextCursor: null } },
    });
    expect(listRoomsMock).toHaveBeenCalledOnce();
    expect(listArchivedMock).not.toHaveBeenCalled();
    expect(listPendingMock).not.toHaveBeenCalled();
  });

  it.each(["archived", "invitations"])(
    "only fetches the %s collection",
    async (collection) => {
      const result = await GET(request(collection));
      expect(result.status).toBe(200);
      expect(listRoomsMock).not.toHaveBeenCalled();
      expect(
        collection === "archived" ? listArchivedMock : listPendingMock,
      ).toHaveBeenCalledOnce();
    },
  );

  describe("several collections at once", () => {
    function requestMany(collections: string) {
      return new NextRequest(
        `https://app.test/api/chat/rooms?collections=${collections}`,
      );
    }

    it("answers each in its own envelope behind one session read", async () => {
      listPendingMock.mockResolvedValue([{ id: "invite-1" }]);
      const result = await GET(requestMany("active,invitations"));
      expect(result.status).toBe(200);
      expect(getSessionResultMock).toHaveBeenCalledOnce();
      expect(await result.json()).toMatchObject({
        data: {
          active: {
            data: [{ id: "room-1" }],
            meta: { pagination: { nextCursor: null } },
          },
          invitations: { data: [{ id: "invite-1" }] },
        },
      });
      expect(listArchivedMock).not.toHaveBeenCalled();
    });

    it("answers null for one failed collection and keeps the others", async () => {
      listPendingMock.mockRejectedValue(
        new CoreApiRequestError("boom", { status: 500 }),
      );
      const result = await GET(requestMany("active,invitations"));
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        data: { active: { data: [{ id: "room-1" }] }, invitations: null },
      });
    });

    it("throttles the whole answer when one collection is throttled", async () => {
      listPendingMock.mockRejectedValue(
        new CoreApiRequestError("slow down", {
          status: 429,
          retryAfterSeconds: 7,
        }),
      );
      const result = await GET(requestMany("active,invitations"));
      expect(result.status).toBe(429);
      expect(result.headers.get("retry-after")).toBe("7");
    });

    it("answers 503 for all of them when one read never reached Core", async () => {
      listPendingMock.mockRejectedValue(new CoreApiRequestError("timeout"));
      const result = await GET(requestMany("active,invitations"));
      expect(result.status).toBe(503);
    });

    it("answers the throttle even when a stall failed first", async () => {
      listRoomsMock.mockRejectedValue(new CoreApiRequestError("timeout"));
      listPendingMock.mockImplementation(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new CoreApiRequestError("slow down", {
                    status: 429,
                    retryAfterSeconds: 7,
                  }),
                ),
              5,
            ),
          ),
      );
      const result = await GET(requestMany("active,invitations"));
      expect(result.status).toBe(429);
      expect(result.headers.get("retry-after")).toBe("7");
    });

    it("rejects an unknown collection before fetching", async () => {
      expect((await GET(requestMany("active,everything"))).status).toBe(400);
      expect(listRoomsMock).not.toHaveBeenCalled();
    });

    it("answers 401 for all of them without a session", async () => {
      getSessionResultMock.mockResolvedValue(ok(null));
      expect((await GET(requestMany("active,invitations"))).status).toBe(401);
      expect(listRoomsMock).not.toHaveBeenCalled();
    });
  });

  it("rejects unknown collections before fetching", async () => {
    expect((await GET(request("everything"))).status).toBe(400);
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("returns JSON 401 without a sign-in redirect", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));
    const result = await GET(request("active"));
    expect(result.status).toBe(401);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual({ error: "Unauthorized" });
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the Core session read times out", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(503);
    expect(result.headers.get("retry-after")).toBe("1");
    expect(await result.json()).toEqual({
      error: "Chat rooms unavailable",
      reason: "timeout",
    });
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("returns JSON failure if the service throws a redirect", async () => {
    listRoomsMock.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/signin;307;",
      }),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(502);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual({ error: "Chat rooms unavailable" });
  });

  it("returns 503, not 502, when the Core read never reached Core", async () => {
    // No status means the request itself failed: a timeout or a dropped
    // connection. The browser retries a 503; it gives up on a 502.
    listRoomsMock.mockRejectedValue(
      new CoreApiRequestError("The operation was aborted due to timeout"),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "Chat rooms unavailable" });
  });

  it("preserves Core failure status without exposing error details", async () => {
    listRoomsMock.mockRejectedValue(
      new CoreApiRequestError("private backend details", { status: 503 }),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "Chat rooms unavailable" });
  });

  it("forwards a Core throttle as a 429 with the retry signal", async () => {
    listRoomsMock.mockRejectedValue(
      new CoreApiRequestError("Chat history read budget exceeded", {
        status: 429,
        kind: "message_read_budget_exceeded",
        retryAfterSeconds: 7,
      }),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("7");
    expect(await result.json()).toEqual({
      error: "Chat rooms unavailable",
      kind: "message_read_budget_exceeded",
      retryAfterSeconds: 7,
    });
  });

  it("answers a bare Core 429 with the bounded fallback delay", async () => {
    listRoomsMock.mockRejectedValue(
      new CoreApiRequestError("slow down", { status: 429 }),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe(
      String(CHAT_READ_THROTTLE_FALLBACK_SECONDS),
    );
    expect(await result.json()).toEqual({
      error: "Chat rooms unavailable",
      retryAfterSeconds: CHAT_READ_THROTTLE_FALLBACK_SECONDS,
    });
  });
});

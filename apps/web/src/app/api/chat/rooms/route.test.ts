import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

const { getSessionMock, listRoomsMock, listArchivedMock, listPendingMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    listRoomsMock: vi.fn(),
    listArchivedMock: vi.fn(),
    listPendingMock: vi.fn(),
  }));
vi.mock("@/lib/auth/auth.server", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    listRooms: listRoomsMock,
    listArchivedRooms: listArchivedMock,
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
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    listRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1" }],
      nextCursor: null,
    });
    listArchivedMock.mockResolvedValue({ rooms: [], nextCursor: null });
    listPendingMock.mockResolvedValue([]);
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

  it("rejects unknown collections before fetching", async () => {
    expect((await GET(request("everything"))).status).toBe(400);
    expect(listRoomsMock).not.toHaveBeenCalled();
  });

  it("returns JSON 401 without a sign-in redirect", async () => {
    getSessionMock.mockResolvedValue(null);
    const result = await GET(request("active"));
    expect(result.status).toBe(401);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual({ error: "Unauthorized" });
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

  it("preserves Core failure status without exposing error details", async () => {
    listRoomsMock.mockRejectedValue(
      new CoreApiRequestError("private backend details", { status: 503 }),
    );
    const result = await GET(request("active"));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "Chat rooms unavailable" });
  });
});

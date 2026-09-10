import { err, ok } from "neverthrow";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

const { getSessionResultMock, listMessagesMock, listThreadMessagesMock } =
  vi.hoisted(() => ({
    getSessionResultMock: vi.fn(),
    listMessagesMock: vi.fn(),
    listThreadMessagesMock: vi.fn(),
  }));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    listMessages: listMessagesMock,
    listThreadMessages: listThreadMessagesMock,
  },
}));

import { GET } from "./route";

const ROOM_ID = "room-1";

function get(query = "") {
  return GET(
    new NextRequest(`https://app.test/api/chat/${ROOM_ID}/messages${query}`),
    { params: Promise.resolve({ roomId: ROOM_ID }) },
  );
}

describe("GET /api/chat/[roomId]/messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "user-1" } }));
    listMessagesMock.mockResolvedValue({
      messages: [{ id: "msg-1" }],
      nextCursor: "cursor-2",
    });
    listThreadMessagesMock.mockResolvedValue({
      messages: [{ id: "reply-1" }],
      nextCursor: null,
    });
  });

  it("reads the room's latest page as no-store JSON", async () => {
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      data: [{ id: "msg-1" }],
      meta: { pagination: { nextCursor: "cursor-2", limit: 1 } },
    });
    expect(listMessagesMock).toHaveBeenCalledWith(ROOM_ID);
    expect(listThreadMessagesMock).not.toHaveBeenCalled();
  });

  it("reads a thread when a parent message is named", async () => {
    const result = await get("?parentMessageId=parent-1");
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: [{ id: "reply-1" }] });
    expect(listThreadMessagesMock).toHaveBeenCalledWith(ROOM_ID, "parent-1");
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it("rejects an empty parent message id before fetching", async () => {
    expect((await get("?parentMessageId=")).status).toBe(400);
    expect(listMessagesMock).not.toHaveBeenCalled();
    expect(listThreadMessagesMock).not.toHaveBeenCalled();
  });

  it("returns JSON 401 without a sign-in redirect", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));
    const result = await get();
    expect(result.status).toBe(401);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual({ error: "Unauthorized" });
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the Core session read times out", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );
    const result = await get();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: "Chat messages unavailable",
      reason: "timeout",
    });
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it("returns JSON failure if the service throws a redirect", async () => {
    listMessagesMock.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/signin;307;",
      }),
    );
    const result = await get();
    expect(result.status).toBe(502);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual({
      error: "Chat messages unavailable",
    });
  });

  it("preserves Core failure status without exposing error details", async () => {
    listMessagesMock.mockRejectedValue(
      new CoreApiRequestError("private backend details", { status: 403 }),
    );
    const result = await get();
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({
      error: "Chat messages unavailable",
    });
  });
});

import { ok } from "neverthrow";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, listEarlierThreadsMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  listEarlierThreadsMock: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: { listEarlierThreads: listEarlierThreadsMock },
}));

import { GET } from "./route";

describe("GET /api/chat/threads/earlier", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "user-1" } }));
    listEarlierThreadsMock.mockResolvedValue({
      threads: [{ roomId: "room-1", parentMessageId: "p1" }],
      nextCursor: "p1",
    });
  });

  it("answers a page of earlier Threads, uncached, with the cursor passed on", async () => {
    const result = await GET(
      new NextRequest("https://app.test/api/chat/threads/earlier?cursor=p0"),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      data: [{ roomId: "room-1", parentMessageId: "p1" }],
      meta: { pagination: { nextCursor: "p1" } },
    });
    expect(listEarlierThreadsMock).toHaveBeenCalledWith({ cursor: "p0" });
  });
});

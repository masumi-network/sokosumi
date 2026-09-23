import { ok } from "neverthrow";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, listUnreadThreadsMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  listUnreadThreadsMock: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: { listUnreadThreads: listUnreadThreadsMock },
}));

import { GET } from "./route";

describe("GET /api/chat/threads/unread", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "user-1" } }));
    listUnreadThreadsMock.mockResolvedValue({
      threads: [{ roomId: "room-1", parentMessageId: "p1" }],
      nextCursor: "p1",
    });
  });

  it("answers a page of unread Threads, uncached, with the cursor passed on", async () => {
    const result = await GET(
      new NextRequest("https://app.test/api/chat/threads/unread?cursor=p0"),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      data: [{ roomId: "room-1", parentMessageId: "p1" }],
      meta: { pagination: { nextCursor: "p1" } },
    });
    expect(listUnreadThreadsMock).toHaveBeenCalledWith({ cursor: "p0" });
  });
});

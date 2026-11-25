import { err, ok } from "neverthrow";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, getPageMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  getPageMock: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/chat-feed.service", () => ({
  chatFeedService: { getPage: getPageMock },
}));

import { GET } from "./route";

function request(query = "") {
  return new NextRequest(`https://app.test/api/chat/feed${query}`);
}

describe("GET /api/chat/feed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "user-1" } }));
    getPageMock.mockResolvedValue({
      items: [{ lane: "feed", room: { id: "room-1" }, message: { id: "m1" } }],
      nextCursor: "m1",
      unreadCount: 4,
    });
  });

  it("answers the Feed page, uncached, with cursor and limit passed on", async () => {
    const result = await GET(request("?cursor=m0&limit=1"));

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      data: {
        items: [{ message: { id: "m1" } }],
        nextCursor: "m1",
        unreadCount: 4,
      },
    });
    // The sidebar count reads one item; losing the limit would read a full
    // page on every sidebar render and spend the chat read budget.
    expect(getPageMock).toHaveBeenCalledWith({ cursor: "m0", limit: 1 });
  });

  it("drops a limit that is not a positive whole number", async () => {
    await GET(request("?limit=abc"));
    await GET(request("?limit=0"));

    expect(getPageMock.mock.calls).toEqual([
      [{ cursor: undefined, limit: undefined }],
      [{ cursor: undefined, limit: undefined }],
    ]);
  });

  it("returns JSON 401 without a sign-in redirect", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));
    const result = await GET(request());

    expect(result.status).toBe(401);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.json()).toEqual({ error: "Unauthorized" });
    expect(getPageMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the Core session read times out", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );
    const result = await GET(request());

    expect(result.status).toBe(503);
    expect(result.headers.get("retry-after")).toBe("1");
    expect(await result.json()).toEqual({
      error: "Feed unavailable",
      reason: "timeout",
    });
    expect(getPageMock).not.toHaveBeenCalled();
  });
});

import { ok } from "neverthrow";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, getSummaryMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  getSummaryMock: vi.fn(),
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("@/lib/services/chat-signals.service", () => ({
  chatSignalsService: { getSummary: getSummaryMock },
}));

import { GET } from "./route";

const request = () =>
  new NextRequest("https://app.test/api/chat/room-1/summary");
const context = { params: Promise.resolve({ roomId: "room-1" }) };

describe("GET /api/chat/[roomId]/summary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionResultMock.mockResolvedValue(ok({ user: { id: "user-1" } }));
  });

  it("answers the room's summary in the Core envelope, uncached", async () => {
    getSummaryMock.mockResolvedValue({ scope: "room-1", headline: "Hi" });

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).data).toEqual({
      scope: "room-1",
      headline: "Hi",
    });
    expect(getSummaryMock).toHaveBeenCalledWith("room-1");
  });

  it("does not reach Core without a session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await GET(request(), context);

    expect(response.status).toBe(401);
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it("answers 502 without details when Core fails", async () => {
    getSummaryMock.mockRejectedValue(new Error("boom"));

    const response = await GET(request(), context);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Summary unavailable" });
  });
});

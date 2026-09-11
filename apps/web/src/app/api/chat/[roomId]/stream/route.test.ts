import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, headersMock, fetchMock } = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  headersMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getCoreApiBaseUrl: () => "http://core.test/v1",
}));

import { GET } from "./route";

function request() {
  return GET(new Request("https://web.test/api/chat/room-1/stream") as never, {
    params: Promise.resolve({ roomId: "room-1" }),
  });
}

describe("GET /api/chat/[roomId]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockResolvedValue(new Headers());
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns 401 when the browser has no session", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await request();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The stream backs the chat transport. A 401 for a Core stall tells a
   * signed-in browser its session is gone; 503 says the read failed and is
   * worth retrying.
   */
  it("returns 503, not 401, when the session read could not reach Core", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );

    const response = await request();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.text()).toContain("timeout");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

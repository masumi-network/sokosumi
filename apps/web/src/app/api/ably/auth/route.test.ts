import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, headersMock, fetchMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  headersMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({ getSession: getSessionMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getCoreApiBaseUrl: () => "http://core.test/v1",
}));

import { POST } from "./route";

function createRequest() {
  return new NextRequest(
    "https://web.test/api/ably/auth?clientInstanceId=inst_test01",
    { method: "POST" },
  );
}

describe("POST /api/ably/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    headersMock.mockResolvedValue(new Headers({ cookie: "session=abc" }));
    // The session helper reports null on both outages and expired sessions.
    getSessionMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses Core's authenticated token endpoint without a second session lookup", async () => {
    const tokenRequest = {
      keyName: "app.key",
      capability: "{}",
      timestamp: 1,
      nonce: "n",
      mac: "m",
    };
    fetchMock.mockResolvedValue(Response.json({ data: tokenRequest }));

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(tokenRequest);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://core.test/v1/realtime/ably-token?clientInstanceId=inst_test01",
      ),
      expect.objectContaining({
        headers: { cookie: "session=abc", Accept: "application/json" },
      }),
    );
  });

  it("preserves Core session rejection as 401", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "stale-user" } });
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
  });

  it.each([403, 429, 500, 503])(
    "keeps Core %i retryable instead of reporting session loss",
    async (status) => {
      fetchMock.mockResolvedValue(new Response("Core error", { status }));

      const response = await POST(createRequest());

      expect(response.status).toBe(502);
    },
  );

  /**
   * The 7s Core budget expiring says Core was slow, not that it refused us.
   * 502 hid that; 401 would be a lie the browser acts on by ending its
   * realtime client.
   */
  it("answers 503 when the Core token request runs out of time", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      error: "Ably token unavailable",
      reason: "timeout",
    });
  });

  it("keeps transport failure retryable instead of reporting session loss", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const response = await POST(createRequest());

    expect(response.status).toBe(502);
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readRouteSessionMock, fetchMock } = vi.hoisted(() => ({
  readRouteSessionMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: readRouteSessionMock,
}));
vi.mock("@/lib/clients/utils/build-core-chat-proxy-headers", () => ({
  buildCoreChatProxyHeaders: () => new Headers(),
}));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://core.test/v1",
}));

import { GET } from "./route";

const request = (query = "") =>
  new NextRequest(
    `https://app.test/api/workspaces/ws-1/social-statistics${query}`,
  );

describe("GET /api/workspaces/[workspaceId]/social-statistics", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: { user: { id: "u-1" } },
    });
  });

  it("unwraps Core's cached workspace page", async () => {
    const data = { accounts: [], posts: [], nextCursor: null };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data, meta: {} }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(
      request("?provider=x&publishedFrom=2026-10-01T00:00:00.000Z"),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(data);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe(
      "/v1/workspaces/ws-1/social-connections/statistics",
    );
    expect(url.searchParams.get("provider")).toBe("x");
  });

  it("rejects invalid filters before reaching Core", async () => {
    const response = await GET(request("?provider=unknown"), {
      params: Promise.resolve({ workspaceId: "ws-1" }),
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });
    const response = await GET(request(), {
      params: Promise.resolve({ workspaceId: "ws-1" }),
    });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

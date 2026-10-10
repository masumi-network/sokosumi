import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readRouteSessionMock, fetchMock } = vi.hoisted(() => ({
  readRouteSessionMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: readRouteSessionMock,
}));
vi.mock("@/lib/clients/utils/build-core-chat-proxy-headers", () => ({
  buildCoreChatProxyHeaders: () => new Headers(),
}));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://core.test/v1",
}));

import { GET } from "./route";

const request = (query: string) =>
  new NextRequest(
    `https://app.test/api/projects/p-1/social-statistics/export${query}`,
  );

describe("GET /api/projects/[projectId]/social-statistics/export", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    readRouteSessionMock.mockResolvedValue({ status: "authenticated" });
  });

  it("streams Core's CSV with the selected filters", async () => {
    fetchMock.mockResolvedValue(
      new Response("platform,account\r\n", {
        headers: {
          "content-disposition": 'attachment; filename="performance.csv"',
        },
      }),
    );

    const response = await GET(
      request(
        "?format=csv&connectionId=11111111-1111-4111-8111-111111111111&publishedFrom=2026-10-01T00:00:00.000Z",
      ),
      { params: Promise.resolve({ projectId: "p-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "performance.csv",
    );
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe(
      "/v1/projects/p-1/social-connections/statistics/export",
    );
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("connectionId")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("answers 401 without a session", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });
    const response = await GET(request("?format=csv"), {
      params: Promise.resolve({ projectId: "p-1" }),
    });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

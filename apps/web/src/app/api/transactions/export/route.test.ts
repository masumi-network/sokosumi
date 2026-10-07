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
  new NextRequest(`https://app.test/api/transactions/export${query}`);

describe("GET /api/transactions/export", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    readRouteSessionMock.mockResolvedValue({ status: "authenticated" });
  });

  it("streams Core's CSV as an attachment", async () => {
    fetchMock.mockResolvedValue(
      new Response("date,source,label,credits\r\n", {
        headers: { "content-disposition": 'attachment; filename="t.csv"' },
      }),
    );

    const response = await GET(request("?from=2026-09-01&to=2026-09-30"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toContain("t.csv");
    expect(await response.text()).toContain("date,source,label,credits");
  });

  it("forwards only the parameters Core declares", async () => {
    fetchMock.mockResolvedValue(new Response(""));

    await GET(request("?from=2026-09-01&evil=1&scope=owned"));

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/transactions/export");
    expect(url.searchParams.get("from")).toBe("2026-09-01");
    expect(url.searchParams.get("scope")).toBe("owned");
    expect(url.searchParams.has("evil")).toBe(false);
  });

  it("answers 401 without a session", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    const response = await GET(request(""));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

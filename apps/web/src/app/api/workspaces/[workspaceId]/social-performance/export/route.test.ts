import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://core.test/v1/",
}));

import { GET } from "./route";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

function read(query = "") {
  return GET(
    new Request(
      `https://web.test/api/workspaces/${WORKSPACE_ID}/social-performance/export${query}`,
      {
        headers: {
          cookie: "session=authorized",
          authorization: "Bearer caller-token",
          "x-organization-slug": "current-workspace",
        },
      },
    ),
    { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.readSession.mockResolvedValue({ status: "authenticated" });
});
afterEach(() => vi.unstubAllGlobals());

describe("workspace performance export proxy", () => {
  it("streams exact workbook bytes with caller auth and full-scope filters, excluding display pagination", async () => {
    const workbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80]);
    mocks.fetch.mockResolvedValue(
      new Response(workbook, {
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition":
            'attachment; filename="workspace-performance.xlsx"',
          "cache-control": "public, max-age=3600",
        },
      }),
    );
    const filters = {
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      provider: "x",
      publishedFrom: "2026-10-01T00:00:00.000Z",
      publishedUntil: "2026-10-07T23:59:59.999Z",
      timezone: "Europe/Prague",
      search: "launch & grow",
      contentType: "video",
      postKind: "quotes",
      sort: "engagementRate",
      format: "xlsx",
    };
    const incoming = new URLSearchParams({
      ...filters,
      workspaceId: PROJECT_ID,
      limit: "1",
      offset: "100",
      unknown: "discard",
    });
    const response = await read(`?${incoming}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(workbook);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="workspace-performance.xlsx"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, options] = mocks.fetch.mock.calls[0];
    const upstream = new URL(String(url));
    expect(upstream.pathname).toBe(
      `/v1/workspaces/${WORKSPACE_ID}/social-performance/export`,
    );
    expect(Object.fromEntries(upstream.searchParams)).toEqual(filters);
    expect(options?.cache).toBe("no-store");
    const headers = new Headers(options?.headers);
    expect(headers.get("cookie")).toBe("session=authorized");
    expect(headers.get("authorization")).toBe("Bearer caller-token");
    expect(headers.get("x-organization-slug")).toBe("current-workspace");
  });

  it("exports the whole workspace when no project is selected", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("platform,post_id\nx,123", {
        headers: { "content-type": "text/csv; charset=utf-8" },
      }),
    );
    const response = await read("?format=csv&limit=1&offset=100");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("platform,post_id\nx,123");
    const [url] = mocks.fetch.mock.calls[0];
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({
      format: "csv",
    });
  });

  it.each([
    { session: { status: "signedOut" }, status: 401 },
    { session: { status: "unavailable", reason: "network" }, status: 503 },
  ])(
    "does not request a download when authentication is $session.status",
    async ({ session, status }) => {
      mocks.readSession.mockResolvedValue(session);
      expect((await read()).status).toBe(status);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([403, 404, 422, 429])(
    "preserves Core client failure status %s without exposing its response",
    async (status) => {
      mocks.fetch.mockResolvedValue(
        new Response("Private upstream details", { status }),
      );
      const response = await read();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: "Export failed" });
    },
  );

  it("maps Core server failures to a gateway error", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("Private details", { status: 500 }),
    );
    const response = await read();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Export failed" });
  });

  it("rejects an upstream success without a download body", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    expect((await read()).status).toBe(502);
  });

  it("reports upstream transport failures as unavailable", async () => {
    mocks.fetch.mockRejectedValue(new Error("Private network details"));
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Export unavailable" });
  });
});

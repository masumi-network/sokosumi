import type { SocialPerformanceAudienceExportRequest } from "@sokosumi/core-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://core.test/v1/",
}));

import { POST } from "./route";

const connectionId = "11111111-1111-4111-8111-111111111111";
const sample: SocialPerformanceAudienceExportRequest = {
  format: "xlsx",
  pages: [
    {
      kind: "mentions",
      postId: null,
      contacts: [],
      posts: [],
      nextCursor: "next-page",
      observedAt: new Date("2026-10-01T00:00:00Z"),
      samplePostCount: 20,
      oldestPostAt: null,
      newestPostAt: null,
      coverage: "Latest 20 mentions",
    },
  ],
};

function write(body: unknown, selectedConnectionId = connectionId) {
  return POST(
    new Request("https://web.test/export", {
      method: "POST",
      headers: {
        cookie: "session=authorized",
        authorization: "Bearer authorized",
        "x-organization-slug": "test-workspace",
        "x-request-id": "audience-export-request",
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        connection: "keep-alive",
      },
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({
        projectId: "project/1",
        connectionId: selectedConnectionId,
      }),
    },
  );
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.readSession.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.readSession.mockResolvedValue({ status: "authenticated" });
});
afterEach(() => vi.unstubAllGlobals());

describe("loaded audience export proxy", () => {
  it.each([
    { format: "csv", contentType: "text/csv; charset=utf-8" },
    {
      format: "xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ] as const)(
    "streams Core's $format with auth and the submitted pages, without reading X",
    async ({ format, contentType }) => {
      const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
      const disposition = `attachment; filename="audience.${format}"`;
      mocks.fetch.mockResolvedValue(
        new Response(bytes, {
          headers: {
            "content-type": contentType,
            "content-disposition": disposition,
          },
        }),
      );
      const body = { ...sample, format };
      const response = await write(body);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("content-disposition")).toBe(disposition);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(mocks.fetch).toHaveBeenCalledOnce();
      const [url, options] = mocks.fetch.mock.calls[0];
      expect(url).toBe(
        `https://core.test/v1/projects/project%2F1/social-connections/${connectionId}/statistics/audience/export`,
      );
      expect(options.method).toBe("POST");
      expect(options.cache).toBe("no-store");
      expect(options.headers.get("cookie")).toBe("session=authorized");
      expect(options.headers.get("authorization")).toBe("Bearer authorized");
      expect(options.headers.get("x-organization-slug")).toBe("test-workspace");
      expect(options.headers.get("x-request-id")).toBe(
        "audience-export-request",
      );
      expect(options.headers.get("content-type")).toBe("application/json");
      expect(options.headers.has("transfer-encoding")).toBe(false);
      expect(options.headers.has("connection")).toBe(false);
      expect(JSON.parse(options.body)).toEqual(
        JSON.parse(JSON.stringify(body)),
      );
    },
  );

  it.each([
    { name: "empty pages", body: { format: "csv", pages: [] } },
    {
      name: "more than 20 pages",
      body: { format: "csv", pages: Array.from({ length: 21 }, () => ({})) },
    },
    { name: "non-object pages", body: { format: "csv", pages: [null] } },
    { name: "unsupported format", body: { ...sample, format: "pdf" } },
    {
      name: "profile details opt-in",
      body: { ...sample, includeProfileDetails: true },
    },
    { name: "malformed body", body: null },
  ])("rejects $name before proxying", async ({ body }) => {
    expect((await write(body)).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before proxying", async () => {
    const response = await POST(
      new Request("https://web.test/export", { method: "POST", body: "{" }),
      { params: Promise.resolve({ projectId: "project-1", connectionId }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid connection before proxying", async () => {
    expect((await write(sample, "invalid-connection")).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { session: "signedOut", status: 401 },
    { session: "unavailable", status: 503 },
  ])(
    "returns $status when the session is $session",
    async ({ session, status }) => {
      mocks.readSession.mockResolvedValue({ status: session });
      expect((await write(sample)).status).toBe(status);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 404, 413, 422])(
    "preserves Core's %s error",
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response("Rejected", { status }));
      expect((await write(sample)).status).toBe(status);
      expect(mocks.fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      name: "server failure",
      upstream: new Response("Failed", { status: 500 }),
    },
    { name: "missing stream", upstream: new Response(null) },
  ])("returns 502 on Core $name", async ({ upstream }) => {
    mocks.fetch.mockResolvedValue(upstream);
    expect((await write(sample)).status).toBe(502);
  });

  it("returns 503 when Core is unavailable", async () => {
    mocks.fetch.mockRejectedValue(new Error("Unavailable"));
    expect((await write(sample)).status).toBe(503);
  });

  it("supplies safe fallback download headers", async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([80, 75])));
    const response = await write(sample);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audience.xlsx"',
    );
  });
});

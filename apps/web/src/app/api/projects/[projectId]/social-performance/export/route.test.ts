import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://core.test/v1",
}));
vi.mock("@/lib/clients/utils/build-core-chat-proxy-headers", () => ({
  buildCoreChatProxyHeaders: (headers: Headers) => ({
    cookie: headers.get("cookie") ?? "",
  }),
}));

import { GET } from "./route";

function read(query = "") {
  return GET(
    new Request(
      `https://web.test/api/projects/project-1/social-performance/export${query}`,
      { headers: { cookie: "session=authorized" } },
    ),
    { params: Promise.resolve({ projectId: "project-1" }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.readSession.mockResolvedValue({ status: "authenticated" });
});
afterEach(() => vi.unstubAllGlobals());
describe("performance export proxy", () => {
  it("streams the Core workbook with caller auth and only declared filters", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("workbook", {
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="performance.xlsx"',
        },
      }),
    );
    const response = await read(
      "?format=xlsx&provider=x&timezone=Europe%2FPrague&search=launch&limit=1&unknown=bad",
    );
    expect(await response.text()).toBe("workbook");
    expect(response.headers.get("content-disposition")).toContain(
      "performance.xlsx",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe(
      "/v1/projects/project-1/social-connections/performance/export",
    );
    expect(new URL(url).searchParams.get("format")).toBe("xlsx");
    expect(new URL(url).searchParams.has("limit")).toBe(false);
    expect(new URL(url).searchParams.has("unknown")).toBe(false);
    expect(options.headers.cookie).toBe("session=authorized");
  });
  it("does not expose a download without a session", async () => {
    mocks.readSession.mockResolvedValue({ status: "signedOut" });
    expect((await read()).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves project authorization errors", async () => {
    mocks.fetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    expect((await read()).status).toBe(403);
  });
});

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

import { POST } from "./route";

const connectionId = "11111111-1111-4111-8111-111111111111";
function write(body: unknown) {
  return POST(
    new Request("https://web.test/export", {
      method: "POST",
      headers: {
        cookie: "session=authorized",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: "project-1", connectionId }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.readSession.mockResolvedValue({ status: "authenticated" });
});
afterEach(() => vi.unstubAllGlobals());
describe("loaded audience export proxy", () => {
  it("streams an authorized workbook from the loaded sample without re-reading an audience", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("workbook", {
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="audience.xlsx"',
        },
      }),
    );
    const body = {
      format: "xlsx",
      pages: [{ kind: "mentions", contacts: [] }],
    };
    const response = await write(body);
    expect(await response.text()).toBe("workbook");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toContain(
      `/social-connections/${connectionId}/performance/audience/export`,
    );
    expect(options.method).toBe("POST");
    expect(options.headers.get("cookie")).toBe("session=authorized");
    expect(JSON.parse(options.body)).toEqual(body);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unbounded samples before proxying", async () => {
    expect(
      (
        await write({
          format: "csv",
          pages: Array.from({ length: 21 }, () => ({})),
        })
      ).status,
    ).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("requires a session and preserves Core scope errors", async () => {
    mocks.readSession.mockResolvedValueOnce({ status: "signedOut" });
    expect((await write({ format: "csv", pages: [{}] })).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    expect((await write({ format: "csv", pages: [{}] })).status).toBe(403);
  });
});

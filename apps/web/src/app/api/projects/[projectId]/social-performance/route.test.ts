import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { listSocialPerformance: mocks.list },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { GET } from "./route";

function read(query = "") {
  return GET(
    new Request(`https://web.test/api/projects/p-1/social-performance${query}`),
    { params: Promise.resolve({ projectId: "p-1" }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "u-1" } },
  });
});
describe("performance read", () => {
  it("forwards cohort, timezone, discovery and paging filters without caching private data", async () => {
    const data = { summary: {}, posts: [], accounts: [] };
    mocks.list.mockResolvedValue(data);
    const response = await read(
      "?provider=x&publishedFrom=2026-10-01T00:00:00.000Z&timezone=Europe%2FPrague&search=launch&contentType=video&postKind=quotes&sort=engagementRate&offset=100",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(data);
    expect(mocks.list).toHaveBeenCalledWith("p-1", {
      provider: "x",
      publishedFrom: new Date("2026-10-01T00:00:00.000Z"),
      timezone: "Europe/Prague",
      search: "launch",
      contentType: "video",
      postKind: "quotes",
      sort: "engagementRate",
      offset: 100,
    });
  });
  it.each([
    "?provider=unknown",
    "?sort=credentials",
    "?offset=-1",
    "?contentType=anything",
    "?publishedFrom=not-a-date",
  ])("rejects invalid filters before Core: %s", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("requires authentication and preserves Core project authorization failures", async () => {
    mocks.readSession.mockResolvedValue({ status: "signedOut" });
    expect((await read()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.readSession.mockResolvedValue({ status: "authenticated" });
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );
    expect((await read()).status).toBe(403);
  });
  it("reports unavailable auth separately from signout", async () => {
    mocks.readSession.mockResolvedValue({
      status: "unavailable",
      reason: "network",
    });
    expect((await read()).status).toBe(503);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

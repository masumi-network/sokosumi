import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { listWorkspaceSocialPerformance: mocks.list },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { GET } from "./route";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

function read(query = "", workspaceId = WORKSPACE_ID) {
  return GET(
    new Request(
      `https://web.test/api/workspaces/${workspaceId}/social-performance${query}`,
    ),
    { params: Promise.resolve({ workspaceId }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSession.mockResolvedValue({ status: "authenticated" });
});

describe("workspace performance read", () => {
  it("forwards the path workspace and validated project/cohort filters without caching the response", async () => {
    const data = {
      workspaceId: WORKSPACE_ID,
      projects: [{ id: PROJECT_ID, name: "Launch" }],
      summary: { current: { postCount: 105 } },
      posts: [],
      accounts: [],
      coverage: { duplicatePostCopiesExcluded: 2 },
    };
    mocks.list.mockResolvedValue(data);
    const response = await read(
      `?projectId=${PROJECT_ID}&connectionId=${CONNECTION_ID}&provider=x&publishedFrom=2026-10-01T00:00:00.000Z&publishedUntil=2026-10-07T23:59:59.999Z&timezone=Europe%2FPrague&search=launch&contentType=video&postKind=quotes&sort=engagementRate&offset=100&limit=10&workspaceId=${PROJECT_ID}&unknown=discard`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(data);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID, {
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      provider: "x",
      publishedFrom: new Date("2026-10-01T00:00:00.000Z"),
      publishedUntil: new Date("2026-10-07T23:59:59.999Z"),
      timezone: "Europe/Prague",
      search: "launch",
      contentType: "video",
      postKind: "quotes",
      sort: "engagementRate",
      offset: 100,
      limit: 10,
    });
  });

  it("keeps an unfiltered workspace read independent of a project", async () => {
    mocks.list.mockResolvedValue({ posts: [], accounts: [] });
    expect((await read()).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID, {
      publishedFrom: undefined,
      publishedUntil: undefined,
    });
  });

  it.each([
    "?projectId=other-workspace",
    "?connectionId=unknown-account",
    "?provider=unknown",
    "?publishedFrom=not-a-date",
    "?limit=101",
    "?offset=-1",
  ])("rejects invalid filters before Core: %s", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects an invalid path workspace before Core", async () => {
    expect((await read("", "invalid-workspace")).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("requires a session before reading workspace data", async () => {
    mocks.readSession.mockResolvedValue({ status: "signedOut" });
    const response = await read();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("distinguishes unavailable authentication from signout", async () => {
    mocks.readSession.mockResolvedValue({
      status: "unavailable",
      reason: "network",
    });
    const response = await read();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toEqual({
      error: "Performance unavailable",
      reason: "network",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])(
    "preserves Core scope/read failure status %s without exposing its details",
    async (status) => {
      mocks.list.mockRejectedValue(
        new CoreApiRequestError("Private upstream details", { status }),
      );
      const response = await read();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: "Performance unavailable",
      });
    },
  );

  it("reports unexpected Core failures as a gateway error", async () => {
    mocks.list.mockRejectedValue(new Error("Private upstream details"));
    const response = await read();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Performance unavailable" });
  });
});

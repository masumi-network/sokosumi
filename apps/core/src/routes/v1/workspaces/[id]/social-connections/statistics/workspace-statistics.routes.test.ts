import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySocialPerformanceHeadline } from "@/helpers/social-performance-headline";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mountExport from "./export/get";
import mountList from "./get";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  export: vi.fn(),
  beta: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/social-account-statistics.service", () => ({
  listSocialAccountStatistics: mocks.list,
  exportSocialAccountStatistics: mocks.export,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));

const workspaceId = "22222222-2222-4222-8222-222222222222";
const otherWorkspaceId = "33333333-3333-4333-8333-333333333333";
const connectionId = "44444444-4444-4444-8444-444444444444";
const auth: AuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const workspace: WorkspaceContext = {
  workspaceId,
  userId: "owner",
  organizationId: null,
};
const account = {
  id: connectionId,
  provider: "x",
  externalHandle: "launch",
  displayName: "Launch",
  avatarUrl: null,
  status: "active",
  connectedAt: null,
  disconnectedAt: null,
  statistics: null,
  postCount: 0,
};

function createApp() {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    c.set("workspaceContext", workspace);
    await next();
  });
  mountList(app);
  mountExport(app);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue({
    accounts: [account],
    posts: [],
    nextCursor: null,
    headline: emptySocialPerformanceHeadline,
  });
  mocks.export.mockResolvedValue({
    posts: [],
    accountName: () => "Launch",
    publishedFrom: undefined,
    publishedUntil: undefined,
  });
});

describe("workspace social account statistics routes", () => {
  it("returns cached workspace data without a project id", async () => {
    const response = await createApp().request(
      `http://localhost/${workspaceId}/social-connections/statistics?connectionId=${connectionId}&publishedFrom=2026-10-01T00:00:00Z`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { accounts: [{ id: connectionId }], posts: [] },
    });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        connectionId,
        publishedFrom: new Date("2026-10-01T00:00:00Z"),
      }),
    );
    expect(mocks.list.mock.calls[0][0].projectId).toBeUndefined();
  });

  it("rejects a workspace id that is not the active workspace", async () => {
    const response = await createApp().request(
      `http://localhost/${otherWorkspaceId}/social-connections/statistics`,
    );
    expect(response.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("downloads the filtered workspace post table as CSV", async () => {
    const response = await createApp().request(
      `http://localhost/${workspaceId}/social-connections/statistics/export?format=csv&publishedFrom=2026-10-01T00:00:00Z`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(await response.text()).toContain("platform,account,published_at");
    expect(mocks.export).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        publishedFrom: new Date("2026-10-01T00:00:00Z"),
      }),
    );
    expect(mocks.export.mock.calls[0][0].projectId).toBeUndefined();
  });
});

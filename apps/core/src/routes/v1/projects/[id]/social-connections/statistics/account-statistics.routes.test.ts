import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { emptySocialPerformanceHeadline } from "@/helpers/social-performance-headline";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mountRefresh from "../[connectionId]/statistics/refresh/post";
import mountExport from "./export/get";
import mountList from "./get";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  export: vi.fn(),
  schedule: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/social-account-statistics.service", () => ({
  listSocialAccountStatistics: mocks.list,
  exportSocialAccountStatistics: mocks.export,
}));
vi.mock("@/services/social-account-sync", () => ({
  scheduleSocialAccountRefresh: mocks.schedule,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: mocks.delegation,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: mocks.capability,
}));
const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
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
function createApp(actor = auth) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", actor);
    c.set("workspaceContext", workspace);
    await next();
  });
  mountList(app);
  mountExport(app);
  mountRefresh(app);
  return app;
}
function refreshRequest(body: unknown = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.capability.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
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
  mocks.schedule.mockResolvedValue({
    isErr: () => false,
    isOk: () => true,
    value: { connectionId, accepted: true, sync: { status: "queued" } },
  });
});
describe("social account statistics routes", () => {
  it("returns cached account data and scopes publication/account filters", async () => {
    const response = await createApp().request(
      `http://localhost/${projectId}/social-connections/statistics?connectionId=${connectionId}&provider=x&publishedFrom=2026-10-01T00:00:00Z&limit=5`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { accounts: [{ statistics: null, postCount: 0 }], posts: [] },
    });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        workspaceId,
        connectionId,
        provider: "x",
        publishedFrom: new Date("2026-10-01T00:00:00Z"),
        limit: 5,
      }),
    );
  });
  it("downloads the filtered post table as CSV", async () => {
    const response = await createApp().request(
      `http://localhost/${projectId}/social-connections/statistics/export?connectionId=${connectionId}&format=csv&publishedFrom=2026-10-01T00:00:00Z`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "performance-2026-10-01_latest.csv",
    );
    expect(await response.text()).toContain("platform,account,published_at");
    expect(mocks.export).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        workspaceId,
        connectionId,
        publishedFrom: new Date("2026-10-01T00:00:00Z"),
      }),
    );
  });
  it("queues a refresh without waiting on providers and rejects caller-supplied cursors", async () => {
    const app = createApp();
    const url = `http://localhost/${projectId}/social-connections/${connectionId}/statistics/refresh`;
    expect(
      (await app.request(url, refreshRequest({ continueHistory: true })))
        .status,
    ).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      connectionId,
      trigger: "manual",
    });
    mocks.schedule.mockClear();
    expect(
      (
        await app.request(
          url,
          refreshRequest({
            continueHistory: true,
            cursor: "https://provider.invalid/page",
          }),
        )
      ).status,
    ).toBe(422);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("rejects beta revocation before account reads or refreshes", async () => {
    mocks.beta.mockRejectedValue(forbidden("Social unavailable"));
    const app = createApp();
    expect(
      (
        await app.request(
          `http://localhost/${projectId}/social-connections/statistics`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          `http://localhost/${projectId}/social-connections/${connectionId}/statistics/refresh`,
          refreshRequest(),
        )
      ).status,
    ).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("allows a delegated Coworker and rejects a bare Coworker", async () => {
    const actor: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
      context: { userId: "owner", organizationId: null },
    };
    const app = createApp(actor);
    expect(
      (
        await app.request(
          `http://localhost/${projectId}/social-connections/statistics`,
        )
      ).status,
    ).toBe(403);
    mocks.delegation.mockResolvedValue({
      userId: "owner",
      organizationId: null,
    });
    expect(
      (
        await app.request(
          `http://localhost/${projectId}/social-connections/statistics`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `http://localhost/${projectId}/social-connections/${connectionId}/statistics/refresh`,
          refreshRequest(),
        )
      ).status,
    ).toBe(200);
    expect(mocks.capability).toHaveBeenCalledWith(
      "coworker",
      "tasks",
      expect.anything(),
    );
  });
  it("rejects bot REST actors and human API keys", async () => {
    const bot: AuthenticationContext = {
      actor: "sokoBot",
      sokoBotId: "bot",
      userId: "owner",
      workspaceId,
      organizationId: null,
    };
    for (const actor of [
      bot,
      { ...auth, authenticationMethod: "api_key" } as const,
    ]) {
      expect(
        (
          await createApp(actor).request(
            `http://localhost/${projectId}/social-connections/statistics`,
          )
        ).status,
      ).toBe(403);
    }
  });
  it("rejects reversed publication date ranges", async () => {
    const response = await createApp().request(
      `http://localhost/${projectId}/social-connections/statistics?publishedFrom=2026-10-08T00:00:00Z&publishedUntil=2026-10-01T00:00:00Z`,
    );
    expect(response.status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

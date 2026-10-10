import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import { socialPerformanceResponseSchema } from "@/schemas/social-performance.schema";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/social-performance.service", () => ({
  listSocialPerformance: mocks.list,
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
const metric = { total: null, mean: null, median: null, measuredPostCount: 0 };
const summary = {
  postCount: 0,
  measuredPostCount: 0,
  metrics: {
    views: metric,
    impressions: metric,
    likes: metric,
    comments: metric,
    shares: metric,
    saves: metric,
  },
  interactions: metric,
  engagementRates: [],
  additionalMetrics: [],
};
const result = socialPerformanceResponseSchema.parse({
  range: {
    publishedFrom: "2026-10-01T00:00:00Z",
    publishedUntil: "2026-10-07T23:59:59Z",
    previousFrom: "2026-09-24T00:00:00Z",
    previousUntil: "2026-09-30T23:59:59Z",
    timezone: "UTC",
    semantics: "lifetime_metrics_by_publication_cohort",
  },
  accounts: [],
  summary: {
    current: summary,
    previous: summary,
    deltas: {
      postCount: 0,
      views: null,
      impressions: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      interactions: null,
    },
  },
  daily: [],
  consistency: {
    from: null,
    until: null,
    selectedFrom: "2026-10-01",
    selectedUntil: "2026-10-07",
    daily: [],
  },
  comparisons: { accounts: [], providers: [], formats: [] },
  heatmap: {
    timezone: "UTC",
    comparisonProvider: null,
    postCount: 0,
    minimumSampleSize: 10,
    cells: [],
  },
  followers: [],
  observations: [],
  posts: [],
  baseline: {
    windowDays: 90,
    excludeRecentDays: 3,
    minimumSampleSize: 10,
    metric: "interactions",
    comparison: "same_account_median",
  },
  pagination: {
    limit: 100,
    offset: 0,
    nextOffset: null,
    total: 0,
    truncated: false,
  },
  coverage: {
    historyComplete: true,
    lastFetchedAt: null,
    missingPublicationDateCount: 0,
    historicalSnapshotsAvailable: false,
    unknownPostKindCount: 0,
    unknownContentTypeCount: 0,
  },
});
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
  mount(app);
  return app;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.capability.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
  mocks.list.mockResolvedValue(result);
});
describe("social performance routes", () => {
  it("applies workspace scope and validated search/format/ranking/timezone/paging filters", async () => {
    const response = await createApp().request(
      `http://localhost/${projectId}/social-connections/performance?connectionId=${connectionId}&provider=x&publishedFrom=2026-10-01T00:00:00Z&publishedUntil=2026-10-07T23:59:59Z&timezone=Europe%2FPrague&search=launch&contentType=image&sort=engagementRate&postKind=quotes&offset=100&limit=10`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        range: { semantics: "lifetime_metrics_by_publication_cohort" },
        posts: [],
      },
    });
    expect(mocks.list).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      connectionId,
      provider: "x",
      publishedFrom: "2026-10-01T00:00:00Z",
      publishedUntil: "2026-10-07T23:59:59Z",
      timezone: "Europe/Prague",
      search: "launch",
      contentType: "image",
      sort: "engagementRate",
      postKind: "quotes",
      offset: 100,
      limit: 10,
    });
  });
  it("rejects impossible dates, excessive periods, invalid timezones, and invalid pagination before reads", async () => {
    for (const query of [
      "publishedFrom=2026-10-07T00:00:00Z&publishedUntil=2026-10-01T00:00:00Z",
      "publishedFrom=2025-01-01T00:00:00Z&publishedUntil=2026-10-01T00:00:00Z",
      "timezone=invalid",
      "limit=101",
      "offset=-1",
    ]) {
      const response = await createApp().request(
        `http://localhost/${projectId}/social-connections/performance?${query}`,
      );
      expect(response.status).toBe(422);
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("enforces beta access before reading any performance cache", async () => {
    mocks.beta.mockRejectedValue(forbidden("Social unavailable"));
    expect(
      (
        await createApp().request(
          `http://localhost/${projectId}/social-connections/performance`,
        )
      ).status,
    ).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("requires delegated Coworker workspace authorization", async () => {
    const actor: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
      context: { userId: "owner", organizationId: null },
    };
    const app = createApp(actor);
    const url = `http://localhost/${projectId}/social-connections/performance`;
    expect((await app.request(url)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.delegation.mockResolvedValue({
      userId: "owner",
      organizationId: null,
    });
    expect((await app.request(url)).status).toBe(200);
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
            `http://localhost/${projectId}/social-connections/performance`,
          )
        ).status,
      ).toBe(403);
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("preserves not-found scope failures", async () => {
    mocks.list.mockRejectedValue(
      notFound("Project social connection not found"),
    );
    expect(
      (
        await createApp().request(
          `http://localhost/${projectId}/social-connections/performance`,
        )
      ).status,
    ).toBe(404);
  });
});

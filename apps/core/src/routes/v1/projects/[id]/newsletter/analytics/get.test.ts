import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountIssue from "../issues/[issueId]/analytics/get";
import mountGet from "./get";

const m = vi.hoisted(() => ({
  enabled: true,
  analytics: vi.fn(),
  issue: vi.fn(),
}));
vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: m.enabled }),
  };
});
vi.mock("@/services/newsletter-analytics.service", () => ({
  getNewsletterAnalytics: m.analytics,
  getNewsletterIssueAnalytics: m.issue,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const ISSUE_ID = "44444444-4444-4444-8444-444444444444";
const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: "user_1",
  organizationId: null,
};
const BASE = `/${PROJECT_ID}/newsletter`;
const TOTALS = {
  sent: 2,
  delivered: 2,
  uniqueOpens: 1,
  uniqueClicks: 0,
  unsubscribes: 0,
  bounces: 0,
  complaints: 0,
  openRate: 0.5,
  clickRate: 0,
  activeSubscribers: 2,
};

function app(
  auth: AuthenticationContext | null = AUTH,
  workspace: WorkspaceContext | null = WORKSPACE,
) {
  const router = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  router.use("*", async (c, next) => {
    if (!auth) throw unauthorized("Unauthorized");
    c.set("requestId", "analytics_test");
    c.set("authContext", auth);
    c.set("workspaceContext", workspace);
    await next();
  });
  mountGet(router);
  mountIssue(router);
  router.onError(errorHandler);
  return router;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.analytics.mockResolvedValue({
    from: "2026-10-01",
    to: "2026-10-02",
    totals: TOTALS,
    subscriberGrowth: [],
    engagement: [],
    issues: [],
    issuesPagination: { cursor: null, nextCursor: null, total: 0, limit: 20 },
  });
  m.issue.mockResolvedValue({ totals: TOTALS, topLinks: [] });
});

describe("newsletter analytics routes", () => {
  it("validates the response envelope and binds both endpoints to the workspace", async () => {
    const router = app();
    const response = await router.request(
      `${BASE}/analytics?from=2026-10-01&to=2026-10-02`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { totals: TOTALS },
      meta: { requestId: "analytics_test" },
    });
    expect(m.analytics).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID },
      { from: "2026-10-01", to: "2026-10-02", limit: 20 },
    );
    expect(
      (await router.request(`${BASE}/issues/${ISSUE_ID}/analytics`)).status,
    ).toBe(200);
    expect(m.issue).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID },
      ISSUE_ID,
    );
  });
  it("returns 404 before access or data work when disabled", async () => {
    m.enabled = false;
    for (const path of [
      `${BASE}/analytics`,
      `${BASE}/issues/${ISSUE_ID}/analytics`,
    ])
      expect((await app(AUTH, null).request(path)).status).toBe(404);
    expect(m.analytics).not.toHaveBeenCalled();
    expect(m.issue).not.toHaveBeenCalled();
  });
  it("requires authentication and a workspace for both endpoints", async () => {
    for (const path of [
      `${BASE}/analytics`,
      `${BASE}/issues/${ISSUE_ID}/analytics`,
    ]) {
      expect((await app(null).request(path)).status).toBe(401);
      expect((await app(AUTH, null).request(path)).status).toBe(403);
    }
    expect(m.analytics).not.toHaveBeenCalled();
    expect(m.issue).not.toHaveBeenCalled();
  });
  it("rejects coworkers without an authorized user context", async () => {
    const coworker: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: "vendor_1",
    };
    for (const path of [
      `${BASE}/analytics`,
      `${BASE}/issues/${ISSUE_ID}/analytics`,
    ])
      expect((await app(coworker).request(path)).status).toBe(403);
    expect(m.analytics).not.toHaveBeenCalled();
    expect(m.issue).not.toHaveBeenCalled();
  });
  it.each(["2026-02-30", "yesterday", "2026-10-01T00:00:00Z"])(
    "rejects malformed calendar dates: %s",
    async (from) => {
      expect(
        (await app().request(`${BASE}/analytics?from=${from}`)).status,
      ).toBe(422);
      expect(m.analytics).not.toHaveBeenCalled();
    },
  );
  it.each(["limit=101", "limit=0", "cursor=bad"])(
    "rejects invalid issue pagination: %s",
    async (query) => {
      expect((await app().request(`${BASE}/analytics?${query}`)).status).toBe(
        422,
      );
      expect(m.analytics).not.toHaveBeenCalled();
    },
  );
});

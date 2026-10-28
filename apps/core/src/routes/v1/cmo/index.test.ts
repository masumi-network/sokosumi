import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { approveMock, revertMock, overviewMock, mockPlanMock, strategyMock } =
  vi.hoisted(() => ({
    approveMock: vi.fn(),
    revertMock: vi.fn(),
    overviewMock: vi.fn(),
    mockPlanMock: vi.fn(),
    strategyMock: vi.fn(),
  }));

vi.mock("@/services/cmo-strategy.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-strategy.service")>();
  return {
    ...actual,
    approveCmoStrategy: approveMock,
    requestCmoStrategy: strategyMock,
  };
});
vi.mock("@/services/cmo-reports.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-reports.service")>();
  return { ...actual, revertCmoUpdate: revertMock };
});
vi.mock("@/services/cmo-overview.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-overview.service")>();
  return { ...actual, getCmoOverview: overviewMock };
});
vi.mock("@/services/cmo-billing.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-billing.service")>();
  return { ...actual, chooseCmoMockPlan: mockPlanMock };
});

import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
} from "@/services/cmo-cuso.service";
import { SokoBotTurnInProgressError } from "@/services/soko-bot-control-plane.service";

import cmoRouter from "./index";

const NOW = new Date("2026-10-05T09:00:00.000Z");

function overview() {
  return {
    hire: {
      id: "cmo-1",
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      goals: "More sales",
      workspaceId: "ws-1",
      sokoBotId: "bot-1",
      projectId: "project-1",
      brandBrainUpdatedAt: null,
      brandBrainApprovedAt: null,
      brandMedia: null,
      accountsDoneAt: NOW,
      mockPlanActivatedAt: null,
      onboardedAt: NOW,
      createdAt: NOW,
    },
    organizationSlug: null,
    projectName: "CMO.xyz · Acme",
    roomId: "room-1",
    subscriptionActive: false,
    viewerCanApprove: true,
    mockBilling: false,
    mockPlan: null,
    mockPlanActivatedAt: null,
    brandBrain: null,
    strategy: null,
    strategyVersions: [
      {
        id: "strategy-1",
        projectId: "project-1",
        createdAt: NOW,
        updatedAt: NOW,
        authorSokoBotId: "bot-1",
        authorUserId: null,
        turnId: "turn-1",
        approvedAt: NOW,
        approvedByUserId: "user-1",
      },
    ],
    media: [],
    botStatus: "IDLE",
    learning: "done",
    work: null,
    brandVisual: null,
    projectLogo: null,
    routines: [],
    updates: [
      {
        id: "u1",
        at: NOW.toISOString(),
        kind: "weekly",
        headline: "Week 1",
        done: [],
        upNext: [],
        changes: ["More LinkedIn"],
        results: "No provider metrics yet.",
        previousVersionId: "strategy-0",
      },
    ],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
    adProviders: [],
    connectAdsUrl: "http://web/ads?projectId=project-1",
    measurement: [],
    production: { state: "waiting", ready: 0, total: 0, finishedAt: null },
    mailingListSize: 0,
    subscribeUrl: "http://web/billing",
    billing: { plan: null, subscriptionStatus: null, availableCredits: 12 },
    posts: { DRAFT: 3, SCHEDULED: 1, PUBLISHING: 1, MISSED: 1 },
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "oauth",
    });
    return await next();
  });
  app.route("/", cmoRouter);
  return app;
}

describe("CMO routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewMock.mockResolvedValue(overview());
  });

  it("approves the strategy for the caller and returns the overview", async () => {
    approveMock.mockResolvedValue({});
    const response = await createApp().request("/strategy/approve", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith("user-1", undefined);
    const body = await response.json();
    expect(body.data.strategyVersion).toMatchObject({
      id: "strategy-1",
      approvedAt: NOW.toISOString(),
      approvedByUserId: "user-1",
    });
    expect(body.data.strategyVersion.turnId).toBeUndefined();
    expect(body.data.strategyVersions).toHaveLength(1);
    // The version id stays in Core; the card only learns it can revert.
    expect(body.data.updates[0]).toMatchObject({ revertible: true });
    expect(body.data.updates[0].previousVersionId).toBeUndefined();
    expect(body.data.posts).toEqual({
      draft: 3,
      scheduled: 2,
      published: 0,
      failed: 1,
    });
  });

  it("approves a named version, which reverts to it", async () => {
    approveMock.mockResolvedValue({});
    const versionId = "0196a000-0000-7000-8000-000000000001";
    const response = await createApp().request("/strategy/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    expect(response.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith("user-1", versionId);
  });

  it("answers 409 when there is nothing to approve", async () => {
    approveMock.mockRejectedValue(new CmoConflictError("No strategy"));
    const response = await createApp().request("/strategy/approve", {
      method: "POST",
    });
    expect(response.status).toBe(409);
  });

  it("answers 403 when a member who is not an owner or admin approves", async () => {
    approveMock.mockRejectedValue(
      new CmoForbiddenError("Only the organization's owners and admins"),
    );
    const response = await createApp().request("/strategy/approve", {
      method: "POST",
    });
    expect(response.status).toBe(403);
  });

  it("answers 409 when Cuso is already working on a turn", async () => {
    strategyMock.mockRejectedValue(
      new SokoBotTurnInProgressError("Soko Bot is already working"),
    );
    const response = await createApp().request("/strategy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(409);
  });

  it("activates a mock plan for the caller", async () => {
    mockPlanMock.mockResolvedValue(undefined);
    const response = await createApp().request("/mock-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "growth" }),
    });
    expect(response.status).toBe(200);
    expect(mockPlanMock).toHaveBeenCalledWith("user-1", "growth");
  });

  it("answers 409 for a mock plan when mock billing is off", async () => {
    mockPlanMock.mockRejectedValue(
      new CmoConflictError("Mock billing is off on this server"),
    );
    const response = await createApp().request("/mock-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "growth" }),
    });
    expect(response.status).toBe(409);
  });

  it("reverts a weekly update by id", async () => {
    revertMock.mockResolvedValue({});
    const response = await createApp().request("/updates/u1/revert", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(revertMock).toHaveBeenCalledWith({
      userId: "user-1",
      updateId: "u1",
    });
  });

  it("answers 404 when an update cannot be reverted", async () => {
    revertMock.mockRejectedValue(new CmoNotFoundError("Nothing to revert"));
    const response = await createApp().request("/updates/u9/revert", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { revertMock, overviewMock, mockPlanMock, strategyMock } = vi.hoisted(
  () => ({
    revertMock: vi.fn(),
    overviewMock: vi.fn(),
    mockPlanMock: vi.fn(),
    strategyMock: vi.fn(),
  }),
);

vi.mock("@/services/cmo-strategy.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-strategy.service")>();
  return {
    ...actual,
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
  CmoNotFoundError,
} from "@/services/cmo-cuso.service";
import { SokoBotTurnInProgressError } from "@/services/soko-bot-control-plane.service";

import cmoRouter from "./index";

const NOW = new Date("2026-10-05T09:00:00.000Z");
const REPORT_ID = "0196a000-0000-7000-8000-000000000001";

function overview() {
  return {
    cuso: {
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      goals: "More sales",
      workspaceId: "ws-1",
      sokoBotId: "bot-1",
      projectId: "project-1",
      brandBrainUpdatedAt: null,
      brandBrainConfirmedAt: null,
      createdAt: NOW,
    },
    onboardingStep: "done",
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
        authorTurnId: "turn-1",
        approvedAt: NOW,
        approvedByUserId: "user-1",
      },
    ],
    media: [],
    botStatus: "IDLE",
    learning: "done",
    work: null,
    brandVisual: null,
    brandMedia: null,
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
        versionId: "strategy-1",
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

  it("returns the overview of the caller's Cuso", async () => {
    const response = await createApp().request("/");
    expect(response.status).toBe(200);
    expect(overviewMock).toHaveBeenCalledWith("user-1");
    const body = await response.json();
    expect(body.data.strategyVersion).toMatchObject({
      id: "strategy-1",
      approvedAt: NOW.toISOString(),
      approvedByUserId: "user-1",
    });
    expect(body.data.strategyVersion.authorTurnId).toBeUndefined();
    expect(body.data.strategyVersions).toHaveLength(1);
    // The version id stays in Core; the card only learns it can revert.
    expect(body.data.updates[0]).toMatchObject({ revertible: true });
    expect(body.data.updates[0].previousVersionId).toBeUndefined();
    expect(body.data.updates[0].versionId).toBeUndefined();
    expect(body.data.posts).toEqual({
      draft: 3,
      scheduled: 2,
      published: 0,
      failed: 1,
    });
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

  it("reverts a weekly update by its report card's id", async () => {
    revertMock.mockResolvedValue(undefined);
    const response = await createApp().request(`/updates/${REPORT_ID}/revert`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(revertMock).toHaveBeenCalledWith({
      userId: "user-1",
      updateId: REPORT_ID,
    });
  });

  it("answers 422 for an id that is no report card", async () => {
    const response = await createApp().request("/updates/u1/revert", {
      method: "POST",
    });
    expect(response.status).toBe(422);
    expect(revertMock).not.toHaveBeenCalled();
  });

  it("answers 404 when an update cannot be reverted", async () => {
    revertMock.mockRejectedValue(new CmoNotFoundError("Nothing to revert"));
    const response = await createApp().request(`/updates/${REPORT_ID}/revert`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});

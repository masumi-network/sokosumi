import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { approveMock, revertMock, overviewMock, connectMock, mockPlanMock } =
  vi.hoisted(() => ({
    approveMock: vi.fn(),
    revertMock: vi.fn(),
    overviewMock: vi.fn(),
    connectMock: vi.fn(),
    mockPlanMock: vi.fn(),
  }));

vi.mock("@/services/cmo.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo.service")>();
  return {
    ...actual,
    approveCmoStrategy: approveMock,
    revertCmoUpdate: revertMock,
    getCmoOverview: overviewMock,
    connectCmoChannel: connectMock,
    chooseCmoMockPlan: mockPlanMock,
  };
});

import { ComposioConfigError } from "@/clients/composio.client";
import { CmoConflictError, CmoNotFoundError } from "@/services/cmo.service";

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
      strategyUpdatedAt: NOW,
      strategyApprovedAt: NOW,
      accountsDoneAt: NOW,
      mockPlanActivatedAt: null,
      onboardedAt: NOW,
      createdAt: NOW,
    },
    organizationSlug: null,
    projectName: "CMO.xyz · Acme",
    roomId: "room-1",
    subscriptionActive: false,
    mockBilling: false,
    mockPlan: null,
    mockPlanActivatedAt: null,
    brandBrain: null,
    strategy: null,
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
        previousStrategy: { month: "2026-10" },
      },
    ],
    channels: [],
    upNext: [],
    connectChannelUrl: "http://web/social?projectId=project-1",
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
    expect(approveMock).toHaveBeenCalledWith("user-1");
    const body = await response.json();
    expect(body.data.strategyApprovedAt).toBe(NOW.toISOString());
    // The stored snapshot never leaves Core; the card only learns it can revert.
    expect(body.data.updates[0]).toMatchObject({ revertible: true });
    expect(body.data.updates[0].previousStrategy).toBeUndefined();
    expect(body.data.posts).toEqual({
      draft: 3,
      scheduled: 2,
      published: 0,
      failed: 1,
    });
  });

  it("answers 409 when there is nothing to approve", async () => {
    approveMock.mockRejectedValue(new CmoConflictError("No strategy"));
    const response = await createApp().request("/strategy/approve", {
      method: "POST",
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

  it("starts connecting a network and returns where to send the founder", async () => {
    connectMock.mockResolvedValue({ redirectUrl: "https://connect.example/x" });
    const body = {
      provider: "x",
      callbackUrl: "https://app.cmo.xyz/connect/callback",
    };
    const response = await createApp().request("/channels/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(connectMock).toHaveBeenCalledWith({ userId: "user-1", ...body });
    expect((await response.json()).data.redirectUrl).toBe(
      "https://connect.example/x",
    );
  });

  it("answers 503 when the network is not set up on this server", async () => {
    connectMock.mockRejectedValue(
      new ComposioConfigError("missing auth config"),
    );
    const response = await createApp().request("/channels/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "linkedin",
        callbackUrl: "https://app.cmo.xyz/connect/callback",
      }),
    });
    expect(response.status).toBe(503);
  });
});

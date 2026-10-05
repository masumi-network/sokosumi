import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { approveMock, revertMock, overviewMock } = vi.hoisted(() => ({
  approveMock: vi.fn(),
  revertMock: vi.fn(),
  overviewMock: vi.fn(),
}));

vi.mock("@/services/cmo.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo.service")>();
  return {
    ...actual,
    approveCmoStrategy: approveMock,
    revertCmoUpdate: revertMock,
    getCmoOverview: overviewMock,
  };
});

import { CmoConflictError, CmoNotFoundError } from "@/services/cmo.service";

import cmoRouter from "./index";

const NOW = new Date("2026-10-05T09:00:00.000Z");

function overview() {
  return {
    workspace: {
      id: "cmo-1",
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      goals: "More sales",
      organizationId: "org-1",
      workspaceId: "ws-1",
      sokoBotId: "bot-1",
      projectId: "project-1",
      brandBrainUpdatedAt: null,
      strategyUpdatedAt: NOW,
      strategyApprovedAt: NOW,
      createdAt: NOW,
    },
    organizationSlug: "acme",
    roomId: "room-1",
    subscriptionActive: false,
    brandBrain: null,
    strategy: null,
    botStatus: "IDLE",
    learning: "done",
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

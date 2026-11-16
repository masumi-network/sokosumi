import { beforeEach, describe, expect, it, vi } from "vitest";

import { serviceUnavailable } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { revertMock, overviewMock, strategyMock } = vi.hoisted(() => ({
  revertMock: vi.fn(),
  overviewMock: vi.fn(),
  strategyMock: vi.fn(),
}));

const { archiveMock, hireMock, listMock, mayHireMock } = vi.hoisted(() => ({
  archiveMock: vi.fn(),
  hireMock: vi.fn(),
  listMock: vi.fn(),
  mayHireMock: vi.fn(),
}));

vi.mock("@/services/cmo-hiring.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-hiring.service")>();
  return {
    ...actual,
    startCmoOver: archiveMock,
    startCmoOnboarding: hireMock,
    mayHireCuso: mayHireMock,
  };
});

vi.mock("@/services/cmo-cuso.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/cmo-cuso.service")>();
  return { ...actual, listCusosForUser: listMock };
});

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

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
} from "@/services/cmo-cuso.service";
import { SokoBotTurnInProgressError } from "@/services/soko-bot-control-plane.service";

import cmoRouter from "./index";

const NOW = new Date("2026-10-05T09:00:00.000Z");
const REPORT_ID = "0196a000-0000-7000-8000-000000000001";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

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
    brandBrain: null,
    strategy: null,
    approvedStrategy: null,
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
    hiredAt: NOW,
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
    production: {
      state: "waiting",
      ready: 0,
      total: 0,
      written: 0,
      pictured: 0,
      needPictures: 0,
      finishedAt: null,
      pillars: null,
    },
    mailingListSize: 0,
    billing: {
      tier: null,
      interval: null,
      status: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      pendingTier: null,
      availableCredits: 12,
      viewerCanManage: false,
      hasTesterCredits: false,
      maySkipSubscription: false,
    },
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
      oauthClientId: "cmo-oauth-client",
    });
    return await next();
  });
  app.route("/", cmoRouter);
  app.onError(errorHandler);
  return app;
}

describe("CMO routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewMock.mockResolvedValue(overview());
  });

  it("lists every Cuso the caller can use, newest first, as Core ordered them", async () => {
    const hired = new Date("2026-10-01T09:00:00.000Z");
    listMock.mockResolvedValue([
      {
        projectId: PROJECT_ID,
        businessName: "acme.io",
        websiteUrl: "https://acme.io",
        projectLogo: null,
        organizationId: "org-1",
        organizationName: "Agency",
        hiring: true,
        createdAt: NOW,
      },
      {
        projectId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
        businessName: "beta.io",
        websiteUrl: "https://beta.io",
        projectLogo: "https://beta.io/icon.png",
        organizationId: "org-1",
        organizationName: "Agency",
        hiring: false,
        createdAt: hired,
      },
    ]);
    mayHireMock.mockResolvedValue(true);
    const response = await createApp().request("/cusos");
    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith("user-1");
    const { data } = await response.json();
    expect(data.mayHire).toBe(true);
    expect(
      data.cusos.map((cuso: { businessName: string }) => cuso.businessName),
    ).toEqual(["acme.io", "beta.io"]);
    expect(data.cusos[1]).toEqual({
      projectId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
      businessName: "beta.io",
      websiteUrl: "https://beta.io",
      projectLogo: "https://beta.io/icon.png",
      organizationId: "org-1",
      organizationName: "Agency",
      hiring: false,
      createdAt: hired.toISOString(),
    });
  });

  it("says the caller may not hire when they are not on the allowlist", async () => {
    listMock.mockResolvedValue([]);
    mayHireMock.mockResolvedValue(false);
    const response = await createApp().request("/cusos");
    expect(response.status).toBe(200);
    expect(mayHireMock).toHaveBeenCalledWith("user-1");
    expect((await response.json()).data).toEqual({ cusos: [], mayHire: false });
  });

  it("still lists and opens the Cusos of a person who may not hire, such as one with an unverified email", async () => {
    listMock.mockResolvedValue([
      {
        projectId: PROJECT_ID,
        businessName: "acme.io",
        websiteUrl: "https://acme.io",
        projectLogo: null,
        organizationId: "org-1",
        organizationName: "Acme",
        hiring: false,
        createdAt: NOW,
      },
    ]);
    mayHireMock.mockResolvedValue(false);
    const list = await createApp().request("/cusos");
    const { data } = await list.json();
    expect(data.mayHire).toBe(false);
    expect(
      data.cusos.map((cuso: { projectId: string }) => cuso.projectId),
    ).toEqual([PROJECT_ID]);

    const opened = await createApp().request(`/projects/${PROJECT_ID}`);
    expect(opened.status).toBe(200);
  });

  it("no longer opens a default Cuso for the caller", async () => {
    const response = await createApp().request("/");
    expect(response.status).toBe(404);
    expect(overviewMock).not.toHaveBeenCalled();
  });

  it.each([
    ["into a new organization", {}],
    ["into the organization the body names", { organizationId: "org-team" }],
  ])("hires Cuso %s and answers his overview", async (_label, where) => {
    hireMock.mockResolvedValue({ projectId: PROJECT_ID });
    const response = await createApp().request("/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: "https://acme.io", ...where }),
    });
    expect(response.status).toBe(201);
    expect(hireMock).toHaveBeenCalledWith({
      userId: "user-1",
      websiteUrl: "https://acme.io",
      ...where,
    });
    expect(overviewMock).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT_ID,
    });
  });

  it.each([
    [
      "not being on the allowlist",
      new CmoForbiddenError(
        "CMO is invite-only for now",
        CORE_API_ERROR_KINDS.CMO_HIRE_NOT_ALLOWED,
      ),
      403,
      CORE_API_ERROR_KINDS.CMO_HIRE_NOT_ALLOWED,
    ],
    [
      "no Seat",
      new CmoForbiddenError(
        "You need a Seat",
        CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED,
      ),
      403,
      CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED,
    ],
    [
      "the organization limit",
      APIError.from("FORBIDDEN", {
        code: "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS",
        message: "You have reached the maximum number of organizations",
      }),
      403,
      CORE_API_ERROR_KINDS.ORGANIZATION_LIMIT_REACHED,
    ],
  ])("declares a hire refused for %s", async (_label, error, status, kind) => {
    hireMock.mockRejectedValue(error);
    const response = await createApp().request("/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: "https://acme.io" }),
    });
    expect(response.status).toBe(status);
    expect((await response.json()).kind).toBe(kind);
  });

  it("names the unpaid Cuso when a second unpaid hire is refused", async () => {
    const unpaidCuso = { projectId: PROJECT_ID, businessName: "old.io" };
    hireMock.mockRejectedValue(
      new CmoConflictError(
        "Your Cuso for old.io is not subscribed yet.",
        CORE_API_ERROR_KINDS.CMO_UNPAID_CUSO,
        { unpaidCuso },
      ),
    );
    const response = await createApp().request("/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: "https://acme.io" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.CMO_UNPAID_CUSO,
      unpaidCuso,
    });
  });

  it("returns the overview of the Cuso of the Project the path names, as CMO reads it", async () => {
    const response = await createApp().request(`/projects/${PROJECT_ID}`);
    expect(response.status).toBe(200);
    expect(overviewMock).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT_ID,
    });
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

  it("returns the Cuso's CMO subscription and credits in the billing block", async () => {
    const base = overview();
    overviewMock.mockResolvedValue({
      ...base,
      billing: {
        ...base.billing,
        tier: "growth",
        interval: "month",
        status: "past_due",
        periodEnd: new Date("2026-11-05T09:00:00.000Z"),
      },
    });
    const response = await createApp().request(`/projects/${PROJECT_ID}`);

    expect((await response.json()).data.billing).toEqual({
      tier: "growth",
      interval: "month",
      status: "past_due",
      periodEnd: "2026-11-05T09:00:00.000Z",
      cancelAtPeriodEnd: false,
      pendingTier: null,
      availableCredits: 12,
      viewerCanManage: false,
      hasTesterCredits: false,
      maySkipSubscription: false,
    });
  });

  it("carries no link to Sokosumi's billing page in the overview", async () => {
    const response = await createApp().request(`/projects/${PROJECT_ID}`);
    const body = await response.json();
    expect(body.data.billing).toBeDefined();
    expect(JSON.stringify(body.data)).not.toContain("/billing");
    expect(body.data).not.toHaveProperty("subscribeUrl");
  });

  it("answers 409 when Cuso is already working on a turn", async () => {
    strategyMock.mockRejectedValue(
      new SokoBotTurnInProgressError("Soko Bot is already working"),
    );
    const response = await createApp().request(
      `/projects/${PROJECT_ID}/strategy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(409);
  });

  it("archives the named Cuso on starting over and names no next one", async () => {
    archiveMock.mockResolvedValue(undefined);
    const response = await createApp().request(
      `/projects/${PROJECT_ID}/start-over`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(archiveMock).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT_ID,
    });
    expect((await response.json()).data).toEqual({ startedOver: true });
  });

  it("tells the person when the subscription could not be ended on starting over", async () => {
    archiveMock.mockRejectedValue(
      serviceUnavailable(
        "The subscription could not be ended. Nothing was changed. Try again later.",
      ),
    );
    const response = await createApp().request(
      `/projects/${PROJECT_ID}/start-over`,
      { method: "POST" },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).message).toBe(
      "The subscription could not be ended. Nothing was changed. Try again later.",
    );
  });

  it("reverts an update of the named Project's Cuso and returns his overview", async () => {
    revertMock.mockResolvedValue(undefined);
    const response = await createApp().request(
      `/projects/${PROJECT_ID}/updates/${REPORT_ID}/revert`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(revertMock).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT_ID,
      updateId: REPORT_ID,
    });
    expect(overviewMock).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT_ID,
    });
  });

  it("answers the checkout step and no plan for a Cuso nobody paid for", async () => {
    overviewMock.mockResolvedValue({
      ...overview(),
      onboardingStep: "checkout",
    });
    const response = await createApp().request(`/projects/${PROJECT_ID}`);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.onboardingStep).toBe("checkout");
    expect(data.billing).toEqual({
      tier: null,
      interval: null,
      status: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      pendingTier: null,
      availableCredits: 12,
      viewerCanManage: false,
      hasTesterCredits: false,
      maySkipSubscription: false,
    });
  });

  it("answers the plan, its period and who may manage it once subscribed", async () => {
    const base = overview();
    overviewMock.mockResolvedValue({
      ...base,
      billing: {
        ...base.billing,
        tier: "growth",
        interval: "year",
        status: "active",
        periodEnd: new Date("2027-11-13T10:00:00.000Z"),
        cancelAtPeriodEnd: true,
        pendingTier: "starter",
        availableCredits: 25_000,
        viewerCanManage: true,
      },
    });
    const response = await createApp().request(`/projects/${PROJECT_ID}`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.billing).toEqual({
      tier: "growth",
      interval: "year",
      status: "active",
      periodEnd: "2027-11-13T10:00:00.000Z",
      cancelAtPeriodEnd: true,
      pendingTier: "starter",
      availableCredits: 25_000,
      viewerCanManage: true,
      hasTesterCredits: false,
      maySkipSubscription: false,
    });
  });

  it("answers 422 for a Project id that is no uuid", async () => {
    const response = await createApp().request("/projects/project-1");
    expect(response.status).toBe(422);
    expect(overviewMock).not.toHaveBeenCalled();
  });

  it("answers 422 for an id that is no report card", async () => {
    const response = await createApp().request(
      `/projects/${PROJECT_ID}/updates/u1/revert`,
      { method: "POST" },
    );
    expect(response.status).toBe(422);
    expect(revertMock).not.toHaveBeenCalled();
  });

  it("answers 404 when an update cannot be reverted", async () => {
    revertMock.mockRejectedValue(new CmoNotFoundError("Nothing to revert"));
    const response = await createApp().request(
      `/projects/${PROJECT_ID}/updates/${REPORT_ID}/revert`,
      { method: "POST" },
    );
    expect(response.status).toBe(404);
  });
});

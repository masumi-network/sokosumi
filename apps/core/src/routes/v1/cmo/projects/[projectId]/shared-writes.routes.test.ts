import type { MarketingStrategy } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { PROJECT_ID, WORKSPACE_ID, AT } = vi.hoisted(() => ({
  PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  WORKSPACE_ID: "22222222-2222-4222-8222-222222222222",
  AT: new Date("2026-11-01T10:00:00Z"),
}));
const STRATEGY_ID = "33333333-3333-4333-8333-333333333333";
const CONNECTION_ID = "44444444-4444-4444-8444-444444444444";

const m = vi.hoisted(() => ({
  /** `userId:organizationId` → role, for the organization's members. */
  members: new Map<string, string>(),
  hasCuso: true,
  saveBrandBrain: vi.fn(),
  getBrandBrain: vi.fn(),
  confirmBrandBrain: vi.fn(),
  answerBrandBrainQuestion: vi.fn(),
  answerMarketingStrategyQuestion: vi.fn(),
  strategyFindFirst: vi.fn(),
  startCmoProductionForProject: vi.fn(),
  initiateProjectSocialConnection: vi.fn(),
  finalizeProjectSocialConnection: vi.fn(),
  scheduleSocialAccountRefresh: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const workspace = {
    id: WORKSPACE_ID,
    userId: null,
    organizationId: "org-1",
  };
  const project = { id: PROJECT_ID, workspaceId: WORKSPACE_ID, workspace };
  const client: Record<string, unknown> = {
    project: {
      // Cuso's access check, then the approver check.
      findUnique: async () => project,
      findFirst: async () => project,
    },
    member: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organizationId?: string };
      }) => {
        const role = m.members.get(`${where.userId}:org-1`);
        return role ? { id: "member", role } : null;
      },
    },
    sokoBot: {
      findFirst: async () =>
        m.hasCuso
          ? {
              id: "bot-1",
              createdAt: AT,
              project: {
                id: PROJECT_ID,
                workspaceId: WORKSPACE_ID,
                websiteUrl: "https://acme.example",
                workspace: { organizationId: "org-1" },
                brandBrain: null,
              },
            }
          : null,
    },
    sokoBotTurn: { findFirst: async () => null },
    marketingStrategy: { findFirst: m.strategyFindFirst },
    $executeRaw: async () => 1,
  };
  client.$transaction = (callback: (tx: unknown) => unknown) =>
    callback(client);
  return { default: client };
});

vi.mock("@/services/brand-brain.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/brand-brain.service")>()),
  saveBrandBrain: m.saveBrandBrain,
  getBrandBrain: m.getBrandBrain,
  confirmBrandBrain: m.confirmBrandBrain,
  answerBrandBrainQuestion: m.answerBrandBrainQuestion,
}));
// Approving stays real: its owner-or-admin check is what the tests prove.
vi.mock("@/services/marketing-strategy.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/marketing-strategy.service")
  >()),
  answerMarketingStrategyQuestion: m.answerMarketingStrategyQuestion,
}));
vi.mock("@/services/cmo-cuso.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cmo-cuso.service")>()),
  startCmoProductionForProject: m.startCmoProductionForProject,
}));
vi.mock("@/services/project-social-connections.service", () => ({
  initiateProjectSocialConnection: m.initiateProjectSocialConnection,
  finalizeProjectSocialConnection: m.finalizeProjectSocialConnection,
}));
vi.mock("@/services/social-account-sync", () => ({
  scheduleSocialAccountRefresh: m.scheduleSocialAccountRefresh,
}));

import cmoRouter from "../../index";

/** CMO's Sign in with Sokosumi token: OAuth from a first-party client. */
const CMO_TOKEN: AuthenticationContext = {
  actor: "user",
  userId: "user-1",
  organizationId: null,
  role: "user",
  authenticationMethod: "oauth",
  firstPartyClient: true,
};

function createApp(auth: AuthenticationContext = CMO_TOKEN) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    return await next();
  });
  app.route("/", cmoRouter);
  app.onError(errorHandler);
  return app;
}

function strategyVersion(): MarketingStrategy {
  return {
    id: STRATEGY_ID,
    projectId: PROJECT_ID,
    createdAt: AT,
    updatedAt: AT,
    plan: {
      month: "2026-11",
      summary: "Founder-led posts.",
      goals: ["More demos"],
      pillars: ["Product stories"],
      channels: [{ channel: "linkedin", cadence: "3 a week" }],
      calendar: [],
      questions: [],
    },
    authorSokoBotId: "bot-1",
    authorUserId: null,
    authorTurnId: null,
    approvedAt: AT,
    approvedByUserId: "user-1",
    monthReview: null,
  };
}

const BASE = `/projects/${PROJECT_ID}`;
const ANSWER = { questionId: "q1", answer: "yes" };

/** Each new route, with a body it accepts and the service it reaches. */
const WRITES = [
  {
    name: "Brand Brain update",
    method: "PUT",
    path: `${BASE}/brand-brain`,
    body: {
      brandBrain: {
        summary: "Acme sells rockets.",
        voice: { tone: "Direct", do: [], dont: [], examples: [] },
        audience: ["Founders"],
        products: ["Rockets"],
        competitors: [],
        channels: [],
        questions: [],
      },
    },
    status: 200,
    reaches: m.saveBrandBrain,
  },
  {
    name: "Brand Brain confirm",
    method: "POST",
    path: `${BASE}/brand-brain/confirm`,
    status: 200,
    reaches: m.confirmBrandBrain,
  },
  {
    name: "Brand Brain answer",
    method: "POST",
    path: `${BASE}/brand-brain/answers`,
    body: ANSWER,
    status: 200,
    reaches: m.answerBrandBrainQuestion,
  },
  {
    name: "strategy approve",
    method: "POST",
    path: `${BASE}/marketing-strategies/${STRATEGY_ID}/approve`,
    status: 200,
    reaches: m.startCmoProductionForProject,
  },
  {
    name: "strategy answer",
    method: "POST",
    path: `${BASE}/marketing-strategies/${STRATEGY_ID}/answers`,
    body: ANSWER,
    status: 200,
    reaches: m.answerMarketingStrategyQuestion,
  },
  {
    name: "social connection initiate",
    method: "POST",
    path: `${BASE}/social-connections/initiate`,
    body: { action: "connect", provider: "x" },
    status: 201,
    reaches: m.initiateProjectSocialConnection,
  },
  {
    name: "social connection finalize",
    method: "POST",
    path: `${BASE}/social-connections/finalize`,
    body: { connectionId: "ca_123" },
    status: 201,
    reaches: m.finalizeProjectSocialConnection,
  },
] as const;

function named(name: (typeof WRITES)[number]["name"]) {
  const found = WRITES.find((entry) => entry.name === name);
  if (!found) throw new Error(`No write named ${name}`);
  return found;
}

function send(
  write: (typeof WRITES)[number],
  auth: AuthenticationContext = CMO_TOKEN,
) {
  return createApp(auth).request(write.path, {
    method: write.method,
    headers: { "Content-Type": "application/json" },
    body: "body" in write ? JSON.stringify(write.body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.members.clear();
  m.members.set("user-1:org-1", "admin");
  m.hasCuso = true;
  m.getBrandBrain.mockResolvedValue(null);
  m.confirmBrandBrain.mockResolvedValue(null);
  m.strategyFindFirst.mockResolvedValue(strategyVersion());
  m.answerMarketingStrategyQuestion.mockResolvedValue(strategyVersion());
  m.initiateProjectSocialConnection.mockResolvedValue({
    connectionId: "ca_123",
    redirectUrl: "https://connect.composio.dev/link-token",
  });
  m.finalizeProjectSocialConnection.mockResolvedValue({
    id: CONNECTION_ID,
    provider: "x",
    externalHandle: "acme",
    displayName: "Acme",
    subscriptionType: null,
    avatarUrl: null,
    status: "active",
    connectedAt: AT,
    disconnectedAt: null,
  });
  m.scheduleSocialAccountRefresh.mockResolvedValue(undefined);
});

describe("CMO's own routes for its writes on the Cuso's Project", () => {
  describe.each(WRITES)("$name", (write) => {
    it("works for a member of the Cuso's organization", async () => {
      const response = await send(write);
      expect(response.status).toBe(write.status);
      expect(write.reaches).toHaveBeenCalled();
    });

    it("answers 404 to a person outside the organization", async () => {
      m.members.clear();
      const response = await send(write);
      expect(response.status).toBe(404);
      expect(write.reaches).not.toHaveBeenCalled();
    });

    it("answers 404 for a Project without a live Cuso", async () => {
      m.hasCuso = false;
      const response = await send(write);
      expect(response.status).toBe(404);
      expect(write.reaches).not.toHaveBeenCalled();
    });
  });

  it("acts on the Cuso's Project and workspace, with no organization header", async () => {
    await send(named("social connection initiate"));
    expect(m.initiateProjectSocialConnection).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: "user-1",
      action: "connect",
      provider: "x",
    });
  });

  it("lets a plain member answer the strategy but not approve it (ADR 0061)", async () => {
    m.members.set("user-1:org-1", "member");
    const approve = await send(named("strategy approve"));
    expect(approve.status).toBe(403);
    expect(m.startCmoProductionForProject).not.toHaveBeenCalled();

    const answer = await send(named("strategy answer"));
    expect(answer.status).toBe(200);
  });

  it("refuses a coworker on every write, as every /v1/cmo route does", async () => {
    const coworker: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker-1",
      vendorId: "vendor-1",
    };
    for (const write of WRITES) {
      const response = await send(write, coworker);
      expect(response.status, write.name).toBe(403);
    }
  });

  it("keeps social connections to a session or a first-party app's token", async () => {
    const otherApp: AuthenticationContext = {
      ...CMO_TOKEN,
      firstPartyClient: false,
    };
    for (const write of [
      named("social connection initiate"),
      named("social connection finalize"),
    ]) {
      const response = await send(write, otherApp);
      expect(response.status, write.name).toBe(403);
    }
    expect(m.initiateProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("refuses a return address outside the first-party apps", async () => {
    const response = await createApp().request(
      `${BASE}/social-connections/initiate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          provider: "x",
          callbackUrl: "https://evil.example/callback",
        }),
      },
    );
    expect(response.status).toBe(422);
  });
});

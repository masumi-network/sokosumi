import { OpenAPIHono } from "@hono/zod-openapi";
import type { MarketingStrategy } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountAnswer from "./[strategyId]/answers/post";
import mountApprove from "./[strategyId]/approve/post";
import mountGet from "./[strategyId]/get";
import mountList from "./get";
import mountCreate from "./post";

const m = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  strategyFindMany: vi.fn(),
  strategyCount: vi.fn(),
  strategyCreate: vi.fn(),
  strategyFindFirst: vi.fn(),
  strategyUpdate: vi.fn(),
  strategyUpdateMany: vi.fn(),
  memberFindFirst: vi.fn(),
  turnFindFirst: vi.fn(),
  eventFindFirst: vi.fn(),
  executeRaw: vi.fn(async () => 1),
  postFindMany: vi.fn(),
  postCreateMany: vi.fn(),
  postUpdateMany: vi.fn(),
  connectionFindMany: vi.fn(),
  scheduleFindFirst: vi.fn(),
  sokoBotFindFirst: vi.fn(),
  kickCmoProduction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client: Record<string, unknown> = {
    project: { findFirst: m.projectFindFirst },
    marketingStrategy: {
      findMany: m.strategyFindMany,
      count: m.strategyCount,
      create: m.strategyCreate,
      findFirst: m.strategyFindFirst,
      update: m.strategyUpdate,
      updateMany: m.strategyUpdateMany,
    },
    member: { findFirst: m.memberFindFirst },
    socialPost: {
      findMany: m.postFindMany,
      createMany: m.postCreateMany,
      updateMany: m.postUpdateMany,
    },
    projectSocialConnection: { findMany: m.connectionFindMany },
    sokoBotSchedule: { findFirst: m.scheduleFindFirst },
    sokoBot: { findFirst: m.sokoBotFindFirst },
    sokoBotTurn: { findFirst: m.turnFindFirst },
    sokoBotRuntimeEvent: { findFirst: m.eventFindFirst },
    $executeRaw: m.executeRaw,
  };
  client.$transaction = (callback: (tx: unknown) => unknown) =>
    callback(client);
  return { default: client };
});
vi.mock("@/services/cmo-production.service", () => ({
  kickCmoProduction: m.kickCmoProduction,
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { expireTurn: vi.fn(async () => true) },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OLD_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "44444444-4444-4444-8444-444444444444";
const AT = new Date("2026-10-28T10:00:00Z");
const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: "organization_1",
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: null,
  organizationId: "organization_1",
};
const PLAN = {
  month: "2026-11",
  summary: "Founder-led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week" }],
  calendar: [],
  questions: [
    {
      id: "q1",
      question: "Do most buyers find you on LinkedIn?",
      statement: "Buyers find the business on LinkedIn.",
    },
  ],
};

function version(
  id: string,
  approvedAt: Date | null = null,
  plan: unknown = PLAN,
): MarketingStrategy {
  return {
    id,
    projectId: PROJECT_ID,
    createdAt: AT,
    updatedAt: AT,
    plan: plan as MarketingStrategy["plan"],
    authorSokoBotId: "55555555-5555-4555-8555-555555555555",
    authorUserId: null,
    authorTurnId: "66666666-6666-4666-8666-666666666666",
    approvedAt,
    approvedByUserId: approvedAt ? "user_0" : null,
  };
}

function createApp(workspace: WorkspaceContext = WORKSPACE) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "marketing_strategy_test");
    c.set("isAuthenticated", true);
    c.set("authContext", AUTH);
    c.set("workspaceContext", workspace);
    await next();
  });
  mountList(app);
  mountCreate(app);
  mountGet(app);
  mountApprove(app);
  mountAnswer(app);
  app.onError(errorHandler);
  return app;
}

const BASE = `http://localhost/${PROJECT_ID}/marketing-strategies`;
const post = (path: string, body?: unknown) =>
  createApp().request(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** The Project as access checks and approval read it. */
function projectRow(
  workspace = {
    userId: null as string | null,
    organizationId: "organization_1" as string | null,
  },
) {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspace: { id: WORKSPACE_ID, ...workspace },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.projectFindFirst.mockResolvedValue(projectRow());
  m.memberFindFirst.mockResolvedValue({ role: "admin" });
  m.turnFindFirst.mockResolvedValue(null);
  m.postFindMany.mockResolvedValue([]);
  m.connectionFindMany.mockResolvedValue([]);
  m.scheduleFindFirst.mockResolvedValue(null);
  m.sokoBotFindFirst.mockResolvedValue(null);
  m.strategyUpdate.mockImplementation(
    async (args: { where: { id: string }; data: object }) => ({
      ...version(args.where.id),
      ...args.data,
    }),
  );
});

describe("Marketing strategy routes", () => {
  it("lists every version newest first, without plans", async () => {
    const { plan: _plan, ...listed } = version(NEW_ID);
    m.strategyFindMany.mockResolvedValue([listed]);
    m.strategyCount.mockResolvedValue(1);

    const response = await createApp().request(BASE);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toEqual([
      expect.objectContaining({ id: NEW_ID, approvedAt: null }),
    ]);
    expect(body.data[0]).not.toHaveProperty("plan");
    expect(body.data[0]).not.toHaveProperty("authorTurnId");
    expect(m.strategyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: PROJECT_ID } }),
    );
  });

  it("lists versions a page at a time", async () => {
    const { plan: _new, ...newest } = version(NEW_ID);
    const { plan: _old, ...older } = version(OLD_ID);
    m.strategyFindMany.mockResolvedValue([newest, older]);
    m.strategyCount.mockResolvedValue(3);

    const response = await createApp().request(`${BASE}?limit=1`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string }[];
      meta: { pagination: { nextCursor: string | null; total: number } };
    };
    expect(body.data.map((item) => item.id)).toEqual([NEW_ID]);
    expect(body.meta.pagination).toMatchObject({
      nextCursor: NEW_ID,
      total: 3,
    });

    m.strategyFindMany.mockResolvedValue([older]);
    await createApp().request(`${BASE}?limit=1&cursor=${NEW_ID}`);
    expect(m.strategyFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 2, skip: 1, cursor: { id: NEW_ID } }),
    );
  });

  it("writes a version as the member who sent it, unapproved", async () => {
    m.strategyCreate.mockImplementation(
      async (args: { data: Partial<MarketingStrategy> }) => ({
        ...version(NEW_ID),
        authorSokoBotId: null,
        authorTurnId: null,
        ...args.data,
      }),
    );

    const response = await createApp().request(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: PLAN }),
    });

    expect(response.status).toBe(201);
    expect(m.strategyCreate).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        authorUserId: "user_1",
        plan: expect.objectContaining({ summary: PLAN.summary }),
      },
    });
    const body = (await response.json()) as {
      data: { authorUserId: string; approvedAt: null };
    };
    expect(body.data).toMatchObject({
      authorUserId: "user_1",
      approvedAt: null,
    });
  });

  it("is not found for a Project outside the member's Workspace", async () => {
    m.projectFindFirst.mockResolvedValue(null);

    const response = await createApp().request(BASE);

    expect(response.status).toBe(404);
  });

  it("is not found for someone no longer a member of the Workspace", async () => {
    m.memberFindFirst.mockResolvedValue(null);

    const response = await createApp().request(BASE);

    expect(response.status).toBe(404);
    expect(m.strategyFindMany).not.toHaveBeenCalled();
  });

  it("reads one version with its plan", async () => {
    m.strategyFindFirst.mockResolvedValue(version(OLD_ID, AT));

    const response = await createApp().request(`${BASE}/${OLD_ID}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { plan: { summary: string }; approvedByUserId: string };
    };
    expect(body.data.plan.summary).toBe(PLAN.summary);
    expect(body.data.approvedByUserId).toBe("user_0");
  });

  it("approves a version for an admin and withdraws the other approval", async () => {
    m.strategyFindFirst.mockResolvedValue(version(NEW_ID));

    const response = await post(`${NEW_ID}/approve`);

    expect(response.status).toBe(200);
    expect(m.strategyUpdateMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, approvedAt: { not: null } },
      data: { approvedAt: null, approvedByUserId: null },
    });
    expect(m.strategyUpdate).toHaveBeenCalledWith({
      where: { id: NEW_ID },
      data: { approvedAt: expect.any(Date), approvedByUserId: "user_1" },
    });
    expect(m.kickCmoProduction).not.toHaveBeenCalled();
  });

  it("has the Project's Cuso make the approved month", async () => {
    m.strategyFindFirst.mockResolvedValue(version(NEW_ID));
    m.sokoBotFindFirst.mockResolvedValue({ id: "cuso-bot" });

    const response = await post(`${NEW_ID}/approve`);

    expect(response.status).toBe(200);
    expect(m.kickCmoProduction).toHaveBeenCalledWith("cuso-bot");
  });

  it("turns the approved calendar into draft Social posts and cancels the old plan's", async () => {
    const author = "55555555-5555-4555-8555-555555555555";
    m.strategyFindFirst.mockResolvedValue(
      version(NEW_ID, null, {
        ...PLAN,
        calendar: [
          {
            id: "li-1",
            date: "2099-11-03",
            time: "09:30",
            channel: "linkedin",
            format: "text",
            title: "Setup in ten minutes",
            brief: "Show the setup end to end.",
            why: "Proves the product is quick.",
            approach: "educational",
            campaignId: "launch",
            status: "idea",
          },
          {
            id: "x-1",
            date: "2099-11-04",
            channel: "x",
            format: "text",
            title: "Launch day",
            draft: "We launch today.",
            status: "draft",
          },
          // Not a social network, already past, or left out: no post.
          {
            id: "nl-1",
            date: "2099-11-05",
            channel: "newsletter",
            format: "issue",
            title: "November issue",
            status: "idea",
          },
          {
            id: "li-old",
            date: "2020-01-01",
            channel: "linkedin",
            format: "text",
            title: "Old",
            status: "idea",
          },
          {
            id: "li-skip",
            date: "2099-11-06",
            channel: "linkedin",
            format: "text",
            title: "Skipped",
            status: "skipped",
          },
        ],
      }),
    );
    m.connectionFindMany.mockResolvedValue([
      { id: "conn-li", provider: "linkedin" },
    ]);
    m.scheduleFindFirst.mockResolvedValue({ timezone: "Europe/Zurich" });

    const response = await post(`${NEW_ID}/approve`);

    expect(response.status).toBe(200);
    // Two plans never publish side by side: the old version's unpublished posts go.
    expect(m.postUpdateMany).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
        marketingStrategy: { id: { not: NEW_ID } },
      },
      data: {
        status: "CANCELED",
        canceledAt: expect.any(Date),
        revision: { increment: 1 },
      },
    });
    expect(m.postCreateMany).toHaveBeenCalledWith({
      data: [
        {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          marketingStrategyId: NEW_ID,
          provider: "linkedin",
          socialConnectionId: "conn-li",
          text: "Show the setup end to end.",
          status: "DRAFT",
          scheduledAt: new Date("2099-11-03T08:30:00Z"),
          timezone: "Europe/Zurich",
          creatorSokoBotId: author,
          planning: {
            id: "li-1",
            title: "Setup in ten minutes",
            format: "text",
            brief: "Show the setup end to end.",
            why: "Proves the product is quick.",
            approach: "educational",
            campaignId: "launch",
          },
        },
        expect.objectContaining({
          provider: "x",
          socialConnectionId: null,
          text: "We launch today.",
          planning: { id: "x-1", title: "Launch day", format: "text" },
        }),
      ],
    });
  });

  it("reverts by approving an older version", async () => {
    m.strategyFindFirst.mockResolvedValue(version(OLD_ID));

    const response = await post(`${OLD_ID}/approve`);

    expect(response.status).toBe(200);
    expect(m.strategyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OLD_ID } }),
    );
  });

  it("refuses a member who is neither owner nor admin", async () => {
    m.memberFindFirst.mockResolvedValue({ role: "member" });

    const response = await post(`${NEW_ID}/approve`);

    expect(response.status).toBe(403);
    expect(m.strategyUpdate).not.toHaveBeenCalled();
  });

  it("lets a personal Workspace's owner approve", async () => {
    m.projectFindFirst.mockResolvedValue(
      projectRow({ userId: "user_1", organizationId: null }),
    );
    m.strategyFindFirst.mockResolvedValue(version(NEW_ID));

    const response = await createApp({
      workspaceId: WORKSPACE_ID,
      userId: "user_1",
      organizationId: null,
    }).request(`${BASE}/${NEW_ID}/approve`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(m.memberFindFirst).not.toHaveBeenCalled();
  });

  it("refuses with 409 while Cuso writes a new version", async () => {
    m.turnFindFirst.mockResolvedValue({
      id: "turn-1",
      status: "RUNNING",
      eveSessionId: null,
      createdAt: new Date(),
      clientTurnId: "cmo:strategy:hire-1:1",
    });

    const response = await post(`${OLD_ID}/approve`);

    expect(response.status).toBe(409);
    expect(m.strategyUpdate).not.toHaveBeenCalled();
  });

  it("answers a question on its own version only", async () => {
    m.strategyFindFirst.mockResolvedValue(version(OLD_ID));

    const response = await post(`${OLD_ID}/answers`, {
      questionId: "q1",
      answer: "no",
      note: "  Most come from referrals.  ",
    });

    expect(response.status).toBe(200);
    expect(m.strategyUpdate).toHaveBeenCalledWith({
      where: { id: OLD_ID },
      data: {
        plan: expect.objectContaining({
          questions: [
            expect.objectContaining({
              id: "q1",
              answer: "no",
              note: "Most come from referrals.",
            }),
          ],
        }),
      },
    });
  });

  it("is not found for a question the version does not have", async () => {
    m.strategyFindFirst.mockResolvedValue(version(OLD_ID));

    const response = await post(`${OLD_ID}/answers`, {
      questionId: "nope",
      answer: "yes",
    });

    expect(response.status).toBe(404);
    expect(m.strategyUpdate).not.toHaveBeenCalled();
  });
});

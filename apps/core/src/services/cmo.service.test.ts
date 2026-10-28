import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cmoFindUnique,
  cmoUpdate,
  subscriptionFindFirst,
  turnFindFirst,
  connectionFindMany,
  workspaceFindUnique,
  postFindFirst,
  postFindMany,
  cancelSocialPost,
  eventFindFirst,
  expireTurn,
  startTurn,
  createBot,
  projectCreate,
  projectDelete,
  cmoCreate,
  createOrganizationWorkspace,
  organizationFindFirst,
  cmoDeleteMany,
  getUserWorkspace,
  integrationFindMany,
  connectSokoBotIntegration,
  finalizeSokoBotIntegration,
  memberFindUnique,
  chatRoomDelete,
  cmoFindMany,
  memberFindMany,
  sokoBotFindUnique,
} = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  sokoBotFindUnique: vi.fn(),
  cmoFindMany: vi.fn(),
  memberFindUnique: vi.fn(),
  chatRoomDelete: vi.fn(),
  integrationFindMany: vi.fn(),
  connectSokoBotIntegration: vi.fn(),
  finalizeSokoBotIntegration: vi.fn(),
  cmoFindUnique: vi.fn(),
  cmoUpdate: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  turnFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  workspaceFindUnique: vi.fn(),
  postFindFirst: vi.fn(),
  postFindMany: vi.fn(),
  cancelSocialPost: vi.fn(),
  eventFindFirst: vi.fn(),
  expireTurn: vi.fn(),
  startTurn: vi.fn(),
  createBot: vi.fn(),
  projectCreate: vi.fn(),
  projectDelete: vi.fn(),
  cmoCreate: vi.fn(),
  createOrganizationWorkspace: vi.fn(),
  organizationFindFirst: vi.fn(),
  cmoDeleteMany: vi.fn(),
  getUserWorkspace: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    // Runs the callback against this same mock, as one transaction would.
    $transaction: (callback: (tx: unknown) => unknown) => callback(client),
    $executeRaw: vi.fn(async () => 1),
    cmoHire: {
      findUnique: cmoFindUnique,
      findMany: cmoFindMany,
      update: cmoUpdate,
      create: cmoCreate,
      deleteMany: cmoDeleteMany,
    },
    user: {
      findUnique: async () => ({ preferredOrganizationId: "org-1" }),
    },
    member: { findUnique: memberFindUnique, findMany: memberFindMany },
    sokoBot: { findUnique: sokoBotFindUnique },
    chatRoom: { delete: chatRoomDelete },
    project: { create: projectCreate, delete: projectDelete },
    organization: { findFirst: organizationFindFirst },
    subscription: { findFirst: subscriptionFindFirst },
    workspace: { findUnique: workspaceFindUnique },
    sokoBotTurn: { findFirst: turnFindFirst },
    projectSocialConnection: { findMany: connectionFindMany },
    socialPost: { findFirst: postFindFirst, findMany: postFindMany },
    sokoBotRuntimeEvent: { findFirst: eventFindFirst },
    sokoBotIntegration: { findMany: integrationFindMany },
  };
  return { default: client };
});

const mockBilling = vi.hoisted(() => ({ on: false, production: false }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      CMO_MOCK_BILLING: mockBilling.on,
      ...(mockBilling.production ? { VERCEL_ENV: "production" as const } : {}),
    }),
  };
});

vi.mock("@/services/social-posts.service", () => ({ cancelSocialPost }));

vi.mock("@/services/soko-bot-shared-create.service", () => ({
  createSharedSokoBot: createBot,
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { expireTurn, startTurn },
}));

vi.mock("@/helpers/organization-workspace", () => ({
  createOrganizationWorkspace,
}));

vi.mock("@/helpers/user-workspaces", () => ({ getUserWorkspace }));

const funding = vi.hoisted(() => ({
  spendable: 100,
  requireFunding: vi.fn(),
  BillingError: class extends Error {},
}));

vi.mock("@/helpers/subscription", () => ({
  buildCreditsPayload: async () => ({
    spendable: funding.spendable,
    subscription: null,
  }),
}));

vi.mock("@/services/soko-bot-billing.service", () => ({
  requireSokoBotTurnFunding: funding.requireFunding,
  SokoBotBillingAccessError: funding.BillingError,
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("@/services/soko-bot-integration-connection.service", () => ({
  connectSokoBotIntegration,
  finalizeSokoBotIntegration,
}));

import {
  answerCmoBrandQuestion,
  approveCmoStrategy,
  CmoForbiddenError,
  chooseCmoMockPlan,
  cmoBusinessNameFromUrl,
  cmoExecutionRefusal,
  cmoLearningState,
  cmoPlanAnswerNote,
  cmoRunnerUserId,
  cmoUpNext,
  connectCmoMeasurement,
  describeCmoStep,
  finalizeCmoMeasurement,
  finishCmoAccountsStep,
  fitCmoMarketingContext,
  getCmoHireForUser,
  hasActiveCmoSubscription,
  keepCalendarWork,
  keepPlanAnswers,
  listCmoChannels,
  listCmoMeasurement,
  mergeBrandVisual,
  mergeCalendarPieces,
  ownWords,
  parseCmoUpdates,
  pauseCmoCalendarEntry,
  reportCmoUpdate,
  requestCmoStrategy,
  retryCmoOnboarding,
  revertCmoUpdate,
  saveCmoBrandBrain,
  saveCmoStrategy,
  startCmoOnboarding,
  withoutDashes,
} from "./cmo.service";

const strategy = {
  month: "2026-10",
  summary: "Founder-led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week" }],
  calendar: [
    {
      id: "a",
      date: "2026-10-20",
      channel: "linkedin",
      title: "Customer story",
      format: "post",
      status: "draft" as const,
    },
    {
      id: "b",
      date: "2026-10-02",
      channel: "linkedin",
      title: "Old post",
      format: "post",
      status: "draft" as const,
    },
    {
      id: "c",
      date: "2026-10-08",
      channel: "linkedin",
      title: "Published",
      format: "post",
      status: "published" as const,
    },
  ],
  previews: [],
  changes: [],
};
const revised = { ...strategy, summary: "Twice the LinkedIn posts." };

beforeEach(() => {
  vi.clearAllMocks();
  mockBilling.on = false;
  mockBilling.production = false;
  cmoUpdate.mockImplementation(async (args) => ({ id: "cmo-1", ...args.data }));
  expireTurn.mockResolvedValue(true);
  // Every hire lives in the business's organization (ADR 0060), and the
  // member asking owns it unless a test says otherwise.
  workspaceFindUnique.mockResolvedValue({ organizationId: "org-1" });
  memberFindUnique.mockResolvedValue({ role: "owner" });
  // The hire a member works with is the one findUnique stands for here, in
  // the business's organization.
  cmoFindMany.mockImplementation(async (args: unknown) => {
    const hire = await cmoFindUnique(args);
    return hire
      ? [{ ...hire, project: { workspace: { organizationId: "org-1" } } }]
      : [];
  });
});

describe("cmoRunnerUserId", () => {
  const hire = { workspaceId: "ws-1", sokoBotId: "bot-1" };

  it("runs as the hirer while they are still a member", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: "hirer" });
    memberFindMany.mockResolvedValue([
      { userId: "owner" },
      { userId: "hirer" },
    ]);
    await expect(cmoRunnerUserId(hire)).resolves.toBe("hirer");
    expect(memberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          OR: [{ userId: "hirer" }, { role: { in: ["owner", "admin"] } }],
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("falls back to the longest-standing owner or admin once the hirer left", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: "hirer" });
    memberFindMany.mockResolvedValue([
      { userId: "owner" },
      { userId: "admin" },
    ]);
    await expect(cmoRunnerUserId(hire)).resolves.toBe("owner");
  });

  it("never matches every member when the hirer's account is gone", async () => {
    sokoBotFindUnique.mockResolvedValue({ createdByUserId: null });
    memberFindMany.mockResolvedValue([]);
    await expect(cmoRunnerUserId(hire)).resolves.toBeNull();
    expect(memberFindMany.mock.calls[0]?.[0].where.OR).toEqual([
      { role: { in: ["owner", "admin"] } },
    ]);
  });
});

describe("getCmoHireForUser", () => {
  const inOrg = (id: string, organizationId: string) => ({
    id,
    project: { workspace: { organizationId } },
  });

  it("finds a live Cuso of any organization the person belongs to", async () => {
    await getCmoHireForUser("user-1");
    expect(cmoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBot: { deletedAt: null, archivedAt: null },
          project: {
            workspace: {
              organization: { members: { some: { userId: "user-1" } } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("prefers the preferred organization's Cuso over a newer one", async () => {
    cmoFindMany.mockResolvedValueOnce([
      inOrg("cmo-new", "org-2"),
      inOrg("cmo-1", "org-1"),
    ]);
    await expect(getCmoHireForUser("user-1")).resolves.toEqual({ id: "cmo-1" });
  });

  it("falls back to the newest when the preferred one has none", async () => {
    cmoFindMany.mockResolvedValueOnce([
      inOrg("cmo-new", "org-2"),
      inOrg("cmo-old", "org-3"),
    ]);
    await expect(getCmoHireForUser("user-1")).resolves.toEqual({
      id: "cmo-new",
    });
  });
});

describe("strategy approval → execution gate", () => {
  const workspace = (approvedAt: Date | null) => ({
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    strategy,
    strategyApprovedAt: approvedAt,
  });

  it("asks the business organization's plan", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" });
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ referenceId: "org-1" }),
      }),
    );
  });

  it("leaves every non-CMO bot alone", async () => {
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "v19" }),
    ).toBeNull();
    expect(cmoFindUnique).not.toHaveBeenCalled();
  });

  it("refuses before the owner approves, even when subscribed", async () => {
    cmoFindUnique.mockResolvedValue(workspace(null));
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/approved/);
  });

  it("refuses without a subscription after approval", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("executes once approved and subscribed, with no per-post approval", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
  });

  it("counts only active paid plans", async () => {
    subscriptionFindFirst.mockResolvedValue(null);
    expect(await hasActiveCmoSubscription("org-1")).toBe(false);
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: "org-1",
          status: { in: ["active", "trialing"] },
        }),
      }),
    );
  });
});

describe("ownWords", () => {
  it("finds the words an owner typed, not a preset goal", () => {
    expect(ownWords("More leads")).toBeNull();
    expect(ownWords("Launch something")).toBeNull();
    expect(ownWords("Mehr Gäste")).toBe("Mehr Gäste");
    expect(ownWords("Launch something: Unser Panettone")).toBe(
      "Unser Panettone",
    );
  });
});

describe("approveCmoStrategy", () => {
  it("approves once and keeps the first approval time", async () => {
    const first = new Date("2026-10-01T09:00:00Z");
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyApprovedAt: first,
    });
    await approveCmoStrategy("user-1");
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategyApprovedAt).toBe(first);
  });

  it("needs a strategy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", strategy: null });
    await expect(approveCmoStrategy("user-1")).rejects.toThrow(/no strategy/i);
  });

  it("leaves approving to the organization's owners and admins", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      workspaceId: "ws-1",
      strategy,
      strategyApprovedAt: null,
    });
    memberFindUnique.mockResolvedValue({ role: "member" });
    await expect(approveCmoStrategy("user-2")).rejects.toBeInstanceOf(
      CmoForbiddenError,
    );
    expect(memberFindUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: "user-2", organizationId: "org-1" },
      },
      select: { role: true },
    });
    expect(cmoUpdate).not.toHaveBeenCalled();

    memberFindUnique.mockResolvedValue({ role: "admin" });
    turnFindFirst.mockResolvedValue(null);
    await approveCmoStrategy("user-2");
    expect(cmoUpdate).toHaveBeenCalled();
  });

  it("waits while Cuso writes the strategy the owner asked for", async () => {
    // Approving the old plan now would carry over to the new one unreviewed.
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      sokoBotId: "bot-1",
      strategy,
      strategyApprovedAt: null,
    });
    turnFindFirst.mockResolvedValue({
      id: "turn-1",
      status: "RUNNING",
      eveSessionId: null,
      createdAt: new Date(),
      clientTurnId: "cmo:strategy:cmo-1:1",
    });
    await expect(approveCmoStrategy("user-1")).rejects.toThrow(
      /still writing/i,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });
});

describe("requestCmoStrategy", () => {
  const brandBrain = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
    profile: {},
  };
  const hire = {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain,
    strategy,
    strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
  };

  it("keeps the approval when Cuso cannot start the new strategy", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    startTurn.mockRejectedValue(new Error("Soko Bot is already working"));
    await expect(requestCmoStrategy({ userId: "user-1" })).rejects.toThrow(
      "already working",
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("clears the approval once the strategy turn started", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    startTurn.mockResolvedValue({ turnId: "turn-9" });
    await expect(requestCmoStrategy({ userId: "user-1" })).resolves.toEqual({
      turnId: "turn-9",
    });
    expect(cmoUpdate).toHaveBeenCalledWith({
      where: { id: "cmo-1" },
      data: { strategyApprovedAt: null },
    });
  });
});

describe("mock billing", () => {
  const approvedWithMockPlan = {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    strategy,
    strategyApprovedAt: new Date(),
    mockPlan: "growth",
  };

  it("lets a mock plan open execution while CMO_MOCK_BILLING is on", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
    expect(subscriptionFindFirst).not.toHaveBeenCalled();
  });

  it("ignores a stored mock plan when the flag is off (production)", async () => {
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("ignores CMO_MOCK_BILLING on production", async () => {
    mockBilling.on = true;
    mockBilling.production = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
    await expect(chooseCmoMockPlan("user-1", "scale")).rejects.toThrow(
      /mock billing is off/i,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("stores the chosen tier only while the flag is on", async () => {
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    await expect(chooseCmoMockPlan("user-1", "scale")).rejects.toThrow(
      /mock billing is off/i,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();

    mockBilling.on = true;
    await chooseCmoMockPlan("user-1", "scale");
    expect(cmoUpdate.mock.calls[0]?.[0].data).toMatchObject({
      mockPlan: "scale",
      mockPlanActivatedAt: expect.any(Date),
    });
  });

  it("starts the paid month for owners and admins only", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    memberFindUnique.mockResolvedValue({ role: "member" });
    await expect(chooseCmoMockPlan("user-2", "scale")).rejects.toBeInstanceOf(
      CmoForbiddenError,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });
});

describe("finishCmoAccountsStep", () => {
  it("records the step once, so a reload resumes on the plan", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
      accountsDoneAt: null,
    });
    await finishCmoAccountsStep("user-1");
    expect(cmoUpdate.mock.calls[0]?.[0].data.accountsDoneAt).toBeInstanceOf(
      Date,
    );

    cmoUpdate.mockClear();
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
      accountsDoneAt: new Date("2026-10-02T09:00:00Z"),
    });
    await finishCmoAccountsStep("user-1");
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("needs an approved strategy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", strategyApprovedAt: null });
    await expect(finishCmoAccountsStep("user-1")).rejects.toThrow(/approve/i);
  });
});

describe("weekly change and revert", () => {
  it("keeps calendar entries outside the 31 days a turn can see", async () => {
    const far = {
      id: "d",
      date: "2026-12-01",
      channel: "linkedin",
      title: "December",
      format: "post",
      status: "idea" as const,
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: { ...strategy, calendar: [...strategy.calendar, far] },
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
      { turnId: "turn-1", now: new Date("2026-10-07T12:00:00Z") },
    );
    const saved = cmoUpdate.mock.calls[0]?.[0].data.strategy;
    // Oct 2 and Dec 1 were outside the window. Oct 8 was inside it and omitted.
    expect(saved.calendar.map((entry: { id: string }) => entry.id)).toEqual([
      "b",
      "a",
      "d",
    ]);
  });

  it("keeps what a save leaves out, so a plan can arrive in short calls", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "A sharper headline." },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );
    const saved = cmoUpdate.mock.calls[0]?.[0].data.strategy;
    expect(saved.summary).toBe("A sharper headline.");
    expect(saved.goals).toEqual(strategy.goals);
    expect(saved.calendar.map((entry: { id: string }) => entry.id)).toEqual(
      strategy.calendar.map((entry) => entry.id),
    );
  });

  it("keeps saved previews when a weekly drafting save sends none", async () => {
    const preview = {
      kind: "post" as const,
      channel: "linkedin",
      title: "Sample",
      body: "A sample post.",
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: { ...strategy, previews: [preview] },
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, strategy, {
      turnId: "turn-1",
    });
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategy.previews).toEqual([
      preview,
    ]);
  });

  it("lets an owner save replace the calendar, including hidden days", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy(
      { userId: "user-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
    );
    expect(
      cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["a"]);
  });

  it("keeps the replaced strategy with the turn that replaced it", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, revised, {
      turnId: "turn-1",
    });
    const history = cmoUpdate.mock.calls[0]?.[0].data.strategyHistory;
    expect(history).toEqual([
      expect.objectContaining({ turnId: "turn-1", strategy }),
    ]);
  });

  it("lets a weekly report revert to the strategy before its turn", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      updates: null,
      strategyHistory: [
        {
          savedAt: "2026-10-05T09:02:00Z",
          turnId: "turn-1",
          strategy: revised,
        },
        { savedAt: "2026-10-05T09:01:00Z", turnId: "turn-1", strategy },
        { savedAt: "2026-10-01T09:00:00Z", turnId: null, strategy: {} },
      ],
    });
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      update: {
        kind: "weekly",
        headline: "Week 1",
        done: [],
        upNext: [],
        changes: ["Two more LinkedIn posts a week"],
        results: "No provider metrics yet.",
      },
    });
    // The oldest save of the turn holds the strategy before the review.
    expect(record.previousStrategy).toEqual(strategy);

    cmoUpdate.mockClear();
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: revised,
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
      updates: [record],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: record.id });
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategy).toMatchObject({
      summary: strategy.summary,
    });
    const updates = parseCmoUpdates(cmoUpdate.mock.calls[1]?.[0].data.updates);
    expect(updates[0]?.revertedAt).toBeTruthy();
  });

  it("keeps entries already handed to Social when reverting", async () => {
    const postId = "6b1f6a52-0d4e-4f55-9b0e-2f1d2c3b4a5e";
    const newPostId = "7c2a7b63-1e5f-4a66-8c1f-3a2e3d4c5b6f";
    const scheduled = {
      ...strategy.calendar[0]!,
      status: "scheduled" as const,
      socialPostId: postId,
    };
    const added = {
      id: "n",
      date: "2026-10-22",
      channel: "linkedin",
      title: "Added by the review",
      format: "post",
      status: "scheduled" as const,
      socialPostId: newPostId,
    };
    const update = {
      id: "u-1",
      at: "2026-10-05T09:03:00Z",
      kind: "weekly" as const,
      headline: "Week 1",
      done: [],
      upNext: [],
      changes: [],
      previousStrategy: strategy,
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: {
        ...revised,
        calendar: [scheduled, strategy.calendar[1]!, added],
      },
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
      updates: [update],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: "u-1" });
    const calendar = cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar;
    expect(
      calendar.map((entry: { id: string; socialPostId?: string }) => [
        entry.id,
        entry.socialPostId,
      ]),
    ).toEqual([
      ["b", undefined],
      ["c", undefined],
      ["a", postId],
      ["n", newPostId],
    ]);
  });

  it("keeps entries the owner paused when reverting", async () => {
    const update = {
      id: "u-1",
      at: "2026-10-05T09:03:00Z",
      kind: "weekly" as const,
      headline: "Week 1",
      done: [],
      upNext: [],
      changes: [],
      previousStrategy: strategy,
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: {
        ...revised,
        calendar: strategy.calendar.map((entry) =>
          entry.id === "b" ? { ...entry, status: "skipped" as const } : entry,
        ),
      },
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
      updates: [update],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: "u-1" });
    const calendar = cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar;
    expect(
      calendar.find((entry: { id: string }) => entry.id === "b").status,
    ).toBe("skipped");
  });

  it("does not offer a revert for a daily report", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      updates: null,
      strategyHistory: [{ savedAt: "x", turnId: "turn-2", strategy }],
    });
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-2",
      update: {
        kind: "daily",
        headline: "Today",
        done: ["Drafted Monday's post"],
        upNext: [],
        changes: [],
      },
    });
    expect(record.previousStrategy).toBeUndefined();
  });
});

describe("cmoUpNext", () => {
  const plan = {
    ...strategy,
    calendar: [
      ...strategy.calendar,
      {
        id: "w",
        date: "2026-10-21",
        channel: "website",
        title: "Pricing page",
        format: "article",
        status: "idea" as const,
      },
    ],
  };
  const today = new Date("2026-10-05T10:00:00Z");

  it("lists only open entries on connected accounts, soonest first", () => {
    expect(cmoUpNext(plan, today, ["LinkedIn"]).map((item) => item.id)).toEqual(
      ["a"],
    );
  });

  it("is empty until a channel Cuso can publish to is connected", () => {
    expect(cmoUpNext(plan, today, [])).toEqual([]);
  });
});

describe("cmoBusinessNameFromUrl", () => {
  it("uses the domain", () => {
    expect(cmoBusinessNameFromUrl("https://www.acme.io/about")).toBe("acme.io");
    expect(cmoBusinessNameFromUrl("not a url")).toBe("not a url");
  });
});

describe("learning state", () => {
  const workspace = {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    brandBrain: null,
    businessName: "Acme",
    websiteUrl: "https://acme.io",
    goals: "More sales",
  };
  const now = new Date("2026-10-05T10:00:00Z");
  const turn = (status: string, minutesAgo: number) => ({
    id: "turn-1",
    status,
    eveSessionId: "sess-1",
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("is running while the turn keeps making progress", async () => {
    turnFindFirst.mockResolvedValue(turn("RUNNING", 2));
    eventFindFirst.mockResolvedValue({
      occurredAt: new Date(now.getTime() - 10_000),
    });
    expect(await cmoLearningState(workspace, now)).toBe("running");
    expect(expireTurn).not.toHaveBeenCalled();
  });

  it("settles a turn that stopped making progress and reports it failed", async () => {
    // Its run died with the process that ran it: last event 7 minutes ago.
    turnFindFirst.mockResolvedValue(turn("RUNNING", 8));
    eventFindFirst.mockResolvedValue({
      occurredAt: new Date(now.getTime() - 7 * 60_000),
    });
    expect(await cmoLearningState(workspace, now)).toBe("failed");
    expect(expireTurn).toHaveBeenCalledWith("turn-1");
  });

  it("reports a failed turn, and done when Cuso finished with questions", async () => {
    turnFindFirst.mockResolvedValueOnce(turn("FAILED", 3));
    expect(await cmoLearningState(workspace, now)).toBe("failed");
    turnFindFirst.mockResolvedValueOnce(turn("COMPLETED", 3));
    expect(await cmoLearningState(workspace, now)).toBe("done");
  });

  it("retries only after a failure, with a fresh turn id", async () => {
    cmoFindUnique.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    startTurn.mockResolvedValue({ turnId: "turn-2" });
    expect(await retryCmoOnboarding("user-1")).toEqual({ turnId: "turn-2" });
    const input = startTurn.mock.calls[0]?.[0];
    expect(input.clientTurnId).toMatch(/^cmo:onboarding:cmo-1:\d+$/);
    // Cuso runs it, not the owner's personal assistant beside him.
    expect(input.sokoBotId).toBe("bot-1");

    turnFindFirst.mockResolvedValue(turn("RUNNING", 1));
    eventFindFirst.mockResolvedValue({ occurredAt: new Date() });
    await expect(retryCmoOnboarding("user-1")).rejects.toThrow(
      "still learning",
    );
  });

  it("says out of credits instead of starting a turn that would stop", async () => {
    cmoFindUnique.mockResolvedValue(workspace);
    turnFindFirst.mockResolvedValue(turn("FAILED", 3));
    funding.requireFunding.mockRejectedValueOnce(
      new funding.BillingError("no"),
    );
    await expect(retryCmoOnboarding("user-1")).rejects.toThrow(
      "out of credits",
    );
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("listCmoChannels", () => {
  it("reads Project Social's lower-case status as ACTIVE", async () => {
    connectionFindMany.mockResolvedValue([
      { id: "c1", provider: "linkedin", status: "active" },
    ]);
    expect((await listCmoChannels("project-1"))[0]?.status).toBe("ACTIVE");
  });
});

describe("pauseCmoCalendarEntry", () => {
  it("cancels the scheduled post and takes the entry out of the plan", async () => {
    const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";
    const linked = {
      ...strategy,
      calendar: strategy.calendar.map((entry) =>
        entry.id === "a"
          ? { ...entry, status: "scheduled" as const, socialPostId: postId }
          : entry,
      ),
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      strategy: linked,
      strategyUpdatedAt: new Date(),
      strategyHistory: [],
    });
    postFindFirst.mockResolvedValue({ status: "SCHEDULED", revision: 2 });
    cancelSocialPost.mockResolvedValue({});

    await pauseCmoCalendarEntry({ userId: "user-1", entryId: "a" });

    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 2, projectId: "project-1" }),
    );
    const saved = cmoUpdate.mock.calls.at(-1)?.[0].data.strategy;
    expect(
      saved.calendar.find((entry: { id: string }) => entry.id === "a").status,
    ).toBe("skipped");
  });

  it("refuses a post that is already going out, and keeps the entry", async () => {
    const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      strategy: {
        ...strategy,
        calendar: strategy.calendar.map((entry) =>
          entry.id === "a"
            ? { ...entry, status: "scheduled" as const, socialPostId: postId }
            : entry,
        ),
      },
    });
    postFindFirst.mockResolvedValue({ status: "PUBLISHING", revision: 3 });
    cancelSocialPost.mockRejectedValue(
      new Error("The post can no longer be canceled"),
    );

    await expect(
      pauseCmoCalendarEntry({ userId: "user-1", entryId: "a" }),
    ).rejects.toThrow("no longer be canceled");
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 3 }),
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });
});

describe("saveCmoBrandBrain", () => {
  const essentials = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
  };
  const section = (answer: string) => ({
    answer,
    findings: [
      {
        point: answer,
        evidence: "fact" as const,
        confidence: "high" as const,
      },
    ],
  });

  it("keeps sections in a draft until the essentials arrive", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", brandBrain: null });
    cmoUpdate.mockClear();
    await saveCmoBrandBrain(
      { sokoBotId: "bot-1" },
      { sections: { pricing: section("From 9 dollars") } },
    );
    const data = cmoUpdate.mock.calls[0]?.[0].data;
    expect(data.brandBrain).toEqual({
      profile: {
        pricing: { ...section("From 9 dollars"), openQuestions: [] },
      },
    });
    // The owner only sees a Brand Brain once it has its essentials.
    expect(data.brandBrainUpdatedAt).toBeUndefined();
  });

  it("merges later saves: a sent section replaces its own, the rest stay", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      brandBrain: {
        profile: {
          pricing: section("From 9 dollars"),
          company: section("Founded 2019"),
        },
      },
    });
    cmoUpdate.mockClear();
    await saveCmoBrandBrain(
      { sokoBotId: "bot-1" },
      {
        brandBrain: { ...essentials, profile: {} },
        sections: { pricing: section("From 12 dollars") },
      },
    );
    const data = cmoUpdate.mock.calls[0]?.[0].data;
    expect(data.brandBrain.summary).toBe("Acme sells rockets.");
    expect(data.brandBrain.profile.pricing.answer).toBe("From 12 dollars");
    expect(data.brandBrain.profile.company.answer).toBe("Founded 2019");
    expect(data.brandBrainUpdatedAt).toBeInstanceOf(Date);
  });

  it("keeps the essentials when only sections change", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      brandBrain: { ...essentials, profile: {} },
    });
    cmoUpdate.mockClear();
    await saveCmoBrandBrain(
      { userId: "user-1" },
      { sections: { company: section("Founded 2019") } },
    );
    const data = cmoUpdate.mock.calls[0]?.[0].data;
    expect(data.brandBrain.summary).toBe("Acme sells rockets.");
    expect(data.brandBrain.profile.company.answer).toBe("Founded 2019");
  });
});

describe("research feed", () => {
  const site = "https://linear.app";
  it("reads tool calls the way a founder would", () => {
    expect(
      describeCmoStep("web_fetch", { url: "https://linear.app/pricing" }, site),
    ).toEqual({
      kind: "read",
      label: "Reading linear.app/pricing",
      url: "https://linear.app/pricing",
    });
    expect(
      describeCmoStep("web_fetch", { url: "https://www.asana.com/" }, site)
        ?.label,
    ).toBe("Studying asana.com");
    expect(
      describeCmoStep(
        "web_search",
        { query: "site:linear.app Linear competitors" },
        site,
      )?.label,
    ).toBe("Searching “Linear competitors”");
    expect(
      describeCmoStep(
        "web_search",
        { query: '"Products" OR Plausible  analytics' },
        site,
      )?.label,
    ).toBe("Searching “Products Plausible analytics”");
    expect(describeCmoStep("save_brand_brain", {}, site)?.kind).toBe("brain");
    expect(
      describeCmoStep(
        "save_brand_brain",
        { sections: { pricing: {}, company: {} } },
        site,
      )?.label,
    ).toBe("Writing Company basics, Pricing and business model");
    expect(
      describeCmoStep(
        "search_exa",
        { query: "Project tools for product teams", category: "company" },
        site,
      ),
    ).toEqual({
      kind: "study",
      label: "Finding companies: “Project tools for product teams”",
      url: null,
    });
    expect(
      describeCmoStep(
        "search_exa",
        {
          query: "What customers say",
          includeDomains: ["g2.com", "reddit.com"],
        },
        site,
      )?.label,
    ).toBe("Reading g2.com, reddit.com");
    expect(describeCmoStep("read_memory", {}, site)).toBeNull();
  });
});

describe("brand visual", () => {
  it("lets the DESIGN.md colours lead and keeps the site's logo", () => {
    const visual = mergeBrandVisual(
      {
        logoUrl: "https://acme.io/logo.svg",
        colors: ["#ff6a00"],
        fonts: ["Inter"],
        siteName: "Acme",
        images: ["https://acme.io/hero.jpg"],
      },
      "https://blob/icon.png",
      {
        url: "https://blob/design.md",
        content: "Primary: `#6400FF` Accent: `#6a05ff`",
      },
    );
    expect(visual).toEqual({
      logoUrl: "https://acme.io/logo.svg",
      colors: ["#6400ff", "#ff6a00"],
      fonts: ["Inter"],
      siteName: "Acme",
      designMdUrl: "https://blob/design.md",
      images: ["https://acme.io/hero.jpg"],
    });
  });
});

describe("keepCalendarWork", () => {
  const entry = (id: string, date: string, title: string, draft?: string) => ({
    id,
    date,
    channel: "linkedin",
    title,
    format: "post",
    status: "idea" as const,
    ...(draft ? { draft } : {}),
  });

  it("gives a kept entry its draft back", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-02", "Customer story", "Full text")],
      [entry("a", "2026-11-02", "Customer story")],
    );
    expect(kept[0]?.draft).toBe("Full text");
  });

  it("drops a stale draft when the piece was rewritten", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-02", "Customer story", "Full text")],
      [entry("a", "2026-11-02", "A new angle")],
    );
    expect(kept[0]?.draft).toBeUndefined();
  });

  it("shows a moved piece once", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-04", "Launch day", "Text")],
      [
        entry("a", "2026-11-04", "Launch day", "Text"),
        entry("a2", "2026-11-07", "Launch day", "Text"),
        entry("b", "2026-11-05", "Something else"),
      ],
    );
    expect(kept.map((item) => item.id)).toEqual(["a2", "b"]);
  });

  it("keeps a series that repeats a title with new words", () => {
    const kept = keepCalendarWork(
      [entry("a", "2026-11-04", "Tip of the week", "Tip one")],
      [
        entry("a", "2026-11-04", "Tip of the week", "Tip one"),
        entry("b", "2026-11-11", "Tip of the week", "Tip two"),
      ],
    );
    expect(kept.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("withoutDashes", () => {
  it("rewrites em and en dashes, keeps number ranges", () => {
    expect(
      withoutDashes({
        hook: "Fresh bread — every morning",
        list: ["Open 7–11", "Soft – and warm"],
      }),
    ).toEqual({
      hook: "Fresh bread, every morning",
      list: ["Open 7-11", "Soft, and warm"],
    });
  });
});

describe("Brand Brain questions", () => {
  const question = {
    id: "found-via-google",
    question: "Do most customers find you through Google?",
    statement: "Most customers find the business through Google",
    section: "marketing" as const,
  };
  const stored = (extra: object = {}) => ({
    id: "cmo-1",
    brandBrain: {
      summary: "Acme sells rockets.",
      voice: { tone: "Direct", do: [], dont: [], examples: [] },
      audience: [],
      products: [],
      competitors: [],
      channels: [],
      profile: {
        marketing: {
          answer: "Mostly referrals.",
          findings: [
            {
              point: "Referrals bring most deals",
              evidence: "inference" as const,
              confidence: "low" as const,
            },
          ],
          openQuestions: [],
        },
      },
      questions: [question],
      ...extra,
    },
  });

  beforeEach(() => {
    cmoUpdate.mockClear();
  });

  it("puts a yes into its section as a confirmed finding", async () => {
    cmoFindUnique.mockResolvedValue(stored());

    await answerCmoBrandQuestion("user-1", {
      questionId: question.id,
      answer: "yes",
    });

    const brain = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(brain.questions[0].answer).toBe("yes");
    expect(brain.profile.marketing.findings[0]).toMatchObject({
      point: question.statement,
      evidence: "fact",
      confidence: "high",
    });
    expect(brain.profile.marketing.findings).toHaveLength(2);
  });

  it("replaces an earlier answer's finding with what the no says is true", async () => {
    cmoFindUnique.mockResolvedValue(
      stored({
        questions: [{ ...question, answer: "yes" }],
        profile: {
          marketing: {
            answer: "Google.",
            findings: [
              {
                point: question.statement,
                evidence: "fact",
                confidence: "high",
              },
            ],
            openQuestions: [],
          },
        },
      }),
    );

    await answerCmoBrandQuestion("user-1", {
      questionId: question.id,
      answer: "no",
      note: "Most come through LinkedIn",
    });

    const brain = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(brain.questions[0]).toMatchObject({
      answer: "no",
      note: "Most come through LinkedIn",
    });
    expect(
      brain.profile.marketing.findings.map((f: { point: string }) => f.point),
    ).toEqual(["Most come through LinkedIn"]);
  });

  it("records not sure without touching the section", async () => {
    cmoFindUnique.mockResolvedValue(stored());

    await answerCmoBrandQuestion("user-1", {
      questionId: question.id,
      answer: "unsure",
    });

    const brain = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(brain.questions[0].answer).toBe("unsure");
    expect(brain.profile.marketing.findings).toHaveLength(1);
  });

  it("refuses an answer to a question that is not there", async () => {
    cmoFindUnique.mockResolvedValue(stored());

    await expect(
      answerCmoBrandQuestion("user-1", { questionId: "nope", answer: "yes" }),
    ).rejects.toThrow("not in the Brand Brain");
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("keeps the owner's answers when Cuso saves the questions again", async () => {
    cmoFindUnique.mockResolvedValue(
      stored({ questions: [{ ...question, answer: "no", note: "LinkedIn" }] }),
    );
    const { brandBrain } = stored();

    await saveCmoBrandBrain(
      { sokoBotId: "bot-1" },
      { brandBrain: { ...brandBrain, questions: [question] } },
    );

    const saved = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(saved.questions[0]).toMatchObject({
      answer: "no",
      note: "LinkedIn",
    });
  });
});

describe("startCmoOnboarding", () => {
  const input = {
    userId: "user-1",
    websiteUrl: "https://www.acme.io",
  };

  beforeEach(() => {
    cmoFindUnique.mockResolvedValue(null);
    organizationFindFirst.mockResolvedValue(null);
    createOrganizationWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "organization",
      name: "acme.io",
      organizationId: "org-1",
    });
    projectCreate.mockResolvedValue({ id: "project-1" });
    projectDelete.mockResolvedValue({ id: "project-1" });
    createBot.mockResolvedValue({ id: "bot-1" });
    cmoCreate.mockImplementation(async ({ data }) => ({
      id: "cmo-1",
      ...data,
    }));
    startTurn.mockResolvedValue({ turnId: "turn-1" });
  });

  it("refuses before hiring when the organization has no credits", async () => {
    funding.spendable = 0;
    try {
      await expect(startCmoOnboarding(input)).rejects.toThrow("out of credits");
      expect(projectCreate).not.toHaveBeenCalled();
      expect(startTurn).not.toHaveBeenCalled();
    } finally {
      funding.spendable = 100;
    }
  });

  it("hires Cuso into a new organization named after the website", async () => {
    await startCmoOnboarding(input);

    expect(createOrganizationWorkspace).toHaveBeenCalledWith("user-1", {
      name: "acme.io",
      websiteUrl: input.websiteUrl,
    });
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-1",
          name: "CMO.xyz · acme.io",
          websiteUrl: input.websiteUrl,
        }),
      }),
    );
    // Cuso is the Project's shared bot, on the CMO version (ADR 0061).
    expect(createBot).toHaveBeenCalledWith(
      expect.objectContaining({
        callerUserId: "user-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        versionId: CMO_SOKO_BOT_VERSION_ID,
      }),
    );
    expect(cmoCreate.mock.lastCall?.[0].data).not.toHaveProperty("userId");
    expect(cmoCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        businessName: "acme.io",
        goals: "",
      }),
    });
    // No goal is asked for, so Cuso's first turn names none.
    expect(startTurn.mock.lastCall?.[0].message).not.toMatch(/goal/i);
  });

  it("takes the empty organization a failed hire left instead of a second one", async () => {
    organizationFindFirst.mockResolvedValue({ id: "org-0" });
    getUserWorkspace.mockResolvedValue({
      id: "ws-0",
      kind: "organization",
      name: "acme.io",
      organizationId: "org-0",
    });

    await startCmoOnboarding(input);

    expect(organizationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: "acme.io" }),
      }),
    );
    expect(getUserWorkspace).toHaveBeenCalledWith("user-1", {
      organizationId: "org-0",
    });
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: "ws-0" }),
      }),
    );
  });

  it("keeps the organization name within its 50 characters", async () => {
    const host = `${"a".repeat(60)}.com`;

    await startCmoOnboarding({ ...input, websiteUrl: `https://${host}` });

    expect(createOrganizationWorkspace).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: host.slice(0, 50) }),
    );
  });

  it("creates nothing else when the organization cannot be created", async () => {
    createOrganizationWorkspace.mockRejectedValue(
      new Error("organization limit"),
    );

    await expect(startCmoOnboarding(input)).rejects.toThrow(
      "organization limit",
    );
    expect(projectCreate).not.toHaveBeenCalled();
    expect(createBot).not.toHaveBeenCalled();
  });

  it("removes the Project, and with it Cuso, when hiring fails partway", async () => {
    createBot.mockRejectedValue(new Error("bot failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("bot failed");
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(cmoCreate).not.toHaveBeenCalled();
  });

  it("removes his shared room with the Project when the CMO record fails", async () => {
    createBot.mockResolvedValue({ id: "bot-1", sharedRoomId: "room-1" });
    chatRoomDelete.mockResolvedValue({ id: "room-1" });
    cmoCreate.mockRejectedValue(new Error("record failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("record failed");
    expect(chatRoomDelete).toHaveBeenCalledWith({ where: { id: "room-1" } });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("returns the person's existing Cuso without hiring again", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-0", workspaceId: "ws-0" });

    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      id: "cmo-0",
    });
    expect(createOrganizationWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });
});

describe("measurement", () => {
  const hire = {
    id: "cmo-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    sitePlatform: "shopify",
  };

  it("lists the sources with their connection state", async () => {
    integrationFindMany.mockResolvedValue([
      { provider: "google_analytics", status: "ACTIVE" },
      { provider: "shopify", status: "PENDING" },
    ]);
    const sources = await listCmoMeasurement("bot-1", "shopify");
    expect(sources.map((s) => [s.provider, s.status])).toEqual([
      ["google_analytics", "connected"],
      ["google_search_console", "none"],
      ["shopify", "pending"],
    ]);
  });

  it("offers Shopify only to a Shopify shop", async () => {
    integrationFindMany.mockResolvedValue([]);
    for (const platform of ["other", null]) {
      const sources = await listCmoMeasurement("bot-1", platform);
      expect(sources.map((s) => s.provider)).toEqual([
        "google_analytics",
        "google_search_console",
      ]);
    }
    cmoFindUnique.mockResolvedValue({ ...hire, sitePlatform: "other" });
    await expect(
      connectCmoMeasurement({
        userId: "user-1",
        provider: "shopify",
        returnUrl: "https://app.cmo.xyz/measure/callback",
      }),
    ).rejects.toThrow(/Shopify shops only/);
  });

  it("connects to Cuso's own bot and returns only to CMO", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    connectSokoBotIntegration.mockResolvedValue({ redirectUrl: "https://x" });
    await connectCmoMeasurement({
      userId: "user-1",
      provider: "shopify",
      returnUrl: "https://app.cmo.xyz/measure/callback",
    });
    expect(connectSokoBotIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        provider: "shopify",
        selector: { kind: "id", sokoBotId: "bot-1" },
      }),
    );
    await expect(
      connectCmoMeasurement({
        userId: "user-1",
        provider: "shopify",
        returnUrl: "https://evil.example/",
      }),
    ).rejects.toThrow(/return address/);
    await expect(
      connectCmoMeasurement({
        userId: "user-1",
        provider: "gmail",
        returnUrl: "https://app.cmo.xyz/measure/callback",
      }),
    ).rejects.toThrow(/does not measure/);
  });

  it("finalizes on Cuso's bot", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    await finalizeCmoMeasurement({
      userId: "user-1",
      provider: "google_analytics",
    });
    expect(finalizeSokoBotIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google_analytics",
        selector: { kind: "id", sokoBotId: "bot-1" },
      }),
    );
  });
});

describe("buildCmoBeatPacket", () => {
  it("stays well under the message limit with a long plan", async () => {
    const { buildCmoBeatPacket } = await import("./cmo.service");
    const long = "x".repeat(2_000);
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      goals: "More leads",
      brandBrain: { summary: long },
      strategy: {
        ...strategy,
        calendar: Array.from({ length: 30 }, (_, index) => ({
          ...strategy.calendar[0],
          id: `e${index}`,
          title: long,
        })),
      },
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
      mockPlan: null,
      updates: [],
    });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    postFindMany.mockResolvedValue([]);
    const { packet, skip } = await buildCmoBeatPacket(
      "bot-1",
      new Date("2026-10-06T07:00:00Z"),
      "cmo-daily-run",
    );
    expect(skip).toBe(false);
    expect(packet).toContain("workspace.marketing");
    expect(packet.length).toBeLessThan(5_000);
  });
});

describe("plan questions", () => {
  const question = (id: string, patch = {}) => ({
    id,
    question: "Do you get about 30 orders a week?",
    statement: "About 30 orders a week.",
    ...patch,
  });

  it("keeps the owner's answers when Cuso saves the questions again", () => {
    const kept = keepPlanAnswers(
      [question("q1", { answer: "no", note: "About 80" })],
      [question("q1"), question("q2")],
    );
    expect(kept[0]).toMatchObject({ answer: "no", note: "About 80" });
    expect(kept[1]?.answer).toBeUndefined();
  });

  it("turns each no into a change for Cuso, and all yes into none", () => {
    expect(
      cmoPlanAnswerNote([
        question("q1", { answer: "yes" }),
        question("q2", { answer: "unsure" }),
      ]),
    ).toBeNull();
    const note = cmoPlanAnswerNote([
      question("q1", { answer: "no", note: "About 80" }),
      question("q2", { answer: "yes" }),
    ]);
    expect(note).toContain(
      '"Do you get about 30 orders a week?" No. What is true: About 80',
    );
    expect(note).toContain("You had assumed: About 30 orders a week.");
  });
});

describe("mergeCalendarPieces", () => {
  const entry = (id: string, patch = {}) => ({
    id,
    date: "2026-11-02",
    channel: "x",
    format: "text",
    title: id,
    status: "idea" as const,
    ...patch,
  });

  it("updates the pieces sent, adds new ones and keeps every other entry", () => {
    const merged = mergeCalendarPieces(
      [entry("a"), entry("b"), entry("c")],
      [entry("b", { draft: "Written.", status: "draft" }), entry("news")],
    );
    expect(merged.map((piece) => piece.id)).toEqual(["a", "b", "c", "news"]);
    expect(merged[1]).toMatchObject({ draft: "Written.", status: "draft" });
  });
});

describe("fitCmoMarketingContext", () => {
  const now = new Date("2026-11-01T09:00:00Z");
  const entry = (id: string, date: string) => ({
    id,
    date,
    channel: "instagram",
    format: "image",
    title: `Piece ${id}`,
    status: "draft",
    draft: "x".repeat(600),
    brief: "y".repeat(200),
  });
  const context = {
    brandBrain: { summary: "A shop", profile: {} },
    strategy: {
      summary: "Plan",
      weeks: ["w".repeat(2_000)],
      calendar: [entry("soon", "2026-11-02"), entry("later", "2026-11-20")],
    },
  };

  it("leaves a context that fits alone", () => {
    expect(fitCmoMarketingContext(context, now, 100_000)).toBe(context);
  });

  it("sheds later drafts first, then secondary plan parts, keeping the next days whole", () => {
    const fitted = fitCmoMarketingContext(context, now, 2_000) as {
      strategy: {
        calendar: Record<string, unknown>[];
        storedNotShown?: string[];
      };
    };
    const [soon, later] = fitted.strategy.calendar;
    expect(soon?.draft).toBeDefined();
    expect(later?.draft).toBeUndefined();
    expect(later?.detailsStored).toBe(true);
    expect(fitted.strategy.storedNotShown).toContain("weeks");
  });
});

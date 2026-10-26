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
  getUserWorkspace,
} = vi.hoisted(() => ({
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
  getUserWorkspace: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    // Runs the callback against this same mock, as one transaction would.
    $transaction: (callback: (tx: unknown) => unknown) => callback(client),
    $executeRaw: vi.fn(async () => 1),
    cmoHire: {
      findUnique: cmoFindUnique,
      update: cmoUpdate,
      create: cmoCreate,
    },
    project: { create: projectCreate, delete: projectDelete },
    subscription: { findFirst: subscriptionFindFirst },
    workspace: { findUnique: workspaceFindUnique },
    sokoBotTurn: { findFirst: turnFindFirst },
    projectSocialConnection: { findMany: connectionFindMany },
    socialPost: { findFirst: postFindFirst, findMany: postFindMany },
    sokoBotRuntimeEvent: { findFirst: eventFindFirst },
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

vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { expireTurn, startTurn, create: createBot },
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

import {
  approveCmoStrategy,
  chooseCmoMockPlan,
  cmoBusinessNameFromUrl,
  cmoExecutionRefusal,
  cmoLearningState,
  cmoUpNext,
  describeCmoStep,
  finishCmoAccountsStep,
  hasActiveCmoSubscription,
  isCmoAppUrl,
  keepCalendarWork,
  listCmoChannels,
  mergeBrandVisual,
  ownWords,
  parseCmoUpdates,
  pauseCmoCalendarEntry,
  reportCmoUpdate,
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
});

describe("strategy approval → execution gate", () => {
  const workspace = (approvedAt: Date | null) => ({
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    strategy,
    strategyApprovedAt: approvedAt,
  });

  it("asks the owner's own plan when Cuso works in their personal workspace", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    workspaceFindUnique.mockResolvedValue({ organizationId: null });
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" });
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ referenceId: "user-1" }),
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
    workspaceFindUnique.mockResolvedValue({ organizationId: null });
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("ignores CMO_MOCK_BILLING on production", async () => {
    mockBilling.on = true;
    mockBilling.production = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    workspaceFindUnique.mockResolvedValue({ organizationId: null });
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

describe("startCmoOnboarding", () => {
  const input = {
    userId: "user-1",
    workspaceId: "ws-1",
    websiteUrl: "https://www.acme.io",
    goals: "More leads",
  };

  beforeEach(() => {
    cmoFindUnique.mockResolvedValue(null);
    projectCreate.mockResolvedValue({ id: "project-1" });
    projectDelete.mockResolvedValue({ id: "project-1" });
    createBot.mockResolvedValue({ id: "bot-1" });
    cmoCreate.mockImplementation(async ({ data }) => ({
      id: "cmo-1",
      ...data,
    }));
    startTurn.mockResolvedValue({ turnId: "turn-1" });
  });

  it("refuses before hiring when the payer has no credits", async () => {
    getUserWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "personal",
      name: "Me",
      organizationId: null,
    });
    funding.spendable = 0;
    try {
      await expect(startCmoOnboarding(input)).rejects.toThrow("out of credits");
      expect(projectCreate).not.toHaveBeenCalled();
      expect(startTurn).not.toHaveBeenCalled();
    } finally {
      funding.spendable = 100;
    }
  });

  it("hires Cuso into the organization the person chose, under its name", async () => {
    getUserWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "organization",
      name: "Acme Inc",
    });

    await startCmoOnboarding(input);

    expect(getUserWorkspace).toHaveBeenCalledWith("user-1", { id: "ws-1" });
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-1",
          name: "CMO.xyz · Acme Inc",
          websiteUrl: input.websiteUrl,
        }),
      }),
    );
    expect(createBot).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", projectId: "project-1" }),
    );
    expect(cmoCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        businessName: "Acme Inc",
      }),
    });
  });

  it("names a personal workspace's business after the website", async () => {
    getUserWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "personal",
      name: "Ana Example",
    });

    await startCmoOnboarding(input);

    expect(cmoCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        businessName: "acme.io",
      }),
    });
  });

  it("refuses a workspace the person is not in, before creating anything", async () => {
    getUserWorkspace.mockRejectedValue(new Error("Workspace not found"));

    await expect(startCmoOnboarding(input)).rejects.toThrow(
      "Workspace not found",
    );
    expect(projectCreate).not.toHaveBeenCalled();
    expect(createBot).not.toHaveBeenCalled();
  });

  it("removes the Project, and with it Cuso, when hiring fails partway", async () => {
    getUserWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "personal",
      name: "Ana Example",
    });
    createBot.mockRejectedValue(new Error("bot failed"));

    await expect(startCmoOnboarding(input)).rejects.toThrow("bot failed");
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(cmoCreate).not.toHaveBeenCalled();
  });

  it("keeps the hire a second submit lost the race to, and cleans up", async () => {
    getUserWorkspace.mockResolvedValue({
      id: "ws-1",
      kind: "personal",
      name: "Ana Example",
    });
    cmoCreate.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    cmoFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cmo-0", workspaceId: "ws-1" });

    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      id: "cmo-0",
    });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("returns the person's existing Cuso without hiring again", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-0", workspaceId: "ws-0" });

    await expect(startCmoOnboarding(input)).resolves.toMatchObject({
      id: "cmo-0",
    });
    expect(getUserWorkspace).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });
});

describe("CMO return addresses", () => {
  it("accepts CMO.xyz and its previews, nothing else", () => {
    expect(isCmoAppUrl("https://app.cmo.xyz/connect/callback")).toBe(true);
    expect(
      isCmoAppUrl(
        "https://sokosumi-cmo-git-x.preview.cmo.xyz/connect/callback",
      ),
    ).toBe(true);
    expect(isCmoAppUrl("https://evil.example/cmo.xyz")).toBe(false);
    expect(isCmoAppUrl("http://app.cmo.xyz/connect/callback")).toBe(false);
    expect(isCmoAppUrl("https://cmo.xyz.evil.example/")).toBe(false);
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
    workspaceFindUnique.mockResolvedValue({ organizationId: null });
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

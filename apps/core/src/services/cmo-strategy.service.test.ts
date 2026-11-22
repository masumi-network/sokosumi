import { Prisma } from "@sokosumi/database";
import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { keepAnswers } from "@/helpers/question-answers";
import prisma from "@/lib/db/prisma";
import { detectSiteLanguage } from "@/lib/site-platform";
import {
  brainFindUnique,
  brainUpdate,
  cancelSocialPost,
  connectionFindMany,
  cusoFind,
  eventFindFirst,
  expireTurn,
  postCreateMany,
  postFindFirst,
  postFindMany,
  postUpdate,
  projectUpdate,
  referenceFindMany,
  resetCmoServiceMocks,
  revised,
  seedStrategy,
  sokoBotFindUnique,
  startTurn,
  strategy,
  strategyRows,
  turnFindFirst,
  turnFindUnique,
} from "@/test-fixtures/cmo-service";

const kickCmoProduction = vi.hoisted(() => vi.fn());
vi.mock("@/services/cmo-production.service", () => ({ kickCmoProduction }));

const libraryAvailable = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/services/reference-library.service", () => ({
  referenceLibraryAvailable: libraryAvailable,
}));

// PostgreSQL's clock is the test clock here.
const pgClock = vi.hoisted(() => ({ now: null as Date | null }));
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => pgClock.now ?? new Date(),
}));
vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  afterCmoTurn,
  answerCmoBrandQuestion,
  applyCmoPlanAnswers,
  cmoPlanAnswerNote,
  fixCmoBrandSection,
  keepCalendarWork,
  pauseCmoCalendarEntry,
  requestCmoStrategy,
  requireCmoStrategyFitted,
  saveCmoStrategy,
  setCmoAdBudget,
  startCmoPlanAfterResearch,
  startNextCmoChange,
  withoutDashes,
  withoutUnaskedAds,
} from "./cmo-strategy.service";

beforeEach(resetCmoServiceMocks);

const HIRE = {
  sokoBotId: "bot-1",
  workspaceId: "ws-1",
  projectId: "project-1",
};
const plan = (row: { plan: unknown }) => row.plan as typeof strategy;
const approvedRows = () => strategyRows.filter((row) => row.approvedAt);

const { isEvalCusoProject } = vi.hoisted(() => ({
  isEvalCusoProject: vi.fn(async () => false),
}));
vi.mock("@/lib/evals/eval-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evals/eval-guard")>()),
  isEvalCusoProject,
}));

vi.mock("@/lib/site-platform", () => ({
  detectSiteLanguage: vi.fn().mockResolvedValue("German"),
}));

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
  const cuso = {
    ...HIRE,
    userId: "user-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain,
  };

  it("leaves the approved version running while Cuso writes a new one", async () => {
    cusoFind.mockResolvedValue(cuso);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await expect(
      requestCmoStrategy({ projectId: "project-1", userId: "user-1" }),
    ).resolves.toEqual({
      turnId: "turn-9",
    });

    expect(approvedRows()).toHaveLength(1);
    expect(strategyRows).toHaveLength(1);
  });

  it("has Cuso correct each section the owner said no to before he plans", async () => {
    const question = {
      id: "q1",
      question: "Do most customers find you through Google?",
      statement: "Most customers find the business through Google",
      section: "marketing",
    };
    cusoFind.mockResolvedValue({
      ...cuso,
      brandBrain: {
        ...brandBrain,
        questions: [
          { ...question, answer: "no", note: "LinkedIn", corrected: false },
          { ...question, id: "q2", answer: "no", corrected: true },
          {
            ...question,
            id: "q3",
            section: "company",
            answer: "no",
            corrected: false,
          },
        ],
      },
    });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });
    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      note: "Fewer posts",
    });

    for (const [call] of startTurn.mock.calls) {
      const message: string = JSON.stringify(call);
      expect(message).toContain("First correct the Brand Brain");
      expect(message).toContain(
        '- marketing: you asked \\"Do most customers find you through Google?\\" and the owner said no. True instead: LinkedIn',
      );
      expect(message).toContain("- company: you asked");
      expect(message).toContain("Say the opposite plainly");
      expect(message.match(/- \w+: you asked/g)).toHaveLength(2);
    }
  });

  it("tells a cmo-v3 Cuso who is on each network before he sets roles", async () => {
    cusoFind.mockResolvedValue(cuso);
    startTurn.mockResolvedValue({ turnId: "turn-9" });
    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v3" });
    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });
    const v3 = JSON.stringify(startTurn.mock.lastCall);
    expect(v3).toContain("Who is on each network");
    expect(v3).toContain("- LinkedIn: People at work: buyers inside companies");
    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v2" });
    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });
    expect(JSON.stringify(startTurn.mock.lastCall)).not.toContain(
      "Who is on each network",
    );
  });

  it("posts in the language the website is written in", async () => {
    cusoFind.mockResolvedValue(cuso);
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });

    expect(JSON.stringify(startTurn.mock.lastCall)).toContain(
      "The website is written in German: set contentLanguage to German",
    );
  });

  // NMKR, 21 Nov 2026: "send the whole calendar" did not fit a 160-entry month.
  it("has cmo-v13 save an owner's change as a part patch, never the whole calendar", async () => {
    cusoFind.mockResolvedValue(cuso);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v13" });
    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      note: "2 a day on X",
    });
    const v13 = JSON.stringify(startTurn.mock.lastCall);
    expect(v13).toContain(
      "Save with save_strategy part patch: only the calendar entries you change",
    );
    expect(v13).not.toContain("(send the whole calendar)");

    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v10" });
    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      note: "2 a day on X",
    });
    expect(JSON.stringify(startTurn.mock.lastCall)).toContain(
      "(send the whole calendar)",
    );
  });

  it("uses the frozen site language without reading the live German site", async () => {
    cusoFind.mockResolvedValue(cuso);
    startTurn.mockResolvedValue({ turnId: "turn-9" });
    vi.mocked(detectSiteLanguage).mockClear();

    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      siteLanguage: "English",
    });

    expect(detectSiteLanguage).not.toHaveBeenCalled();
    const message = JSON.stringify(startTurn.mock.lastCall);
    expect(message).toContain("set contentLanguage to English");
    expect(message).toContain(
      "Every piece is in it, from its calendar title, brief and story",
    );
    expect(message).toContain(
      "Write acme.io's marketing strategy for the four weeks",
    );
  });

  it("plans four dated weeks around the season, with no week five", async () => {
    vi.useFakeTimers({
      now: new Date("2026-11-08T12:00:00Z"),
      toFake: ["Date"],
    });
    cusoFind.mockResolvedValue(cuso);
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });
    vi.useRealTimers();

    const message = JSON.stringify(startTurn.mock.lastCall);
    expect(message).toContain(
      "for the four weeks from 2026-11-09 to 2026-12-06. No calendar entry after 2026-12-06.",
    );
    expect(message).toContain(
      "list the dates between 2026-11-09 and 2026-12-06",
    );
    expect(message).toContain("Never invent a discount");
    // A "short" save once read as a short calendar: 20 pieces for a pace of 60.
    expect(message).not.toContain("short calls");
    expect(message).toContain(
      "The calendar holds every piece the pace and each channel's cadence call for",
    );
  });

  it("asks for no correction once every no is in the Brand Brain", async () => {
    cusoFind.mockResolvedValue(cuso);
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });

    expect(JSON.stringify(startTurn.mock.lastCall)).not.toContain(
      "First correct the Brand Brain",
    );
  });

  it("writes one version for an ad budget, which Cuso's re-plan completes", async () => {
    cusoFind.mockResolvedValue(cuso);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await setCmoAdBudget({
      projectId: "project-1",
      userId: "user-1",
      monthly: 500,
      currency: "eur",
    });
    expect(cusoFind).toHaveBeenCalledTimes(1);
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "Ads around the owner's budget." },
      { turnId: "turn-9" },
    );

    expect(strategyRows).toHaveLength(2);
    const added = strategyRows.find((row) => row.id !== running.id)!;
    expect(added).toMatchObject({
      authorUserId: "user-1",
      authorTurnId: "turn-9",
    });
    expect(plan(added).summary).toBe("Ads around the owner's budget.");
    expect(added.plan).toMatchObject({
      ads: { monthly: 500, currency: "EUR", setByOwner: true },
    });
  });
});

describe("the plan starts when the research ends", () => {
  const essentials = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
    profile: {},
  };
  const cuso = {
    ...HIRE,
    userId: "user-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain: essentials,
  };
  const now = new Date("2026-11-10T10:00:00Z");
  const planTurn = (minutesAgo: number, status = "RUNNING") => ({
    id: "plan-1",
    status,
    eveSessionId: "sess-1",
    clientTurnId: "cmo:strategy:bot-1:1",
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  // clearAllMocks keeps implementations; the race test sets its own.
  const resetTurns = () => {
    turnFindFirst.mockReset();
    startTurn.mockReset();
  };
  afterEach(() => {
    resetTurns();
    pgClock.now = null;
    vi.useRealTimers();
  });

  beforeEach(() => {
    resetTurns();
    pgClock.now = now;
    cusoFind.mockResolvedValue(cuso);
    // The plan turn keeps making progress.
    eventFindFirst.mockResolvedValue({ createdAt: now });
  });

  it("after a chat turn reads only the Cuso when no fix is open", async () => {
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "chat:1",
      }),
    ).resolves.toBeNull();
    expect(cusoFind).toHaveBeenCalledTimes(1);
    expect(turnFindFirst).not.toHaveBeenCalled();
    expect(isEvalCusoProject).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("plans an ad budget the owner set while Cuso was busy, once his turn ends", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    seedStrategy(strategy);
    cusoFind.mockResolvedValue({
      ...cuso,
      pendingAdBudget: { monthly: 300, currency: "USD", userId: "user-1" },
    });
    turnFindFirst.mockResolvedValue(planTurn(1, "COMPLETED"));
    startTurn.mockResolvedValue({ turnId: "ads-1" });
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:strategy:bot-1:1",
      }),
    ).resolves.toEqual({ turnId: "ads-1" });
    expect(JSON.stringify(startTurn.mock.calls[0])).toContain(
      "My ad budget is USD 300 a month",
    );
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { cmoPendingAdBudget: Prisma.DbNull },
    });
  });

  it("moves the month on when a production run ends, without waiting for the sync", async () => {
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:production:bot-1:1795131677092:1:2",
      }),
    ).resolves.toBeNull();
    expect(kickCmoProduction).toHaveBeenCalledWith("bot-1");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts the plan when the research turn settles", async () => {
    startTurn.mockResolvedValue({ turnId: "plan-1" });
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:onboarding:project-1:1",
      }),
    ).resolves.toEqual({ turnId: "plan-1" });
    expect(cusoFind).toHaveBeenCalledTimes(1);
  });

  it("finishes a weekly month the plan turn left short of four weeks, twice at most", async () => {
    seedStrategy(strategy);
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    startTurn.mockResolvedValue({ turnId: "finish-1" });
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:strategy:bot-1:1",
      }),
    ).resolves.toEqual({ turnId: "finish-1" });
    const started = startTurn.mock.calls[0]?.[0] as {
      clientTurnId: string;
      message: string;
    };
    expect(started.clientTurnId).toMatch(/^cmo:strategy:bot-1:finish:\d+:1$/);
    expect(started.message).toContain(
      "Finish acme.io's marketing strategy: its calendar covers 3 of four weeks, up to 2026-10-20.",
    );

    startTurn.mockClear();
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: started.clientTurnId.replace(/:1$/, ":2"),
      }),
    ).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("finishes a four-week month short of its cadences: NMKR's test copy planned a third", async () => {
    // Four weeks, one LinkedIn piece a week against "3 a week".
    const week = (index: number) => ({
      ...strategy.calendar[0],
      id: `w${index}`,
      date: `2026-10-${String(1 + index * 7).padStart(2, "0")}`,
    });
    seedStrategy({ ...strategy, calendar: [0, 1, 2, 3].map(week) });
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    startTurn.mockResolvedValue({ turnId: "finish-1" });
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:strategy:bot-1:1",
      }),
    ).resolves.toEqual({ turnId: "finish-1" });
    const message = (startTurn.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain(
      "its calendar does not hold what the strategy promises",
    );
    expect(message).toContain(
      'linkedin has 4 calendar pieces, but its cadence "3 a week" means about 12',
    );
    expect(message).toContain(
      "Never lower the pace or a posting network's cadence",
    );
  });

  it("fits a month still short after its last finish turn, so the owner can approve it", async () => {
    const week = (index: number) => ({
      ...strategy.calendar[0],
      id: `w${index}`,
      date: `2026-10-${String(1 + index * 7).padStart(2, "0")}`,
    });
    const short = seedStrategy({
      ...strategy,
      calendar: [0, 1, 2, 3].map(week),
    });
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    await expect(requireCmoStrategyFitted(HIRE, short.id)).rejects.toThrow(
      "Cuso is still filling this month",
    );
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:strategy:bot-1:finish:1795308874573:2",
      }),
    ).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
    const fitted = short.plan as unknown as MarketingStrategyPlan;
    expect(
      fitted.channels.find((channel) => channel.channel === "linkedin")
        ?.cadence,
    ).toBe("1 a week");
    await requireCmoStrategyFitted(HIRE, short.id);
  });

  it("finishes a month whose funnel promises video the calendar does not hold", async () => {
    // Four weeks at the owner's "3 a week", and a play that promises video.
    const day = (index: number) => ({
      ...strategy.calendar[0],
      id: `w${index}`,
      date: `2026-10-${String(1 + Math.floor(index / 3) * 7 + (index % 3) * 2).padStart(2, "0")}`,
    });
    seedStrategy({
      ...strategy,
      channels: [
        { channel: "linkedin", cadence: "3 a week", setByOwner: true },
      ],
      pace: { level: "all_in", why: "Top volume.", perWeek: 3 },
      funnel: [
        {
          stage: "interest",
          goal: "g",
          cusoDoes: "I post how-tos.",
          channels: ["linkedin"],
          metric: "Trials",
          plays: [{ channel: "linkedin", what: "A weekly founder video" }],
        },
      ],
      calendar: Array.from({ length: 12 }, (_, index) => day(index)),
    });
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    startTurn.mockResolvedValue({ turnId: "finish-1" });
    await expect(
      afterCmoTurn({
        sokoBotId: "bot-1",
        userId: "user-1",
        clientTurnId: "cmo:strategy:bot-1:1",
      }),
    ).resolves.toEqual({ turnId: "finish-1" });
    const message = (startTurn.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain(
      "the funnel's interest play on linkedin promises video",
    );
    expect(message).toContain(
      "first add the network to the alsoOn of talking videos already planned",
    );
  });

  it("finishes nothing for a whole month, an approved one, or a Cuso who saves in two calls", async () => {
    // Four weeks at "3 a week", the cadence the owner asked for: twelve pieces.
    const day = (index: number) => ({
      ...strategy.calendar[0],
      id: `w${index}`,
      date: `2026-10-${String(1 + Math.floor(index / 3) * 7 + (index % 3) * 2).padStart(2, "0")}`,
    });
    seedStrategy({
      ...strategy,
      channels: [
        { channel: "linkedin", cadence: "3 a week", setByOwner: true },
      ],
      pace: { level: "all_in", why: "Top volume.", perWeek: 3 },
      calendar: Array.from({ length: 12 }, (_, index) => day(index)),
    });
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    const ended = {
      sokoBotId: "bot-1",
      userId: "user-1",
      clientTurnId: "cmo:strategy:bot-1:1",
    };
    await expect(afterCmoTurn(ended)).resolves.toBeNull();
    seedStrategy(strategy, { approvedAt: new Date() });
    await expect(afterCmoTurn(ended)).resolves.toBeNull();
    seedStrategy(strategy);
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v2" });
    await expect(afterCmoTurn(ended)).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts no plan in an eval lane: its strategy cases ask for their own", async () => {
    isEvalCusoProject.mockResolvedValueOnce(true);

    await expect(
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts the plan once the research saved the essentials", async () => {
    startTurn.mockResolvedValue({ turnId: "plan-1" });

    await expect(
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toEqual({ turnId: "plan-1" });

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn.mock.calls[0]?.[0]).toMatchObject({
      sokoBotId: "bot-1",
      userId: "user-1",
      clientTurnId: expect.stringMatching(/^cmo:strategy:bot-1:/),
    });
  });

  it("starts nothing when the research ended without the essentials", async () => {
    cusoFind.mockResolvedValue({ ...cuso, brandBrain: { profile: {} } });
    await expect(
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts nothing once a plan was started or written", async () => {
    turnFindFirst.mockResolvedValueOnce(planTurn(30, "COMPLETED"));
    await expect(
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toBeNull();

    seedStrategy(strategy);
    await expect(
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts the first plan after a brand fix that ran before it", async () => {
    turnFindFirst.mockResolvedValue({
      ...planTurn(3, "COMPLETED"),
      id: "fix-1",
      clientTurnId: "cmo:strategy:bot-1:fix:1:1",
    });
    startTurn.mockResolvedValue({ turnId: "plan-2" });
    await expect(
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toEqual({ turnId: "plan-2" });
  });

  it("never takes a running fix or patch for the plan", async () => {
    for (const clientTurnId of [
      "cmo:strategy:bot-1:fix:1:1",
      "cmo:strategy:bot-1:patch:1",
    ]) {
      turnFindFirst.mockResolvedValue({
        ...planTurn(13),
        id: "change-1",
        clientTurnId,
      });
      // A change waits for it to land.
      await expect(
        requestCmoStrategy({
          projectId: "project-1",
          userId: "user-1",
          note: "Fewer posts",
        }),
      ).rejects.toThrow("finishing a change");
      // A plain ask gets it back: the first plan starts once it ends.
      await expect(
        requestCmoStrategy({ projectId: "project-1", userId: "user-1" }),
      ).resolves.toEqual({ turnId: "change-1" });
    }
    expect(expireTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("lets Looks like us confirm without starting a second plan", async () => {
    turnFindFirst.mockResolvedValue(planTurn(2));

    await expect(
      requestCmoStrategy({ projectId: "project-1", userId: "user-1" }),
    ).resolves.toEqual({ turnId: "plan-1" });

    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts one plan when Looks like us races the research's end", async () => {
    // Core runs one turn at a time per bot: the second start is refused,
    // and by then the first one's turn is there to read.
    let started = false;
    turnFindFirst.mockImplementation(async () =>
      started ? planTurn(0) : null,
    );
    startTurn.mockImplementation(async () => {
      if (started) throw new Error("Soko Bot is already working");
      started = true;
      return { turnId: "plan-1" };
    });

    const [fromResearch, fromApprove] = await Promise.all([
      startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" }),
      requestCmoStrategy({ projectId: "project-1", userId: "user-1" }),
    ]);

    expect(fromResearch).toEqual({ turnId: "plan-1" });
    expect(fromApprove).toEqual({ turnId: "plan-1" });
    expect(started).toBe(true);
  });

  it("refuses a change while the plan is still being written", async () => {
    turnFindFirst.mockResolvedValue(planTurn(2));
    await expect(
      requestCmoStrategy({
        projectId: "project-1",
        userId: "user-1",
        note: "Fewer posts",
      }),
    ).rejects.toThrow("still writing the strategy");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("keeps an ad budget set while the plan is being written, for when it lands", async () => {
    // The budget reads the clock itself.
    vi.useFakeTimers({ now, toFake: ["Date"] });
    turnFindFirst.mockResolvedValue(planTurn(2));
    seedStrategy(strategy);
    await expect(
      setCmoAdBudget({
        projectId: "project-1",
        userId: "user-1",
        monthly: 500,
        currency: "eur",
      }),
    ).resolves.toEqual({ turnId: null, queued: true });
    expect(startTurn).not.toHaveBeenCalled();
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        cmoPendingAdBudget: { monthly: 500, currency: "EUR", userId: "user-1" },
      },
    });
  });
});

describe("saving versions", () => {
  it("adds a version per turn and completes it with the turn's later saves", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "A sharper headline." },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [strategy.calendar[0]!] },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );

    expect(strategyRows).toHaveLength(2);
    const added = strategyRows.find((row) => row.id !== running.id)!;
    expect(added).toMatchObject({
      authorTurnId: "turn-1",
      authorSokoBotId: "bot-1",
      approvedAt: null,
    });
    expect(plan(added).summary).toBe("A sharper headline.");
    // The approved version is never rewritten by a new plan.
    expect(plan(running)).toEqual(strategy);
  });

  const ownerSet = (row: (typeof strategyRows)[number]) =>
    (plan(row).channels[0] as { setByOwner?: boolean } | undefined)?.setByOwner;

  it("marks a cadence the owner lowered in chat as theirs, and never one Cuso marks himself", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const linkedin = (cadence: string, setByOwner?: boolean) => ({
      channels: [
        { channel: "linkedin", cadence, role: "main" as const, setByOwner },
      ],
    });
    turnFindUnique.mockResolvedValueOnce({
      source: "CHAT",
      userMessage: "Only 1 a day on LinkedIn, please.",
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, linkedin("1 a day"), {
      turnId: "turn-1",
    });
    expect(ownerSet(strategyRows.at(-1)!)).toBe(true);

    turnFindUnique.mockResolvedValueOnce({
      source: "SCHEDULE",
      userMessage: "Daily check",
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, linkedin("1 a week", true), {
      turnId: "turn-2",
    });
    expect(ownerSet(strategyRows.at(-1)!)).toBeUndefined();
  });

  it("starts a new version once the turn's own one was approved", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy, {
      authorTurnId: "turn-1",
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });

    await saveCmoStrategy({ sokoBotId: "bot-1" }, revised, {
      turnId: "turn-1",
    });

    expect(strategyRows).toHaveLength(2);
    expect(plan(strategyRows[0]!)).toEqual(strategy);
  });

  describe("pictures of the approved month", () => {
    const STYLE_A = "01a1eb53-3608-720e-8fa1-84dcd2eb5ec9";
    const STYLE_B = "01a1eb55-a767-7259-af74-b1d86f203752";
    const picture = (patch: Record<string, unknown>) => ({
      ...strategy.calendar[0]!,
      format: "image",
      visual: "The booking page on a desk",
      ...patch,
    });
    const savePieces = (calendar: unknown[]) =>
      saveCmoStrategy({ sokoBotId: "bot-1" }, { calendar } as never, {
        turnId: "turn-2",
        part: "pieces",
      });

    beforeEach(() => {
      cusoFind.mockResolvedValue(HIRE);
      seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
      libraryAvailable.mockReturnValue(true);
      referenceFindMany.mockResolvedValue([{ id: STYLE_A }, { id: STYLE_B }]);
      postFindMany.mockResolvedValue([
        {
          id: "01a10b97-d4d3-7264-b4d5-0a396e87c0ad",
          status: "DRAFT",
          planning: {
            id: "other",
            title: "Styled before",
            format: "image",
            styleReferenceId: STYLE_B,
          },
        },
      ]);
    });
    afterEach(() => libraryAvailable.mockReturnValue(false));

    it("refuses a picture without a library style, and saves nothing", async () => {
      await expect(savePieces([picture({ id: "p1" })])).rejects.toThrow(
        "p1 has a picture and no style",
      );
      expect(postCreateMany).not.toHaveBeenCalled();
      expect(postUpdate).not.toHaveBeenCalled();
    });

    it("refuses a reference another piece of the month already uses", async () => {
      await expect(
        savePieces([picture({ id: "p1", styleReferenceId: STYLE_B })]),
      ).rejects.toThrow("p1 and other use the same style reference");
      await expect(
        savePieces([
          picture({ id: "p1", styleReferenceId: STYLE_A }),
          picture({ id: "p2", styleReferenceId: STYLE_A }),
        ]),
      ).rejects.toThrow("p2 and p1 use the same style reference");
    });

    // cmo-v9 (2026-11-21): NMKR's visuals named "cream paper, dark ink, one
    // green accent" and "no extra text", and the look overrode the print's.
    it("refuses a cmo-v9 styled visual that names its own look, and keeps a scene", async () => {
      const save = (visual: string, sceneVisuals: boolean) =>
        saveCmoStrategy(
          { sokoBotId: "bot-1" },
          {
            calendar: [
              picture({ id: "p1", styleReferenceId: STYLE_A, visual }),
            ],
          } as never,
          { turnId: "turn-2", part: "pieces", sceneVisuals },
        );
      const styledVisual =
        "A three-step pictogram of a mint, cream paper, dark ink and one green accent; no extra text.";
      await expect(save(styledVisual, true)).rejects.toThrow(
        "p1 (pictogram, accent, cream paper, dark ink, no extra text)",
      );
      await expect(save(styledVisual, true)).rejects.toThrow(
        "Describe the scene only",
      );
      expect(postCreateMany).not.toHaveBeenCalled();
      expect(postUpdate).not.toHaveBeenCalled();
      // cmo-v8 saves it as before.
      await expect(save(styledVisual, false)).resolves.toBeDefined();
      await expect(
        save(
          "A crane hook lifting a glowing green token above a factory city.",
          true,
        ),
      ).resolves.toBeDefined();
    });

    it("refuses a styled carousel without its words per slide, and an id the library lacks", async () => {
      const carousel = picture({
        id: "c1",
        format: "images",
        styleReferenceId: STYLE_A,
        slides: ["The board", "The gate"],
      });
      await expect(savePieces([carousel])).rejects.toThrow(
        "c1 needs slideHeadlines, one entry per slide (2)",
      );
      referenceFindMany.mockResolvedValue([]);
      await expect(
        savePieces([picture({ id: "p1", styleReferenceId: STYLE_A })]),
      ).rejects.toThrow(`${STYLE_A} is no style reference`);
    });

    it("saves styled pictures, a plain one where there is no library, and text as before", async () => {
      referenceFindMany.mockResolvedValue([
        { id: STYLE_A },
        { id: "01a1eb1e-6063-70a2-bcc4-03bab65abd2f" },
      ]);
      await savePieces([
        picture({ id: "p1", styleReferenceId: STYLE_A, headline: "Book it" }),
        picture({
          id: "c1",
          format: "images",
          styleReferenceId: "01a1eb1e-6063-70a2-bcc4-03bab65abd2f",
          slides: ["The board", "The gate"],
          slideHeadlines: ["Review the drafts", "Then it goes live"],
        }),
        { ...strategy.calendar[0]!, id: "t1", draft: "Words only." },
      ]);
      expect(postCreateMany).toHaveBeenCalledTimes(1);
      postCreateMany.mockClear();
      libraryAvailable.mockReturnValue(false);
      await savePieces([picture({ id: "p9" })]);
      expect(postCreateMany).toHaveBeenCalledTimes(1);
    });
  });

  it("fills pieces into the approved version's Social posts, not a newer draft", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    const draft = seedStrategy(revised);
    const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";
    postFindMany.mockResolvedValue([
      {
        id: postId,
        status: "DRAFT",
        planning: { id: "a", title: "Customer story", format: "post" },
      },
    ]);
    connectionFindMany.mockResolvedValue([
      { id: "conn-li", provider: "linkedin" },
    ]);
    const newsletter = {
      id: "nl",
      date: "2026-10-22",
      channel: "newsletter",
      title: "October issue",
      format: "issue",
      status: "draft" as const,
      draft: "Hello.",
    };

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      {
        calendar: [
          // By the post's id, as Cuso's calendar shows it.
          {
            ...strategy.calendar[0]!,
            id: postId,
            draft: "Written.",
            hook: "Ten minutes.",
          },
          {
            ...strategy.calendar[0]!,
            id: "news",
            date: "2026-10-21",
            time: "08:00",
            title: "Award",
            brief: "We won.",
          },
          newsletter,
        ],
      },
      { turnId: "turn-2", part: "pieces" },
    );

    expect(postUpdate).toHaveBeenCalledWith({
      where: { id: postId },
      data: {
        planning: {
          id: "a",
          title: "Customer story",
          format: "post",
          hook: "Ten minutes.",
        },
        scheduledAt: new Date("2026-10-20T09:00:00Z"),
        text: "Written.",
        revision: { increment: 1 },
      },
    });
    // A piece the daily watch adds is a new draft of the running version.
    expect(postCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          marketingStrategyId: running.id,
          workspaceId: "ws-1",
          provider: "linkedin",
          socialConnectionId: "conn-li",
          status: "DRAFT",
          text: "We won.",
          scheduledAt: new Date("2026-10-21T08:00:00Z"),
          creatorSokoBotId: "bot-1",
          planning: expect.objectContaining({ id: "news", title: "Award" }),
        }),
      ],
    });
    // A new piece that is a file joins the running version's calendar
    // without its words, which its file holds; no other version changes.
    const { draft: _words, ...planned } = newsletter;
    expect(strategyRows).toHaveLength(2);
    expect(plan(running).calendar).toEqual([...strategy.calendar, planned]);
    expect(plan(draft)).toEqual(revised);
  });

  it("adds a search ad written in chat to the approved calendar, without its parts", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    const ad = {
      id: "kw-calendly-alternative",
      date: "2026-10-22",
      channel: "google_ads",
      title: "Calendly alternative search ad",
      format: "search_ad",
      status: "draft" as const,
      campaignId: "competitor-searches",
      draft: "Headlines:\n- Calendly Alternative",
      searchAd: {
        keywords: ["calendly alternative"],
        headlines: ["Calendly Alternative", "Open Source Scheduling", "Free"],
        descriptions: ["Scheduling you own.", "Start free in two minutes."],
        finalUrl: "https://acme.io",
        location: "United States",
      },
    };

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [ad] },
      { turnId: "turn-2", part: "pieces" },
    );
    // Sent again, it is already planned and is not added twice.
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [ad] },
      { turnId: "turn-3", part: "pieces" },
    );

    const { draft: _words, searchAd: _parts, ...planned } = ad;
    expect(plan(running).calendar).toEqual([...strategy.calendar, planned]);
  });

  it("refuses a new piece in a format its channel does not have", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });

    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        {
          calendar: [
            {
              id: "page",
              date: "2026-10-22",
              channel: "google_ads",
              title: "Calendly alternative page",
              format: "landing_page",
              status: "draft" as const,
              draft: "# Calendly alternative",
            },
          ],
        },
        { turnId: "turn-2", part: "pieces" },
      ),
    ).rejects.toThrow('google_ads has no format "landing_page"');

    expect(plan(running)).toEqual(strategy);
  });

  describe("a talking video that also goes out on other networks", () => {
    const video = {
      id: "tv",
      date: "2026-10-23",
      time: "17:00",
      channel: "instagram",
      title: "One link, no emails",
      format: "talking_video",
      status: "draft" as const,
      script:
        "Stop emailing back and forth. Send one booking link and let people pick a time.",
      presenter: "maya",
      voice: "Sarah",
      alsoOn: ["youtube", "facebook"],
    };
    const stored = (planning: object, provider: string, id: string) => ({
      id,
      status: "DRAFT",
      provider,
      planning: { title: video.title, format: video.format, ...planning },
    });

    beforeEach(() => {
      cusoFind.mockResolvedValue(HIRE);
      seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    });

    it("plans one post per network, each showing the one video", async () => {
      await saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar: [video] },
        { turnId: "turn-2", part: "pieces" },
      );

      const drafts = postCreateMany.mock.calls[0]?.[0].data;
      expect(
        drafts.map((draft: { provider: string; planning: object }) => [
          draft.provider,
          draft.planning,
        ]),
      ).toEqual([
        [
          "instagram",
          expect.objectContaining({
            id: "tv",
            alsoOn: ["youtube", "facebook"],
          }),
        ],
        [
          "youtube",
          expect.objectContaining({
            id: "tv@youtube",
            videoOf: "tv",
            script: video.script,
            presenter: "maya",
          }),
        ],
        [
          "facebook",
          expect.objectContaining({ id: "tv@facebook", videoOf: "tv" }),
        ],
      ]);
      expect(drafts[1].planning).not.toHaveProperty("alsoOn");
      expect(drafts[1].scheduledAt).toEqual(drafts[0].scheduledAt);
    });

    it("gives every post a new script and cancels a network taken off the list", async () => {
      postFindMany.mockResolvedValue([
        stored(
          { id: "tv", script: video.script, alsoOn: video.alsoOn },
          "instagram",
          "p-ig",
        ),
        stored(
          { id: "tv@youtube", videoOf: "tv", script: video.script },
          "youtube",
          "p-yt",
        ),
        stored(
          { id: "tv@facebook", videoOf: "tv", script: video.script },
          "facebook",
          "p-fb",
        ),
      ]);
      const script = `${video.script} Try it on your next call.`;

      await saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar: [{ ...video, id: "p-ig", script, alsoOn: ["youtube"] }] },
        { turnId: "turn-2", part: "pieces" },
      );

      expect(postUpdate).toHaveBeenCalledWith({
        where: { id: "p-fb" },
        data: expect.objectContaining({ status: "CANCELED" }),
      });
      expect(postUpdate).toHaveBeenCalledWith({
        where: { id: "p-yt" },
        data: expect.objectContaining({
          planning: expect.objectContaining({ videoOf: "tv", script }),
        }),
      });
      expect(postCreateMany).not.toHaveBeenCalled();
    });

    it("keeps a copy speaking its entry's script when the copy itself is saved", async () => {
      postFindMany.mockResolvedValue([
        stored(
          { id: "tv@youtube", videoOf: "tv", script: video.script },
          "youtube",
          "p-yt",
        ),
      ]);

      await saveCmoStrategy(
        { sokoBotId: "bot-1" },
        {
          calendar: [
            {
              ...video,
              id: "p-yt",
              channel: "youtube",
              alsoOn: undefined,
              script:
                "Another script entirely, which only this post would speak.",
              hook: "No more email ping-pong",
            },
          ],
        },
        { turnId: "turn-2", part: "pieces" },
      );

      expect(postUpdate).toHaveBeenCalledWith({
        where: { id: "p-yt" },
        data: expect.objectContaining({
          planning: expect.objectContaining({
            videoOf: "tv",
            script: video.script,
            hook: "No more email ping-pong",
          }),
        }),
      });
      const planning = postUpdate.mock.lastCall?.[0]?.data.planning;
      expect(planning?.videoOf).toBe("tv");
      expect(planning).not.toHaveProperty("alsoOn");
    });

    it.each([
      [
        "a network without talking videos",
        { ...video, alsoOn: ["youtube", "x"] },
        /tv cannot also go out on x: alsoOn takes other live networks with a talking_video format \(linkedin, facebook, youtube, tiktok\)/,
      ],
      [
        "its own channel",
        { ...video, alsoOn: ["instagram"] },
        /tv cannot also go out on instagram/,
      ],
      [
        "a piece that is not a talking video",
        { ...video, format: "image", script: undefined },
        /tv lists alsoOn, which only a talking_video takes/,
      ],
    ])("refuses %s, writing nothing", async (_name, entry, message) => {
      await expect(
        saveCmoStrategy(
          { sokoBotId: "bot-1" },
          { calendar: [entry] },
          { turnId: "turn-2", part: "pieces" },
        ),
      ).rejects.toThrow(message);
      expect(postCreateMany).not.toHaveBeenCalled();
    });
  });

  it("refuses pieces while no version is approved, writing nothing", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const draft = seedStrategy(strategy);

    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar: [{ ...strategy.calendar[0]!, draft: "Written." }] },
        { turnId: "turn-2", part: "pieces" },
      ),
    ).rejects.toThrow(
      /no version is approved yet; until the owner approves, change entries with part patch/,
    );

    expect(strategyRows).toHaveLength(1);
    expect(plan(draft)).toEqual(strategy);
    expect(postCreateMany).not.toHaveBeenCalled();
  });

  it("builds a rhythm's version on the approved one, not a newer draft", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    seedStrategy({ ...revised, goals: ["Draft goal"] });

    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "Weekly change." },
      { turnId: "turn-3", executing: true },
    );

    expect(plan(saved).goals).toEqual(strategy.goals);
  });

  it("keeps calendar entries outside the 31 days a turn can see", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const far = {
      id: "d",
      date: "2026-12-01",
      channel: "linkedin",
      title: "December",
      format: "post",
      status: "idea" as const,
    };
    seedStrategy({ ...strategy, calendar: [...strategy.calendar, far] });
    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
      { turnId: "turn-1", now: new Date("2026-10-07T12:00:00Z") },
    );
    // Oct 2 and Dec 1 were outside the window. Oct 8 was inside it and omitted.
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual([
      "b",
      "a",
      "d",
    ]);
  });

  it("keeps what a save leaves out, so a plan can arrive in short calls", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { summary: "A sharper headline." },
      { turnId: "turn-1", now: new Date("2026-10-01T12:00:00Z") },
    );
    expect(plan(saved).summary).toBe("A sharper headline.");
    expect(saved.plan).toStrictEqual(JSON.parse(JSON.stringify(saved.plan)));
    expect(plan(saved).goals).toEqual(strategy.goals);
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual(
      strategy.calendar.map((entry) => entry.id),
    );
  });

  it("keeps saved previews when a weekly drafting save sends none", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const preview = {
      kind: "post" as const,
      channel: "linkedin",
      title: "Sample",
      body: "A sample post.",
    };
    seedStrategy({ ...strategy, previews: [preview] });
    const saved = await saveCmoStrategy({ sokoBotId: "bot-1" }, strategy, {
      turnId: "turn-1",
    });
    expect(plan(saved).previews).toEqual([preview]);
  });

  it("keeps what Cuso fills with an empty list or text", async () => {
    // A tool call fills every field: changing one channel's cadence sent the
    // goals, the summary and the calendar empty and wiped them.
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...strategy, summary: "", goals: [], calendar: [] },
      { turnId: "turn-1" },
    );
    expect(plan(saved).summary).toBe(strategy.summary);
    expect(plan(saved).goals).toEqual(strategy.goals);
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual(
      strategy.calendar.map((entry) => entry.id),
    );
  });

  it("empties a list Cuso names in clear, and only that one", async () => {
    cusoFind.mockResolvedValue(HIRE);
    const preview = {
      kind: "post" as const,
      channel: "linkedin",
      title: "Sample",
      body: "Text.",
    };
    seedStrategy({ ...strategy, previews: [preview] });
    const saved = await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...strategy, previews: [], goals: [] },
      { turnId: "turn-1", clear: ["previews"] },
    );
    expect(plan(saved).previews).toEqual([]);
    expect(plan(saved).goals).toEqual(strategy.goals);
  });

  it("still lets an owner clear a list", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy({
      ...strategy,
      previews: [
        { kind: "post", channel: "linkedin", title: "Sample", body: "Text." },
      ],
    });
    const owner = await saveCmoStrategy(
      { userId: "user-1", projectId: "project-1" },
      { ...strategy, previews: [] },
    );
    expect(plan(owner).previews).toEqual([]);
  });

  it("lets an owner save replace the calendar, including hidden days", async () => {
    cusoFind.mockResolvedValue(HIRE);
    seedStrategy(strategy);
    const saved = await saveCmoStrategy(
      { projectId: "project-1", userId: "user-1" },
      { ...strategy, calendar: [strategy.calendar[0]!] },
    );
    expect(saved).toMatchObject({ authorUserId: "user-1", authorTurnId: null });
    expect(plan(saved).calendar.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("pauseCmoCalendarEntry", () => {
  const postId = "01a10b97-d4d3-7264-b4d5-0a396e87c0ad";

  it("cancels the entry's Social post and leaves the plan as approved", async () => {
    cusoFind.mockResolvedValue({ ...HIRE, userId: "user-1" });
    const running = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    postFindFirst.mockResolvedValue({ status: "SCHEDULED", revision: 2 });
    cancelSocialPost.mockResolvedValue({});

    await pauseCmoCalendarEntry({
      projectId: "project-1",
      userId: "user-1",
      entryId: postId,
    });

    expect(postFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: postId, projectId: "project-1" },
      }),
    );
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 2, projectId: "project-1" }),
    );
    expect(plan(running)).toEqual(strategy);
  });

  it("refuses a post that is already going out", async () => {
    cusoFind.mockResolvedValue({ ...HIRE, userId: "user-1" });
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    postFindFirst.mockResolvedValue({ status: "PUBLISHING", revision: 3 });
    cancelSocialPost.mockRejectedValue(
      new Error("The post can no longer be canceled"),
    );

    await expect(
      pauseCmoCalendarEntry({
        projectId: "project-1",
        userId: "user-1",
        entryId: postId,
      }),
    ).rejects.toThrow("no longer be canceled");
    expect(cancelSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId, revision: 3 }),
    );
  });

  it("refuses an entry that is not a Social post and leaves the plan as approved", async () => {
    cusoFind.mockResolvedValue({ ...HIRE, userId: "user-1" });
    const newsletter = {
      id: "nl",
      date: "2026-10-22",
      channel: "newsletter",
      title: "October issue",
      format: "issue",
      status: "idea" as const,
    };
    const running = seedStrategy(
      { ...strategy, calendar: [...strategy.calendar, newsletter] },
      { approvedAt: new Date("2026-10-01T09:00:00Z") },
    );

    await expect(
      pauseCmoCalendarEntry({
        projectId: "project-1",
        userId: "user-1",
        entryId: "nl",
      }),
    ).rejects.toThrow(/Social post/);

    expect(plan(running).calendar.at(-1)?.status).toBe("idea");
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

  it("keeps every field a kept entry leaves out", () => {
    const kept = keepCalendarWork(
      [
        {
          ...entry("a", "2026-11-02", "Customer story", "Full text"),
          imageFileId: "file-1",
        },
      ],
      [entry("a", "2026-11-09", "Customer story")],
    );
    expect(kept[0]).toMatchObject({
      date: "2026-11-09",
      draft: "Full text",
      imageFileId: "file-1",
    });
  });

  it("leaves the old piece's files behind when the entry changes channel", () => {
    const kept = keepCalendarWork(
      [
        {
          ...entry("a", "2026-11-02", "Customer story", "Full text"),
          imageFileId: "file-1",
        },
      ],
      [{ ...entry("a", "2026-11-02", "Customer story"), channel: "x" }],
    );
    expect(kept[0]?.draft).toBe("Full text");
    expect(kept[0]?.imageFileId).toBeUndefined();
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

describe("plan questions", () => {
  const question = (id: string, patch = {}) => ({
    id,
    question: "Do you get about 30 orders a week?",
    statement: "About 30 orders a week.",
    ...patch,
  });

  it("keeps the owner's answers when Cuso saves the questions again", () => {
    const kept = keepAnswers(
      [question("q1"), question("q2")],
      [question("q1", { answer: "no", note: "About 80" })],
    );
    expect(kept[0]).toMatchObject({ answer: "no", note: "About 80" });
    expect(kept[1]).not.toHaveProperty("answer");
  });

  it("drops a check that repeats a Brand Brain question when Cuso saves the strategy", async () => {
    cusoFind.mockResolvedValue(HIRE);
    brainFindUnique.mockResolvedValue({
      body: {
        summary: "Acme sells rockets.",
        voice: { tone: "Direct", do: [], dont: [], examples: [] },
        audience: ["Founders"],
        products: ["Rockets"],
        competitors: [],
        channels: [],
        profile: {},
        questions: [
          {
            id: "primary-buyer",
            question: "Are independent writers the main buyer for Acme?",
            statement: "Independent writers are the main buyer",
            section: "customers",
          },
        ],
      },
    });
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      {
        ...strategy,
        questions: [
          question("buyers", {
            question: "Are independent writers your main buyers?",
          }),
          question("orders"),
        ],
      },
      { turnId: "turn-1" },
    );
    const saved = strategyRows.at(-1)?.plan as {
      questions: { id: string }[];
    };
    expect(saved.questions.map((asked) => asked.id)).toEqual(["orders"]);
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

/**
 * A first plan that keeps the hard rules: 16 pieces whose approach and
 * pillar shares match the plan's, and a short summary. Week one has its
 * briefs; weeks two to four are titles.
 */
function wholePlan() {
  const calendar = Array.from({ length: 16 }, (_, index) => ({
    id: `e${index + 1}`,
    date: `2026-11-${String(10 + index).padStart(2, "0")}`,
    time: "09:00",
    channel: "linkedin",
    format: "text",
    title: `Piece ${index + 1}`,
    status: "idea" as const,
    approach:
      index % 2 === 0 ? ("educational" as const) : ("product-led" as const),
    pillar: index % 2 === 0 ? "Setup" : "Proof",
    ...(index < 4
      ? { brief: `What piece ${index + 1} shows.`, why: "Week one." }
      : {}),
  }));
  return {
    month: "2026-11",
    summary: "Weeks one and two teach setup; weeks three and four show proof.",
    goals: ["More demo requests"],
    pillars: [
      { name: "Setup", share: 50 },
      { name: "Proof", share: 50 },
    ],
    channels: [{ channel: "linkedin", cadence: "4 posts a week" }],
    mix: [
      {
        approach: "educational" as const,
        share: 50,
        why: "Buyers learn first.",
      },
      { approach: "product-led" as const, share: 50, why: "Then they see it." },
    ],
    pace: { level: "steady" as const, why: "A calm start.", perWeek: 4 },
    ads: {
      monthly: 0,
      currency: "EUR",
      expect: "No ads yet.",
      without: "Posts carry the month.",
    },
    calendar,
  };
}

type WholePlan = ReturnType<typeof wholePlan> & {
  patched: unknown[];
  changes: string[];
};
const planOf = (row: { plan: unknown }) => row.plan as WholePlan;

describe("a plan in two parts", () => {
  beforeEach(() => cusoFind.mockResolvedValue(HIRE));

  it("shows the plan part before the calendar part exists", async () => {
    const { calendar, ...planPart } = wholePlan();

    await saveCmoStrategy({ sokoBotId: "bot-1" }, planPart, {
      turnId: "turn-1",
      rules: true,
    });

    expect(strategyRows).toHaveLength(1);
    const shown = planOf(strategyRows[0]!);
    expect(shown.summary).toBe(planPart.summary);
    expect(shown.pace).toMatchObject({ level: "steady" });
    expect(shown.calendar).toEqual([]);

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar },
      { turnId: "turn-1", rules: true },
    );
    expect(strategyRows).toHaveLength(1);
    expect(plan(strategyRows[0]!).calendar).toHaveLength(16);
  });

  it.each([
    [
      "20-word summary",
      {
        summary:
          "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.",
      },
    ],
    ["16 pieces", { calendar: wholePlan().calendar.slice(0, 15) }],
    [
      "shares within 7 points",
      {
        calendar: wholePlan().calendar.map((entry) => ({
          ...entry,
          approach: "educational" as const,
        })),
      },
    ],
  ])(
    "refuses a plan that breaks the %s rule and saves nothing",
    async (rule, broken) => {
      await expect(
        saveCmoStrategy(
          { sokoBotId: "bot-1" },
          { ...wholePlan(), ...broken },
          { turnId: "turn-1", rules: true },
        ),
      ).rejects.toThrow(`"${rule}"`);
      expect(strategyRows).toHaveLength(0);
    },
  );
});

describe("a change in two parts", () => {
  beforeEach(() => cusoFind.mockResolvedValue(HIRE));

  it("checks the shares once the calendar arrives, not on the plan part before it", async () => {
    await saveCmoStrategy({ sokoBotId: "bot-1" }, wholePlan(), {
      turnId: "turn-1",
      rules: true,
    });
    const { calendar, ...planPart } = wholePlan();
    const mix = [
      { approach: "educational" as const, share: 75, why: "More teaching." },
      { approach: "product-led" as const, share: 25, why: "Less product." },
    ];

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { ...planPart, mix },
      { turnId: "turn-2", rules: true },
    );
    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar },
        {
          turnId: "turn-2",
          rules: true,
        },
      ),
    ).rejects.toThrow('"shares within 7 points"');
  });
});

describe("a patch", () => {
  beforeEach(() => cusoFind.mockResolvedValue(HIRE));

  async function written() {
    await saveCmoStrategy({ sokoBotId: "bot-1" }, wholePlan(), {
      turnId: "turn-1",
      rules: true,
    });
    return strategyRows[0]!;
  }

  it("changes only the entries it names; the rest of the plan stays byte for byte", async () => {
    const first = await written();
    const before = planOf(first);
    const changed = { ...before.calendar[6]!, title: "A calmer piece seven" };

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [changed], changes: ["Piece seven is calmer."] },
      { turnId: "turn-2", part: "patch", rules: true },
    );

    expect(strategyRows).toHaveLength(2);
    const after = planOf(strategyRows.find((row) => row.id !== first.id)!);
    expect(after.calendar[6]!.title).toBe("A calmer piece seven");
    const untouched = (calendar: { id: string }[]) =>
      JSON.stringify(calendar.filter((entry) => entry.id !== "e7"));
    expect(untouched(after.calendar)).toBe(untouched(before.calendar));
    const { calendar: _a, changes: _c, patched: _p, ...afterPlan } = after;
    const { calendar: _b, changes: _d, patched: _q, ...beforePlan } = before;
    expect(JSON.stringify(afterPlan)).toBe(JSON.stringify(beforePlan));
    // The entry as it was, so the screen can strike it through.
    expect(after.patched).toEqual([{ id: "e7", was: before.calendar[6] }]);
    expect(after.changes).toEqual(["Piece seven is calmer."]);
  });

  it("keeps how an entry was across a turn's saves, even when sent again", async () => {
    const first = await written();
    const before = planOf(first);
    const changed = { ...before.calendar[6]!, title: "A calmer piece seven" };
    const patch = (calendar: typeof before.calendar) =>
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar },
        { turnId: "turn-2", part: "patch", rules: true },
      );

    await patch([changed]);
    await patch([changed, { ...before.calendar[7]!, title: "Eight, sharper" }]);

    const after = planOf(strategyRows.at(-1)!);
    expect(after.patched).toEqual([
      { id: "e7", was: before.calendar[6] },
      { id: "e8", was: before.calendar[7] },
    ]);
  });

  it("starts an ad budget's version with nothing struck through", async () => {
    seedStrategy({
      ...wholePlan(),
      patched: [{ id: "e7", was: wholePlan().calendar[6] }],
      changes: ["Piece seven is calmer."],
    });
    cusoFind.mockResolvedValue({
      ...HIRE,
      businessName: "Acme",
      brandBrain: {
        summary: "Acme sells rockets.",
        voice: { tone: "Direct", do: [], dont: [], examples: [] },
        audience: [],
        products: [],
        competitors: [],
        channels: [],
      },
    });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await setCmoAdBudget({
      projectId: "project-1",
      userId: "user-1",
      monthly: 300,
      currency: "eur",
    });

    expect(planOf(strategyRows.at(-1)!)).toMatchObject({
      patched: [],
      changes: [],
    });
  });

  it("drops every ad piece when the owner says no ads", async () => {
    const plan = wholePlan();
    seedStrategy({
      ...plan,
      ads: { ...plan.ads, monthly: 500 },
      calendar: plan.calendar.map((entry, index) =>
        index === 15 ? { ...entry, channel: "meta_ads" } : entry,
      ),
    });
    cusoFind.mockResolvedValue({
      ...HIRE,
      businessName: "Acme",
      brandBrain: {
        summary: "Acme sells rockets.",
        voice: { tone: "Direct", do: [], dont: [], examples: [] },
        audience: [],
        products: [],
        competitors: [],
        channels: [],
      },
    });
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await setCmoAdBudget({
      projectId: "project-1",
      userId: "user-1",
      monthly: 0,
      currency: "eur",
    });

    const saved = planOf(strategyRows.at(-1)!);
    expect(saved.calendar.find((entry) => entry.id === "e16")).toMatchObject({
      channel: "meta_ads",
      status: "skipped",
    });
    expect(
      saved.calendar.filter((entry) => (entry.status as string) === "skipped"),
    ).toHaveLength(1);
  });

  it("keeps a $0 plan free of ads when Cuso's patch leaves one in", async () => {
    const first = await written();
    const before = planOf(first);

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      {
        calendar: [{ ...before.calendar[15]!, channel: "google_ads" }],
      },
      { turnId: "turn-2", part: "patch", rules: true },
    );

    expect(
      planOf(strategyRows.at(-1)!).calendar.find((entry) => entry.id === "e16"),
    ).toMatchObject({ channel: "google_ads", status: "skipped" });
  });

  it("refuses a talking video that has no script or speaks as a customer", async () => {
    const first = await written();
    const before = planOf(first);
    const talking = {
      ...before.calendar[2]!,
      channel: "instagram",
      format: "talking_video",
    };

    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar: [talking] },
        { turnId: "turn-2", part: "patch", rules: true },
      ),
    ).rejects.toThrow("has no script");
    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        {
          calendar: [
            {
              ...talking,
              script:
                "I switched to this tool last month and it changed how my whole team books calls.",
            },
          ],
        },
        { turnId: "turn-2", part: "patch", rules: true },
      ),
    ).rejects.toThrow("speaks as a customer");
    expect(strategyRows).toHaveLength(1);

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      {
        calendar: [
          {
            ...talking,
            script:
              "Still emailing back and forth to find a time? Send one booking link and let people pick a slot. Make yours today.",
            presenter: "maya",
            voice: "Sarah",
          },
        ],
      },
      { turnId: "turn-2", part: "patch", rules: true },
    );
    expect(
      planOf(strategyRows.at(-1)!).calendar.find(
        (entry) => entry.id === talking.id,
      ),
    ).toMatchObject({ format: "talking_video", presenter: "maya" });
  });

  it("keeps the plan whole: a patch that breaks a rule saves nothing", async () => {
    const first = await written();
    const before = planOf(first);

    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        {
          calendar: before.calendar
            .slice(0, 3)
            .map((entry) => ({ ...entry, status: "skipped" as const })),
        },
        { turnId: "turn-2", part: "patch", rules: true },
      ),
    ).rejects.toThrow('"16 pieces"');
    expect(strategyRows).toHaveLength(1);
  });

  it("lets a patch through on a plan written before the hard rules, but never breaks a new one", async () => {
    // An older plan whose pillar shares are 25 points off the calendar.
    seedStrategy({
      ...wholePlan(),
      pillars: [
        { name: "Setup", share: 75 },
        { name: "Proof", share: 25 },
      ],
    });
    const before = planOf(strategyRows[0]!);

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [{ ...before.calendar[6]!, title: "A calmer piece seven" }] },
      { turnId: "turn-2", part: "patch", rules: true },
    );
    expect(planOf(strategyRows.at(-1)!).calendar[6]?.title).toBe(
      "A calmer piece seven",
    );

    // A rule it kept still refuses the patch.
    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        {
          calendar: before.calendar
            .slice(0, 3)
            .map((entry) => ({ ...entry, status: "skipped" as const })),
        },
        { turnId: "turn-3", part: "patch", rules: true },
      ),
    ).rejects.toThrow('"16 pieces"');
  });

  it("lets the pieces a change skips move the shares, but never a piece it rewrites", async () => {
    // 24 pieces, half educational and Setup, half product-led and Proof.
    const whole = wholePlan();
    seedStrategy({
      ...whole,
      calendar: Array.from({ length: 24 }, (_, index) => ({
        ...whole.calendar[index % 2]!,
        id: `e${index + 1}`,
        date: `2026-11-${String(5 + index).padStart(2, "0")}`,
        title: `Piece ${index + 1}`,
      })),
    });
    const before = planOf(strategyRows[0]!);
    const educational = before.calendar.filter(
      (entry) => entry.approach === "educational",
    );
    // "Fewer setup posts": four skipped leave 8 of 20 educational (40%).
    // What else a skip sends on its piece (a new pillar) counts for nothing.
    const skipped = educational.slice(0, 4).map((entry) => ({
      ...entry,
      status: "skipped" as const,
      pillar: "Proof",
    }));

    // Moving the shares by rewriting pieces is still refused.
    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        {
          calendar: [
            ...skipped,
            ...educational.slice(4, 6).map((entry) => ({
              ...entry,
              approach: "product-led" as const,
            })),
          ],
        },
        { turnId: "turn-2", part: "patch", rules: true },
      ),
    ).rejects.toThrow('"shares within 7 points"');

    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: skipped },
      { turnId: "turn-2", part: "patch", rules: true },
    );
    const ids = new Set(skipped.map((entry) => entry.id));
    expect(
      planOf(strategyRows.at(-1)!).calendar.filter((entry) =>
        ids.has(entry.id),
      ),
    ).toMatchObject(skipped.map(() => ({ status: "skipped" })));
  });

  it("refuses changes sent only in patched, which is Core's: nothing is saved", async () => {
    const first = await written();
    const before = planOf(first);
    const changed = { ...before.calendar[6]!, title: "A calmer piece seven" };

    await expect(
      saveCmoStrategy(
        { sokoBotId: "bot-1" },
        { calendar: [], patched: [{ id: "e7", was: changed }] },
        { turnId: "turn-2", part: "patch", rules: true },
      ),
    ).rejects.toThrow(/Send each entry you change in calendar/);
    expect(strategyRows).toHaveLength(1);
  });

  it("is cleared by the next whole save", async () => {
    await written();
    const before = planOf(strategyRows[0]!);
    await saveCmoStrategy(
      { sokoBotId: "bot-1" },
      { calendar: [{ ...before.calendar[0]!, title: "New" }] },
      { turnId: "turn-2", part: "patch", rules: true },
    );
    await saveCmoStrategy({ sokoBotId: "bot-1" }, wholePlan(), {
      turnId: "turn-3",
      rules: true,
    });

    const newest = strategyRows.at(-1)!;
    expect(plan(newest)).toMatchObject({ patched: [] });
  });
});

describe("changes after the plan", () => {
  const essentials = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
    profile: {
      company: { answer: "Acme builds rockets in Ohio.", findings: [] },
      pricing: { answer: "From 9 dollars a month.", findings: [] },
    },
  };
  const cuso = {
    ...HIRE,
    userId: "user-1",
    businessName: "Acme",
    goals: "More sales",
    brandBrain: essentials,
  };
  const now = new Date("2026-11-10T10:00:00Z");
  const turn = (kind: string, minutesAgo: number, status = "RUNNING") => ({
    id: `${kind}-turn`,
    status,
    eveSessionId: "sess-1",
    clientTurnId: `cmo:strategy:bot-1:${kind === "plan" ? "" : `${kind}:`}1`,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });
  const message = () => JSON.stringify(startTurn.mock.lastCall);
  const resetTurns = () => {
    turnFindFirst.mockReset();
    startTurn.mockReset();
  };
  afterEach(() => {
    resetTurns();
    pgClock.now = null;
  });
  beforeEach(() => {
    resetTurns();
    pgClock.now = now;
    cusoFind.mockResolvedValue(cuso);
    eventFindFirst.mockResolvedValue({ createdAt: now });
    startTurn.mockResolvedValue({ turnId: "turn-9" });
  });

  it("patches the plan for a pace, never re-plans it", async () => {
    seedStrategy(wholePlan());

    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      note: "Switch to the active pace.",
      patch: true,
    });

    expect(startTurn.mock.lastCall?.[0]).toMatchObject({
      clientTurnId: expect.stringMatching(/^cmo:strategy:bot-1:patch:/),
    });
    expect(message()).toContain("Switch to the active pace.");
    expect(message()).toContain("part patch");
    expect(message()).not.toContain("Write Acme's marketing strategy");
  });

  // cmo-v8: a no to ballcaps once changed the goal and left caps in the
  // funnel's plays and a question.
  it("tells a cmo-v8 Cuso a correction is true everywhere", async () => {
    seedStrategy(wholePlan());
    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v8" });
    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      note: "No, we don't sell ballcaps anymore.",
      patch: true,
    });
    expect(message()).toContain("What the owner says is true everywhere.");
    expect(message()).not.toContain(
      "Change only the calendar entries and strategy fields this touches",
    );

    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v7" });
    await requestCmoStrategy({
      projectId: "project-1",
      userId: "user-1",
      note: "No, we don't sell ballcaps anymore.",
      patch: true,
    });
    expect(message()).toContain(
      "Change only the calendar entries and strategy fields this touches",
    );
    expect(message()).not.toContain("true everywhere");
  });

  it("patches the plan for the owner's nos and ad budget", async () => {
    seedStrategy({
      ...wholePlan(),
      questions: [
        {
          id: "q1",
          question: "Do buyers find you on LinkedIn?",
          statement: "Buyers find Acme on LinkedIn",
          answer: "no",
          note: "Through Google",
        },
      ],
    });

    await applyCmoPlanAnswers({ projectId: "project-1", userId: "user-1" });
    expect(message()).toContain("part patch");
    expect(message()).toContain("Through Google");

    await setCmoAdBudget({
      projectId: "project-1",
      userId: "user-1",
      monthly: 300,
      currency: "eur",
    });
    expect(startTurn.mock.lastCall?.[0]).toMatchObject({
      clientTurnId: expect.stringMatching(/:patch:/),
    });
    expect(message()).toContain("EUR 300");
  });

  it("refuses to approve a month short of the volume it promises", async () => {
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    // Three weeks, at steady: short of its weeks and the top volume.
    const short = seedStrategy(wholePlan());
    await expect(requireCmoStrategyFitted(HIRE, short.id)).rejects.toThrow(
      "Cuso is still filling this month",
    );
    // A Cuso who saves in two calls has no finish turn to fill it.
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v2" });
    await requireCmoStrategyFitted(HIRE, short.id);
  });

  it("refuses to approve a strategy that still shows an answer the owner said no to", async () => {
    sokoBotFindUnique.mockResolvedValue({ versionId: "cmo-v2" });
    const question = {
      id: "q1",
      question: "Can you spend about $300 on ads?",
      statement: "Acme spends $300 a month on ads",
    };
    const unfitted = seedStrategy({
      ...wholePlan(),
      questions: [{ ...question, answer: "no" }],
    });
    await expect(requireCmoStrategyFitted(HIRE, unfitted.id)).rejects.toThrow(
      "Update the strategy first",
    );

    // Cuso fitted it (his changes are listed), or nothing was a no.
    const fitted = seedStrategy({
      ...wholePlan(),
      questions: [{ ...question, answer: "no" }],
      changes: ["Removed Google Ads"],
    });
    const confirmed = seedStrategy({
      ...wholePlan(),
      questions: [{ ...question, answer: "yes" }],
    });
    await requireCmoStrategyFitted(HIRE, fitted.id);
    await requireCmoStrategyFitted(HIRE, confirmed.id);
  });

  it("refuses a patch while the plan is still being written", async () => {
    turnFindFirst.mockResolvedValue(turn("plan", 2));
    await expect(
      requestCmoStrategy({
        projectId: "project-1",
        userId: "user-1",
        note: "Switch to the active pace.",
        patch: true,
      }),
    ).rejects.toThrow("still writing the strategy");
    expect(startTurn).not.toHaveBeenCalled();
  });

  describe("a no on a Brand Brain question", () => {
    const asked = {
      ...essentials,
      questions: [
        {
          id: "q1",
          section: "pricing" as const,
          question: "Do you start at 9 dollars a month?",
          statement: "Acme starts at 9 dollars a month.",
        },
      ],
    };
    const answer = (value: "yes" | "no", note?: string) =>
      answerCmoBrandQuestion({
        projectId: "project-1",
        userId: "user-1",
        questionId: "q1",
        answer: value,
        ...(note ? { note } : {}),
      });
    beforeEach(() => {
      // The stored brain follows each write.
      brainFindUnique.mockImplementation(async () => ({
        body: brainUpdate.mock.lastCall?.[0].data.body ?? asked,
      }));
    });

    it("waits on its section while the plan is written, then fixes it and patches the plan", async () => {
      // The plan started when the research ended, before the owner answered.
      turnFindFirst.mockResolvedValue(turn("plan", 2));

      await answer("no", "From 19 dollars a month.");

      const stored = brainUpdate.mock.lastCall?.[0].data.body;
      expect(stored.profile.pricing.fix).toMatchObject({
        note: expect.stringContaining("From 19 dollars a month."),
        fixed: false,
      });
      expect(startTurn).not.toHaveBeenCalled();

      // The plan lands: the fix starts as a short turn that patches it.
      seedStrategy(wholePlan());
      cusoFind.mockResolvedValue({ ...cuso, brandBrain: stored });
      turnFindFirst.mockResolvedValue(turn("plan", 1, "COMPLETED"));
      await expect(
        startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }),
      ).resolves.toEqual({ turnId: "turn-9" });
      expect(startTurn.mock.lastCall?.[0]).toMatchObject({
        clientTurnId: expect.stringMatching(/^cmo:strategy:bot-1:fix:/),
      });
      expect(message()).toContain(
        'you asked \\"Do you start at 9 dollars a month?\\" and the owner said no',
      );
      expect(message()).toContain("part patch");
    });

    it("starts the fix at once when Cuso is free", async () => {
      seedStrategy(wholePlan());
      turnFindFirst.mockResolvedValue(turn("plan", 30, "COMPLETED"));

      await answer("no");

      expect(startTurn.mock.lastCall?.[0]).toMatchObject({
        clientTurnId: expect.stringMatching(/^cmo:strategy:bot-1:fix:/),
      });
    });

    it("takes the fix back when the owner changes a no, and never adds it twice", async () => {
      turnFindFirst.mockResolvedValue(turn("plan", 2));
      await answer("no");
      await answer("no", "From 19 dollars a month.");
      const again = brainUpdate.mock.lastCall?.[0].data.body;
      expect(again.profile.pricing.fix.note).toBe(
        "Not true: Acme starts at 9 dollars a month. True instead: From 19 dollars a month.",
      );

      await answer("yes");

      const stored = brainUpdate.mock.lastCall?.[0].data.body;
      expect(stored.profile.pricing.fix).toMatchObject({ fixed: true });
      // The plan ends: nothing is left to fix.
      seedStrategy(wholePlan());
      cusoFind.mockResolvedValue({ ...cuso, brandBrain: stored });
      turnFindFirst.mockResolvedValue(turn("plan", 1, "COMPLETED"));
      await expect(
        startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }),
      ).resolves.toBeNull();
    });

    it("queues a no whose note is as long as a note may be, in the one write that saves the answer", async () => {
      turnFindFirst.mockResolvedValue(turn("plan", 2));
      const note = "From 19 dollars a month.".padEnd(400, ".");
      const transaction = vi.spyOn(prisma, "$transaction");
      onTestFinished(() => transaction.mockRestore());

      await answer("no", note);

      // The answer and its fix land together, or neither does.
      expect(transaction).toHaveBeenCalledTimes(1);
      const stored = brainUpdate.mock.lastCall?.[0].data.body;
      expect(stored.questions[0]).toMatchObject({ answer: "no", note });
      expect(stored.profile.pricing.fix).toMatchObject({
        note: `Not true: Acme starts at 9 dollars a month. True instead: ${note}`,
        fixed: false,
      });
    });

    it("leaves a yes in its section and starts nothing", async () => {
      seedStrategy(wholePlan());
      turnFindFirst.mockResolvedValue(turn("plan", 30, "COMPLETED"));

      await answer("yes");

      const stored = brainUpdate.mock.lastCall?.[0].data.body;
      expect(stored.profile.pricing.fix).toBeUndefined();
      expect(startTurn).not.toHaveBeenCalled();
    });
  });

  it("fixes one brand section in a short turn, then patches the plan it touches", async () => {
    brainFindUnique.mockResolvedValue({ body: essentials });
    seedStrategy(wholePlan());

    await fixCmoBrandSection({
      projectId: "project-1",
      userId: "user-1",
      section: "pricing",
      note: "From 19 dollars a month.",
    });

    // Only that section holds the fix; the others stay as they were.
    const body = brainUpdate.mock.lastCall?.[0].data.body;
    expect(body.profile.pricing.fix).toMatchObject({
      note: "From 19 dollars a month.",
      fixed: false,
    });
    expect(body.profile.company).toEqual({
      ...essentials.profile.company,
      openQuestions: [],
    });
    expect(startTurn.mock.lastCall?.[0]).toMatchObject({
      clientTurnId: expect.stringMatching(/^cmo:strategy:bot-1:fix:/),
    });
    expect(message()).toContain("- pricing: you wrote");
    expect(message()).toContain("From 19 dollars a month.");
    expect(message()).not.toContain("- company:");
    expect(message()).toContain("sections holding only these sections");
    expect(message()).toContain("part patch");
    expect(message()).not.toContain("send brandBrain with the essentials");
  });

  it("has a cmo-v8 Cuso fix the essentials that say what the fixed section says", async () => {
    brainFindUnique.mockResolvedValue({ body: essentials });
    seedStrategy(wholePlan());
    sokoBotFindUnique.mockResolvedValueOnce({ versionId: "cmo-v8" });

    await fixCmoBrandSection({
      projectId: "project-1",
      userId: "user-1",
      section: "company",
      note: "We build rockets in Texas, not Ohio.",
    });

    expect(message()).toContain(
      "In the same call, send brandBrain with the essentials that say the same thing rewritten to match",
    );
    expect(message()).toContain("What the owner says is true everywhere.");
  });

  it("names each question the owner said no to in a fix turn, never as 'True instead: Not true'", async () => {
    // The state the Brief me review hit: two nos on one section, each also
    // sent as that section's fix, and Cuso saved the opposite of both.
    const asked = new Date(now.getTime() - 60_000).toISOString();
    const no = {
      section: "marketing" as const,
      answer: "no" as const,
      corrected: false,
    };
    cusoFind.mockResolvedValue({
      ...cuso,
      brandBrain: {
        ...essentials,
        profile: {
          ...essentials.profile,
          marketing: {
            answer: "Word of mouth and Instagram.",
            findings: [],
            fix: {
              note: "Not true: Acme sends a customer newsletter. Not true: Acme is running paid ads.",
              at: asked,
              fixed: false,
            },
          },
        },
        questions: [
          {
            ...no,
            id: "q1",
            question: "Do you currently send a customer newsletter?",
            statement: "Acme sends a customer newsletter.",
          },
          {
            ...no,
            id: "q2",
            question: "Are you currently running paid ads?",
            statement: "Acme is running paid ads.",
          },
        ],
      },
    });
    turnFindFirst.mockResolvedValue(turn("plan", 1, "COMPLETED"));

    await startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" });

    expect(message()).not.toContain("True instead: Not true");
    expect(message()).toContain(
      'you asked \\"Do you currently send a customer newsletter?\\" and the owner said no, so this is false: \\"Acme sends a customer newsletter.\\"',
    );
    expect(message()).toContain(
      'you asked \\"Are you currently running paid ads?\\" and the owner said no',
    );
  });

  it("queues a fix while the plan is written and starts it when the plan ends", async () => {
    brainFindUnique.mockResolvedValue({ body: essentials });
    turnFindFirst.mockResolvedValue(turn("plan", 2));

    await expect(
      fixCmoBrandSection({
        projectId: "project-1",
        userId: "user-1",
        section: "pricing",
        note: "From 19 dollars a month.",
      }),
    ).resolves.toEqual({ queued: true });
    expect(startTurn).not.toHaveBeenCalled();

    const pending = brainUpdate.mock.lastCall?.[0].data.body;
    cusoFind.mockResolvedValue({ ...cuso, brandBrain: pending });
    turnFindFirst.mockResolvedValue(turn("plan", 1, "COMPLETED"));
    await expect(
      startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toEqual({ turnId: "turn-9" });
    expect(message()).toContain("- pricing: you wrote");
  });

  it("never loops on a fix its own turn could not make", async () => {
    const asked = new Date(now.getTime() - 5 * 60_000).toISOString();
    const pending = {
      ...essentials,
      profile: {
        ...essentials.profile,
        pricing: {
          ...essentials.profile.pricing,
          fix: { note: "From 19 dollars.", at: asked, fixed: false },
        },
      },
    };
    cusoFind.mockResolvedValue({ ...cuso, brandBrain: pending });
    // The fix turn was sent this fix, and ended.
    turnFindFirst.mockResolvedValue({
      ...turn("fix", 3, "COMPLETED"),
      clientTurnId: `cmo:strategy:bot-1:fix:1:${Date.parse(asked)}`,
    });

    await expect(
      startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toBeNull();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("runs a fix asked while the last fix turn was starting, which it never saw", async () => {
    const seen = new Date(now.getTime() - 5 * 60_000).toISOString();
    const later = new Date(now.getTime() - 4 * 60_000).toISOString();
    const pending = {
      ...essentials,
      profile: {
        company: {
          ...essentials.profile.company,
          fix: { note: "Ohio and Texas.", at: later, fixed: false },
        },
        pricing: {
          ...essentials.profile.pricing,
          fix: { note: "From 19 dollars.", at: seen, fixed: false },
        },
      },
    };
    cusoFind.mockResolvedValue({ ...cuso, brandBrain: pending });
    // Created after both fixes, but sent only the first.
    turnFindFirst.mockResolvedValue({
      ...turn("fix", 1, "COMPLETED"),
      clientTurnId: `cmo:strategy:bot-1:fix:1:${Date.parse(seen)}`,
    });

    await expect(
      startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }),
    ).resolves.toEqual({ turnId: "turn-9" });
    expect(startTurn.mock.lastCall?.[0].clientTurnId).toMatch(
      new RegExp(`:fix:\\d+:${Date.parse(later)}$`),
    );
  });
});

describe("withoutUnaskedAds", () => {
  const plan = {
    channels: [
      { channel: "linkedin", cadence: "3 a week" },
      { channel: "Google_Ads", cadence: "2 ads this month" },
    ],
    calendar: [
      {
        id: "p1",
        date: "2026-11-20",
        channel: "linkedin",
        format: "post",
        title: "A post",
        status: "idea",
      },
      {
        id: "ad1",
        date: "2026-11-21",
        channel: "google_ads",
        format: "search_ad",
        title: "An ad",
        status: "idea",
      },
    ],
    funnel: [
      {
        stage: "awareness",
        goal: "g",
        metric: "Visits",
        channels: ["linkedin", "google_ads"],
        plays: [
          { channel: "linkedin", what: "Posts" },
          { channel: "google_ads", what: "Search ads" },
        ],
      },
    ],
    ads: {
      monthly: 600,
      currency: "USD",
      expect: "Clicks",
      without: "Posts",
      setByOwner: false,
    },
  } as unknown as MarketingStrategyPlan;

  it("takes ads Cuso planned himself out, and keeps his amount as a suggestion", () => {
    const kept = withoutUnaskedAds(plan);
    expect(kept.channels.map((channel) => channel.channel)).toEqual([
      "linkedin",
    ]);
    expect(kept.calendar.find((entry) => entry.id === "ad1")?.status).toBe(
      "skipped",
    );
    expect(kept.funnel[0]?.plays.map((play) => play.channel)).toEqual([
      "linkedin",
    ]);
    expect(kept.funnel[0]?.channels).toEqual(["linkedin"]);
    expect(kept.ads).toMatchObject({
      monthly: 0,
      suggest: { channel: "google_ads", monthly: 600 },
    });
  });

  it("keeps the ads once the owner said yes and set an amount", () => {
    const yes = {
      ...plan,
      ads: { ...plan.ads, setByOwner: true },
    } as MarketingStrategyPlan;
    expect(withoutUnaskedAds(yes)).toBe(yes);
  });
});

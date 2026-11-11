import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepAnswers } from "@/helpers/question-answers";
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
  resetCmoServiceMocks,
  revised,
  seedStrategy,
  startTurn,
  strategy,
  strategyRows,
  turnFindFirst,
} from "@/test-fixtures/cmo-service";

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
  applyCmoPlanAnswers,
  cmoPlanAnswerNote,
  fixCmoBrandSection,
  keepCalendarWork,
  pauseCmoCalendarEntry,
  requestCmoStrategy,
  saveCmoStrategy,
  setCmoAdBudget,
  startCmoPlanAfterResearch,
  startNextCmoChange,
  withoutDashes,
} from "./cmo-strategy.service";

beforeEach(resetCmoServiceMocks);

const HIRE = {
  sokoBotId: "bot-1",
  workspaceId: "ws-1",
  projectId: "project-1",
};
const plan = (row: { plan: unknown }) => row.plan as typeof strategy;
const approvedRows = () => strategyRows.filter((row) => row.approvedAt);

vi.mock("@/lib/site-platform", () => ({
  detectSiteLanguage: async () => "German",
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
        '- marketing: you wrote \\"Most customers find the business through Google\\". True instead: LinkedIn',
      );
      expect(message).toContain("- company: you wrote");
      expect(message).toContain("say the opposite plainly");
      expect(message.match(/- \w+: you wrote/g)).toHaveLength(2);
    }
  });

  it("posts in the language the website is written in", async () => {
    cusoFind.mockResolvedValue(cuso);
    startTurn.mockResolvedValue({ turnId: "turn-9" });

    await requestCmoStrategy({ projectId: "project-1", userId: "user-1" });

    expect(JSON.stringify(startTurn.mock.lastCall)).toContain(
      "The website is written in German: set contentLanguage to German",
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
    vi.useRealTimers();
  });

  beforeEach(() => {
    resetTurns();
    cusoFind.mockResolvedValue(cuso);
    // The plan turn keeps making progress.
    eventFindFirst.mockResolvedValue({ occurredAt: now });
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
      for (const ask of [{}, { restart: true }, { note: "Fewer posts" }]) {
        await expect(
          requestCmoStrategy(
            { projectId: "project-1", userId: "user-1", ...ask },
            now,
          ),
        ).rejects.toThrow("finishing a change");
      }
    }
    expect(expireTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("lets Looks like us confirm without starting a second plan", async () => {
    turnFindFirst.mockResolvedValue(planTurn(2));

    await expect(
      requestCmoStrategy({ projectId: "project-1", userId: "user-1" }, now),
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
      requestCmoStrategy({ projectId: "project-1", userId: "user-1" }, now),
    ]);

    expect(fromResearch).toEqual({ turnId: "plan-1" });
    expect(fromApprove).toEqual({ turnId: "plan-1" });
    expect(started).toBe(true);
  });

  it("refuses a change while the plan is still being written", async () => {
    turnFindFirst.mockResolvedValue(planTurn(2));
    await expect(
      requestCmoStrategy(
        { projectId: "project-1", userId: "user-1", note: "Fewer posts" },
        now,
      ),
    ).rejects.toThrow("still writing the plan");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("refuses an ad budget while the plan is still being written", async () => {
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
    ).rejects.toThrow("still writing the plan");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("restarts a plan running past twice the usual time", async () => {
    turnFindFirst.mockResolvedValue(planTurn(13));
    startTurn.mockResolvedValue({ turnId: "plan-2" });

    await expect(
      requestCmoStrategy(
        { projectId: "project-1", userId: "user-1", restart: true },
        now,
      ),
    ).resolves.toEqual({ turnId: "plan-2" });

    expect(expireTurn).toHaveBeenCalledWith("plan-1");
  });

  it("keeps a plan running under twice the usual time", async () => {
    turnFindFirst.mockResolvedValue(planTurn(10));

    await expect(
      requestCmoStrategy(
        { projectId: "project-1", userId: "user-1", restart: true },
        now,
      ),
    ).resolves.toEqual({ turnId: "plan-1" });

    expect(expireTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("never gives the plan the quick look", async () => {
    cusoFind.mockResolvedValue({
      ...cuso,
      brandBrain: {
        ...essentials,
        preview: { line: "QUICK LOOK LINE", facts: ["QUICK FACT"] },
      },
    });
    startTurn.mockResolvedValue({ turnId: "plan-1" });

    await startCmoPlanAfterResearch({ sokoBotId: "bot-1", userId: "user-1" });

    const message = JSON.stringify(startTurn.mock.lastCall);
    expect(message).not.toContain("QUICK LOOK LINE");
    expect(message).not.toContain("QUICK FACT");
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
    // Pieces write Social posts only: no version's plan changes, and other
    // channels are not produced.
    expect(strategyRows).toHaveLength(2);
    expect(plan(running)).toEqual(strategy);
    expect(plan(draft)).toEqual(revised);
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
    ).rejects.toThrow(/approved/i);

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
  afterEach(resetTurns);
  beforeEach(() => {
    resetTurns();
    cusoFind.mockResolvedValue(cuso);
    eventFindFirst.mockResolvedValue({ occurredAt: now });
    startTurn.mockResolvedValue({ turnId: "turn-9" });
  });

  it("patches the plan for a pace, never re-plans it", async () => {
    seedStrategy(wholePlan());

    await requestCmoStrategy(
      {
        projectId: "project-1",
        userId: "user-1",
        note: "Switch to the active pace.",
        patch: true,
      },
      now,
    );

    expect(startTurn.mock.lastCall?.[0]).toMatchObject({
      clientTurnId: expect.stringMatching(/^cmo:strategy:bot-1:patch:/),
    });
    expect(message()).toContain("Switch to the active pace.");
    expect(message()).toContain("part patch");
    expect(message()).not.toContain("Write Acme's marketing strategy");
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

  it("refuses a patch while the plan is still being written", async () => {
    turnFindFirst.mockResolvedValue(turn("plan", 2));
    await expect(
      requestCmoStrategy(
        {
          projectId: "project-1",
          userId: "user-1",
          note: "Switch to the active pace.",
          patch: true,
        },
        now,
      ),
    ).rejects.toThrow("still writing the plan");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("fixes one brand section in a short turn, then patches the plan it touches", async () => {
    brainFindUnique.mockResolvedValue({ body: essentials });
    seedStrategy(wholePlan());

    await fixCmoBrandSection(
      {
        projectId: "project-1",
        userId: "user-1",
        section: "pricing",
        note: "From 19 dollars a month.",
      },
      now,
    );

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
  });

  it("queues a fix while the plan is written and starts it when the plan ends", async () => {
    brainFindUnique.mockResolvedValue({ body: essentials });
    turnFindFirst.mockResolvedValue(turn("plan", 2));

    await expect(
      fixCmoBrandSection(
        {
          projectId: "project-1",
          userId: "user-1",
          section: "pricing",
          note: "From 19 dollars a month.",
        },
        now,
      ),
    ).resolves.toEqual({ queued: true });
    expect(startTurn).not.toHaveBeenCalled();

    const pending = brainUpdate.mock.lastCall?.[0].data.body;
    cusoFind.mockResolvedValue({ ...cuso, brandBrain: pending });
    turnFindFirst.mockResolvedValue(turn("plan", 1, "COMPLETED"));
    await expect(
      startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }, now),
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
      startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }, now),
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
      startNextCmoChange({ sokoBotId: "bot-1", userId: "user-1" }, now),
    ).resolves.toEqual({ turnId: "turn-9" });
    expect(startTurn.mock.lastCall?.[0].clientTurnId).toMatch(
      new RegExp(`:fix:\\d+:${Date.parse(later)}$`),
    );
  });
});

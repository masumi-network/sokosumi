import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const ok = () => vi.fn().mockResolvedValue({});
  return {
    project: { update: ok() },
    marketingStrategy: { deleteMany: ok(), create: ok() },
    sokoBotTurn: {
      findMany: vi.fn().mockResolvedValue([]),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ status: "COMPLETED", finalAnswer: "Ready" }),
    },
    brandBrain: { deleteMany: ok(), create: ok(), findUnique: vi.fn() },
    chatRoomMessage: { deleteMany: ok() },
    dataTable: { deleteMany: ok() },
    contactList: { deleteMany: ok() },
    sokoBotSchedule: { deleteMany: ok() },
    fileProjectLink: { deleteMany: ok() },
    projectSocialConnection: { updateMany: ok() },
    socialComment: {
      deleteMany: ok(),
      create: vi.fn().mockResolvedValue({ id: "comment-1" }),
    },
    socialPost: { create: vi.fn().mockResolvedValue({ id: "post-1" }) },
    sokoBotIntegration: { deleteMany: ok() },
    projectSeoResearch: { deleteMany: ok() },
  };
});
// PostgreSQL's clock is the test clock here.
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: prisma }));
vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: vi.fn().mockResolvedValue({ id: "cuso-1" }),
}));

const expireTurn = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { expireTurn },
}));

vi.mock("@/services/cmo-strategy.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cmo-strategy.service")>()),
  requestCmoStrategy: vi.fn().mockResolvedValue({ turnId: "turn-1" }),
}));
vi.mock("@/services/marketing-strategy.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/marketing-strategy.service")
  >()),
  newestMarketingStrategy: vi.fn(),
}));

import {
  cmoPlanProblems,
  cmoPlanRuleProblems,
} from "@/services/cmo-plan-review.service";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import { newestMarketingStrategy } from "@/services/marketing-strategy.service";
import { CMO_EVAL_CASES } from "./eval-cmo-cases";
import {
  changeRequestPlan,
  commentChecks,
  monthPlanFromTomorrow,
  monthProductionTurns,
  newsletterIssueCheck,
  pollCmoCase,
  prepareCmoChatCase,
  startCmoCase,
} from "./eval-cmo-runner";
import type { EvalLaneRecord } from "./eval-lanes.service";

describe("strategy eval cases", () => {
  const lane = {
    userId: "user-1",
    cusoBotId: "cuso-1",
    cusoProjectId: "project-1",
  } as EvalLaneRecord;
  const context = {
    resultId: "result-1",
    firstOfSuite: false,
    startedAt: new Date(),
  };
  const evalCase = CMO_EVAL_CASES.find(
    (item) => item.id === "cmo-strategy-mailchimp",
  )!;

  it("drops the last brand's page screenshots when a lane gets a new brand", async () => {
    await prepareCmoChatCase(lane as never, "cmo-brand");
    expect(prisma.fileProjectLink.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: lane.cusoProjectId,
        resource: { sourceId: { contains: "/Brand research/" } },
      },
    });
  });

  it("passes the frozen site language into fresh strategy generation", async () => {
    await startCmoCase(evalCase, lane, context);
    expect(requestCmoStrategy).toHaveBeenLastCalledWith({
      userId: "user-1",
      projectId: "project-1",
      siteLanguage: "English",
    });
  });

  it("waits for a turn that is still inside its deadline", async () => {
    prisma.sokoBotTurn.findMany.mockResolvedValueOnce([
      { id: "turn-0", deadlineAt: new Date(Date.now() + 60_000) },
    ]);
    expect(await startCmoCase(evalCase, lane, context)).toEqual({
      kind: "busy",
    });
    expect(expireTurn).not.toHaveBeenCalled();
  });

  it("ends a turn past its deadline instead of waiting on it", async () => {
    prisma.sokoBotTurn.findMany.mockResolvedValueOnce([
      { id: "turn-0", deadlineAt: new Date(Date.now() - 60_000) },
    ]);
    expect(await startCmoCase(evalCase, lane, context)).toMatchObject({
      kind: "started",
    });
    expect(expireTurn).toHaveBeenCalledWith("turn-0");
  });

  it("ends the turn of a case that timed out, so the lane is free", async () => {
    prisma.sokoBotTurn.findUniqueOrThrow.mockResolvedValueOnce({
      status: "RUNNING",
    });
    const result = await pollCmoCase(
      evalCase,
      lane,
      { turnId: "turn-9", state: {} },
      { ...context, startedAt: new Date(Date.now() - 46 * 60_000) },
    );
    expect(result).toMatchObject({
      kind: "done",
      outcome: { status: "ERROR" },
    });
    expect(expireTurn).toHaveBeenCalledWith("turn-9");
  });

  it.each([
    [
      "GatewayInternalServerError",
      "API key budget exceeded. Current spend: $400.12, limit: $400.00.",
      "provider_budget_exhausted",
    ],
    ["runner_exited", "The runner ended with exit code 1", "runner_exited"],
  ])(
    "records %s as an execution error before reading generated content",
    async (errorKind, errorDetail, code) => {
      prisma.sokoBotTurn.findUniqueOrThrow.mockResolvedValueOnce({
        status: "FAILED",
        errorKind,
        errorDetail,
        finalAnswer: null,
      });
      const result = await pollCmoCase(
        evalCase,
        lane,
        { turnId: "turn-failed", state: {} },
        context,
      );
      expect(result).toMatchObject({
        kind: "done",
        outcome: {
          status: "ERROR",
          checks: [],
          turnIds: ["turn-failed"],
          output: { infrastructure: { code, detail: errorDetail } },
        },
      });
    },
  );

  it.each([
    { kind: "cmo-research", output: { offers: null } },
    { kind: "cmo-strategy", output: { pillars: null, calendar: null } },
  ])("reports missing content for $kind", async ({ kind, output }) => {
    const scenario = CMO_EVAL_CASES.find((item) => item.kind === kind);
    if (!scenario) throw new Error(`Missing eval case: ${kind}`);
    if (kind === "cmo-research")
      prisma.brandBrain.findUnique.mockResolvedValueOnce(null);
    else vi.mocked(newestMarketingStrategy).mockResolvedValueOnce(null);
    const result = await pollCmoCase(
      scenario,
      lane,
      { turnId: "turn-1", state: {} },
      context,
    );
    expect(result).toMatchObject({
      kind: "done",
      outcome: { status: "FAILED", output },
    });
  });

  it.each(["Email and SMS marketing plans", null])(
    "exports the core offer separately from the trial: %s",
    async (coreOffer) => {
      vi.mocked(newestMarketingStrategy).mockResolvedValue({
        id: "strategy-1",
        projectId: lane.cusoProjectId,
        createdAt: context.startedAt,
        updatedAt: context.startedAt,
        authorSokoBotId: lane.cusoBotId,
        authorUserId: null,
        authorTurnId: "turn-1",
        approvedAt: null,
        approvedByUserId: null,
        monthReview: null,
        plan: {
          month: "2026-11",
          summary: "Explain email marketing plans.",
          goals: ["More trials"],
          pillars: [],
          channels: [],
          calendar: [],
          ...(coreOffer ? { ladder: { core: { what: coreOffer } } } : {}),
          offer: {
            what: "14-day Standard trial",
            why: "Try the plan",
            action: "Start trial",
          },
        },
      });
      const result = await pollCmoCase(
        evalCase,
        lane,
        { turnId: "turn-1", state: {} },
        context,
      );
      expect(result).toMatchObject({
        kind: "done",
        outcome: { output: { coreOffer, offer: "14-day Standard trial" } },
      });
    },
  );
});

describe("prepareCmoChatCase", () => {
  it("publishes the comment post with exactly one creator: the lane's Cuso", async () => {
    const lane = {
      lane: 1,
      userId: "user-1",
      workspaceId: "workspace-1",
      cusoBotId: "cuso-bot-1",
      cusoProjectId: "project-1",
    } as EvalLaneRecord;
    await prepareCmoChatCase(lane, "cmo-comments");
    const { data } = prisma.socialPost.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    const creators = [
      "creatorUserId",
      "creatorCoworkerId",
      "creatorSokoBotId",
    ].filter((key) => data[key] != null);
    expect(creators).toEqual(["creatorSokoBotId"]);
    expect(data.creatorSokoBotId).toBe("cuso-bot-1");
  });
});

describe("a Cuso chat case's lane", () => {
  const lane = {
    lane: 1,
    cusoBotId: "cuso-bot-1",
    cusoProjectId: "project-1",
  } as EvalLaneRecord;

  it("holds the chat brand and its month as a draft, whatever ran before", async () => {
    vi.clearAllMocks();
    expect(await prepareCmoChatCase(lane, "cmo-brand")).toEqual({});
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ websiteUrl: "https://cal.com/" }),
      }),
    );
    expect(prisma.brandBrain.create).toHaveBeenCalledOnce();
    const { data } = prisma.marketingStrategy.create.mock.calls[0]?.[0] as {
      data: { plan: MarketingStrategyPlan; approvedAt?: Date };
    };
    expect(data.plan.calendar.length).toBeGreaterThan(0);
    expect(data.approvedAt).toBeUndefined();
    // Yesterday's "LinkedIn is now once a week" is not today's plan: a
    // change request once read it and changed nothing.
    expect(prisma.chatRoomMessage.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ senderSokoBotId: "cuso-bot-1" }),
    });
    // A weekly SEO report case's stand-in Search Console is gone again.
    expect(prisma.sokoBotIntegration.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        provider: "google_search_console",
        composioAccountId: { startsWith: "eval:gsc-" },
      }),
    });
    expect(prisma.projectSeoResearch.deleteMany).toHaveBeenCalledOnce();
  });

  it("holds nothing for a client Cuso has not learned", async () => {
    vi.clearAllMocks();
    await prepareCmoChatCase(lane, "cmo-new-client");
    expect(prisma.brandBrain.create).not.toHaveBeenCalled();
    expect(prisma.marketingStrategy.create).not.toHaveBeenCalled();
  });
});

describe("commentChecks", () => {
  const ids = {
    price: "c-price",
    angry: "c-angry",
    spam: "c-spam",
    praise: "c-praise",
    german: "c-german",
  };
  const call = (commentId: string, action: string) => ({
    capability: "handle_social_comment",
    input: { commentId, action },
  });

  it("passes when every comment gets the action it calls for", () => {
    const checks = commentChecks(
      [
        { capability: "list_social_comments", input: {} },
        call("c-price", "reply"),
        call("c-angry", "owner"),
        call("c-spam", "skip"),
        call("c-praise", "reply"),
        call("c-german", "owner"),
      ],
      ids,
    );
    expect(checks.every((check) => check.pass)).toBe(true);
  });

  it("fails a reply to an angry customer and a comment left alone", () => {
    const checks = commentChecks(
      [call("c-angry", "reply"), call("c-spam", "skip")],
      ids,
    );
    expect(
      checks.filter((check) => !check.pass).map((check) => check.label),
    ).toEqual([
      "Handles every comment",
      "price: reply or owner",
      "angry: owner",
      "praise: reply",
      "german: reply or owner",
    ]);
  });
});

describe("monthPlanFromTomorrow", () => {
  it("moves the pieces to one a day from tomorrow and drops what production left", () => {
    const plan = {
      summary: "Plan",
      calendar: [
        {
          id: "a",
          date: "2026-10-01",
          time: "09:00",
          channel: "linkedin",
          title: "Launch",
          format: "post",
          status: "published",
          brief: "Brief",
          claim: "Launch day needs no code",
          draft: "Old words",
          socialPostId: "00000000-0000-4000-8000-000000000001",
          imageFileId: "file-1",
        },
        {
          id: "b",
          date: "2026-10-02",
          channel: "x",
          title: "Skip me",
          format: "post",
          status: "skipped",
        },
        {
          id: "c",
          date: "2026-10-05",
          channel: "x",
          title: "Thread",
          format: "thread",
          status: "idea",
        },
      ],
    } as unknown as MarketingStrategyPlan;
    const moved = monthPlanFromTomorrow(plan, new Date("2026-11-09T04:00:00Z"));
    expect(moved.calendar).toEqual([
      {
        id: "a",
        date: "2026-11-10",
        time: "09:00",
        channel: "linkedin",
        title: "Launch",
        format: "post",
        status: "idea",
        brief: "Brief",
        claim: "Launch day needs no code",
      },
      {
        id: "c",
        date: "2026-11-11",
        channel: "x",
        title: "Thread",
        format: "thread",
        status: "idea",
      },
    ]);
    expect(moved.summary).toBe("Plan");
  });
});

describe("changeRequestPlan", () => {
  it("gives the change request a month with LinkedIn three times a week that keeps every hard rule", () => {
    const plan = changeRequestPlan(new Date("2026-11-09T04:00:00Z"));
    const linkedin = plan.calendar.filter(
      (entry) => entry.channel === "linkedin",
    );
    expect(linkedin).toHaveLength(12);
    // Cutting LinkedIn to one a week still leaves the 16 pieces a save needs,
    // and the review finds nothing the case did not ask about.
    expect(plan.calendar.length - 8).toBeGreaterThanOrEqual(16);
    expect(
      new Set(plan.calendar.map((e) => `${e.channel}/${e.format}`)).size,
    ).toBeGreaterThanOrEqual(6);
    expect(cmoPlanProblems(plan)).toEqual([]);
    expect(plan.channels.find((c) => c.channel === "linkedin")?.cadence).toBe(
      "3 posts a week",
    );
    expect(plan.calendar[0]?.date).toBe("2026-11-10");
    expect(plan.calendar.at(-1)?.date).toBe("2026-12-07");
    expect(cmoPlanRuleProblems(plan)).toEqual([]);
  });
});

describe("the newsletter month", () => {
  const plan = (
    CMO_EVAL_CASES as readonly { id: string; plan?: unknown }[]
  ).find((evalCase) => evalCase.id === "cmo-month-newsletter")?.plan as
    | MarketingStrategyPlan
    | undefined;

  it("plans a newsletter issue on a newsletter channel", () => {
    expect(plan?.calendar.map((entry) => entry.channel)).toContain(
      "newsletter",
    );
    expect(plan?.channels.map((channel) => channel.channel)).toContain(
      "newsletter",
    );
  });

  it("passes a filed issue with its subject line, and nothing else", () => {
    const issue = "cal-newsletter-issue (newsletter/issue)";
    const check = (file: string | null) =>
      newsletterIssueCheck(plan ?? null, [file]).pass;
    expect(
      check(`${issue}: Subject: Book the right rep\n\nHi, one tip this month.`),
    ).toBe(true);
    expect(check(`${issue}: Hi, one tip this month.`)).toBe(false);
    expect(check(`${issue}: Subject: Long\n\n${"word ".repeat(500)}`)).toBe(
      false,
    );
    expect(check(null)).toBe(false);
  });
});

describe("the month's own turns", () => {
  it("keeps its runs and watch follow-ups, never another case's watch", async () => {
    const PREFIX = "cmo:production:bot:1:";
    const all = [
      { id: "make", clientTurnId: `${PREFIX}0`, parentTurnId: null },
      { id: "review", clientTurnId: `${PREFIX}review:0`, parentTurnId: null },
      // A watch the month's run set fires as that run's background run.
      { id: "watch-own", clientTurnId: "watch:w1", parentTurnId: "make" },
      { id: "watch-run", clientTurnId: "lab:x", parentTurnId: "watch-own" },
      // Fired during the month by a watch an earlier chat case left behind.
      { id: "chat", clientTurnId: "lab:chat:1", parentTurnId: null },
      { id: "watch-other", clientTurnId: "watch:w2", parentTurnId: "chat" },
    ].map((turn) => ({ ...turn, status: "COMPLETED", source: "EVENT" }));
    prisma.sokoBotTurn.findMany.mockImplementation(
      async ({
        where,
      }: {
        where: {
          clientTurnId?: { startsWith: string };
          parentTurnId?: { in: string[] };
        };
      }) =>
        all.filter((turn) =>
          where.parentTurnId
            ? turn.parentTurnId !== null &&
              where.parentTurnId.in.includes(turn.parentTurnId)
            : turn.clientTurnId.startsWith(
                where.clientTurnId?.startsWith ?? "",
              ),
        ),
    );
    try {
      const turns = await monthProductionTurns("bot", PREFIX);
      expect(turns.map((turn) => turn.id).sort()).toEqual([
        "make",
        "review",
        "watch-own",
        "watch-run",
      ]);
    } finally {
      prisma.sokoBotTurn.findMany.mockReset();
      prisma.sokoBotTurn.findMany.mockResolvedValue([]);
    }
  });
});

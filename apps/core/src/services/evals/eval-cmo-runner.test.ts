import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const ok = () => vi.fn().mockResolvedValue({});
  return {
    project: { update: ok() },
    marketingStrategy: { deleteMany: ok() },
    sokoBotTurn: {
      findMany: vi.fn().mockResolvedValue([]),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ status: "COMPLETED", finalAnswer: "Ready" }),
    },
    brandBrain: { deleteMany: ok(), create: ok() },
    socialComment: {
      deleteMany: ok(),
      create: vi.fn().mockResolvedValue({ id: "comment-1" }),
    },
    socialPost: { create: vi.fn().mockResolvedValue({ id: "post-1" }) },
  };
});
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

import { requestCmoStrategy } from "@/services/cmo-strategy.service";
import { newestMarketingStrategy } from "@/services/marketing-strategy.service";
import { CMO_EVAL_CASES } from "./eval-cmo-cases";
import {
  commentChecks,
  monthPlanFromTomorrow,
  pollCmoCase,
  prepareCmoComments,
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

describe("prepareCmoComments", () => {
  it("publishes the comment post with exactly one creator: the lane's Cuso", async () => {
    const lane = {
      lane: 1,
      userId: "user-1",
      workspaceId: "workspace-1",
      cusoBotId: "cuso-bot-1",
      cusoProjectId: "project-1",
    } as EvalLaneRecord;
    await prepareCmoComments(lane);
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

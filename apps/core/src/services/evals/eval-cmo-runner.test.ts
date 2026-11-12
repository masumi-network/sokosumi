import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const ok = () => vi.fn().mockResolvedValue({});
  return {
    project: { update: ok() },
    marketingStrategy: { deleteMany: ok() },
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

import {
  cmoPlanProblems,
  cmoPlanRuleProblems,
} from "@/services/cmo-plan-review.service";
import {
  changeRequestPlan,
  commentChecks,
  monthPlanFromTomorrow,
  prepareCmoComments,
} from "./eval-cmo-runner";
import type { EvalLaneRecord } from "./eval-lanes.service";

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

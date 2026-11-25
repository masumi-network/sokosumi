import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { HELD_BACK_REPLY } from "@/lib/soko-bot/action-response";
import {
  type FailureReview,
  readFailureReview,
} from "./failure-review.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const DAY = 24 * 60 * 60 * 1_000;
const suffix = randomUUID().slice(0, 8);
const VERSION = `review-${suffix}`;
const CAPABILITY = `review_tool_${suffix}`;
const CASE = `review-case-${suffix}`;
const now = Date.now();
// Rows stamped by PostgreSQL while the test seeds stay inside the window.
const until = new Date(now + 60 * 60 * 1_000);
const since = new Date(now - 7 * DAY);
const daysAgo = (days: number) => new Date(now - days * DAY);

async function workspaceWithBot(name: string) {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}.${suffix}@review.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `${name} Co`,
      slug: `review-${name.toLowerCase()}-${suffix}`,
      members: { create: [{ userId: user.id, role: "owner" }] },
      workspace: { create: {} },
    },
    select: { id: true, workspace: { select: { id: true } } },
  });
  const workspaceId = organization.workspace!.id;
  const bot = await prisma.sokoBot.create({
    data: { userId: user.id, workspaceId, name: "Soko" },
  });
  return { user, organizationId: organization.id, workspaceId, bot };
}

let review: FailureReview;
const laneWorkspaces: string[] = [];

describe.skipIf(!enabled)("failure review on PostgreSQL", () => {
  beforeAll(async () => {
    const live = await workspaceWithBot("Ada");
    const lane = await workspaceWithBot("Lane");
    laneWorkspaces.push(lane.workspaceId);
    await prisma.evalLane.create({
      data: {
        lane: randomInt(100_000, 1_000_000),
        userId: lane.user.id,
        organizationId: lane.organizationId,
        workspaceId: lane.workspaceId,
        sokoBotId: lane.bot.id,
        world: {},
      },
    });
    const turn = (
      world: typeof live,
      at: Date,
      data: Partial<Parameters<typeof prisma.sokoBotTurn.create>[0]["data"]>,
    ) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: world.bot.id,
          workspaceId: world.workspaceId,
          source: "SCHEDULE",
          clientTurnId: `schedule:${randomUUID()}`,
          userMessage: "Private prompt the review must not quote",
          deadlineAt: new Date(at.getTime() + 60_000),
          createdAt: at,
          versionId: VERSION,
          ...data,
        } as Parameters<typeof prisma.sokoBotTurn.create>[0]["data"],
      });
    const failed = {
      status: "FAILED",
      errorKind: "AI_StreamProviderError",
      errorDetail: "Overloaded for ada@example.com, retry in 30 s",
    } as const;
    await turn(live, daysAgo(1), failed);
    await turn(live, daysAgo(2), failed);
    await turn(live, daysAgo(9), failed);
    await turn(lane, daysAgo(1), failed);
    await turn(live, daysAgo(1), {
      route: "CLARIFY",
      status: "COMPLETED",
      classification: {
        route: "CLARIFY",
        rationaleSummary: "Jev: unsure (MANAGE_WORK at 43%); reads only.",
        requestedOutcome: "Customer words the review must not quote",
      },
    });
    await turn(live, daysAgo(1), {
      status: "COMPLETED",
      finalAnswer: HELD_BACK_REPLY,
    });

    const toolTurn = await turn(live, daysAgo(1), { status: "COMPLETED" });
    await prisma.sokoBotToolCall.create({
      data: {
        turnId: toolTurn.id,
        toolCallId: "call-1",
        capability: CAPABILITY,
        inputHash: "h1",
        status: "FAILED",
        errorKind: "Error",
        errorDetail:
          'Rewrite the post: it says nearly what the post "Secret launch on Friday" says.',
      },
    });
    const schedule = await prisma.sokoBotSchedule.create({
      data: {
        sokoBotId: live.bot.id,
        workspaceId: live.workspaceId,
        name: "Evening roundup",
        timezone: "Europe/Zurich",
        cronExpression: "30 17 * * *",
        prompt: "Private schedule prompt",
        nextRunAt: until,
        systemKey: `review-${suffix}`,
      },
    });
    await prisma.sokoBotScheduleRun.create({
      data: {
        scheduleId: schedule.id,
        scheduledFor: daysAgo(1),
        status: "FAILED",
        errorKind: "schedule_failed",
        errorDetail: "Turn failed",
      },
    });
    await prisma.sokoBotToolCall.create({
      data: {
        turnId: toolTurn.id,
        toolCallId: "call-2",
        capability: "update_schedule",
        inputHash: "h2",
        status: "COMPLETED",
        input: { scheduleId: schedule.id, enabled: false },
      },
    });
    const run = await prisma.evalRun.create({
      data: {
        trigger: "MANUAL",
        suites: ["soko-bot"],
        caseIds: [CASE],
        repeats: 1,
        environment: "test",
        createdAt: daysAgo(1),
      },
    });
    await prisma.evalResult.create({
      data: {
        runId: run.id,
        caseId: CASE,
        suite: "soko-bot",
        repeat: 0,
        position: 0,
        status: "FAILED",
      },
    });

    review = await readFailureReview(since, until);
  });

  afterAll(async () => {
    await prisma.evalRun.deleteMany({ where: { caseIds: { has: CASE } } });
    await prisma.evalLane.deleteMany({
      where: { workspaceId: { in: laneWorkspaces } },
    });
    await prisma.organization.deleteMany({
      where: { slug: { endsWith: suffix } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `${suffix}@review.test` } },
    });
  });

  it("groups failed turns by cause with last week's count, without eval lanes", () => {
    const group = review.sections.turns.find((item) =>
      item.key.includes(VERSION),
    );
    expect(group).toMatchObject({
      key: `FAILED · schedule · ${VERSION} · AI_StreamProviderError · Overloaded for [email], retry in N s`,
      count: 2,
      previousCount: 1,
    });
    expect(group?.examples).toHaveLength(2);
  });

  it("counts CLARIFY reroutes and replies held back", () => {
    const keys = review.sections.replyChecks.map((item) => item.key);
    expect(keys).toContain(
      `CLARIFY · schedule · ${VERSION} · unsure, wanted MANAGE_WORK`,
    );
    expect(keys).toContain(`reply held back unchecked · schedule · ${VERSION}`);
  });

  it("groups tool failures, schedule runs, bot disables and eval cases", () => {
    expect(
      review.sections.toolCalls.find((item) => item.key.startsWith(CAPABILITY)),
    ).toMatchObject({
      key: `${CAPABILITY} · Error · Rewrite the post: it says nearly what the post "…" says.`,
      count: 1,
    });
    expect(review.sections.schedules.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        `run FAILED · review-${suffix} · schedule_failed · Turn failed`,
        "bot disabled a schedule",
      ]),
    );
    expect(
      review.sections.evals.find((item) => item.key.includes(CASE)),
    ).toMatchObject({ key: `soko-bot/${CASE} · FAILED`, count: 1 });
  });

  it("quotes no prompt, post or email", () => {
    const text = JSON.stringify(review);
    for (const secret of [
      "Private prompt",
      "Customer words",
      "Secret launch",
      "Private schedule prompt",
      "ada@example.com",
    ])
      expect(text).not.toContain(secret);
  });
});

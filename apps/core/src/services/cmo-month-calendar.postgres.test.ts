/**
 * Real-Postgres proof of Core's month calendar (cmo-v22): once the owner
 * has paid, one write at a time plans and writes the month, saves it on the
 * approved version and as its Social posts, and production waits for it. A
 * write that fails is tried again, a partial one is finished by the next,
 * and a month Cuso wrote before cmo-v22 is made as it always was. The model
 * is faked; everything else is real.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-month-calendar.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import {
  type CmoCalendarEntry,
  type CmoMonthWriter,
  marketingStrategyPlanSchema,
} from "@sokosumi/soko-bot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const kickCmoProduction = vi.hoisted(() => vi.fn());

vi.mock("ai", async (actual) => ({
  ...(await actual<typeof import("ai")>()),
  generateText,
}));
vi.mock("@/lib/repeats", () => ({
  findRepeats: async (texts: string[]) => ({
    repeats: texts.map(() => null),
    costUsd: 0,
  }),
}));
vi.mock("@/services/soko-bot-billing.service", async (actual) => ({
  ...(await actual<typeof import("@/services/soko-bot-billing.service")>()),
  recordSokoBotCheckUsage: vi.fn(async () => ({})),
}));
vi.mock("@/services/cmo-production.service", async (actual) => ({
  ...(await actual<typeof import("@/services/cmo-production.service")>()),
  kickCmoProduction,
  cmoPraiseOnly: async (points: string[]) => ({ points, costUsd: 0 }),
}));

import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import {
  CMO_MONTH_CALENDAR_ATTEMPTS,
  CMO_MONTH_CALENDAR_MAX_ATTEMPTS,
  CMO_MONTH_CALENDAR_RETRY_MS,
  runCmoMonthCalendar,
  stopCmoMonthCalendar,
} from "@/services/cmo-month-calendar.service";
import { readCmoProduction } from "@/services/cmo-production.service";
import {
  approveMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";
import { expectCoreLog } from "@/test/core-log";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const DAY = 86_400_000;

interface Seeded {
  userId: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  sokoBotId: string;
}
const seeded: Seeded[] = [];

const tomorrow = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);

function examples(): CmoCalendarEntry[] {
  const date = tomorrow();
  return [
    [
      "ex-1",
      "linkedin",
      "image",
      "Launch planning",
      "educational",
      "awareness",
    ],
    ["ex-2", "x", "image", "Fees and costs", "promotional", "action"],
    ["ex-3", "x", "post", "Market news", "educational", "interest"],
  ].map(([id, channel, format, pillar, approach, stage]) => ({
    id: id!,
    date,
    time: "10:00",
    channel: channel!,
    format: format!,
    status: "idea",
    title: `Example ${id}`,
    brief: `What ${id} shows`,
    why: "Shows the month",
    claim: `Claim ${id}`,
    pillar,
    approach,
    stage,
  })) as CmoCalendarEntry[];
}

function plan(byCore: boolean) {
  return marketingStrategyPlanSchema.parse({
    month: tomorrow().slice(0, 7),
    summary: "Launch help first, then the free account.",
    goals: ["More NMKR Studio projects"],
    pillars: [
      { name: "Launch planning", share: 40, why: "i1 i2 i3" },
      { name: "Fees and costs", share: 35, why: "i4 i5 i6" },
      { name: "Market news", share: 25, why: "i7 i8 i9" },
    ],
    mix: [
      { approach: "educational", share: 70, why: "Help with launches" },
      { approach: "promotional", share: 30, why: "The free account" },
    ],
    channels: [
      { channel: "x", cadence: "6 a day" },
      { channel: "linkedin", cadence: "1 a day" },
    ],
    calendar: examples(),
    contentLanguage: "English",
    ...(byCore ? { monthWriter: { state: "examples", attempts: 0 } } : {}),
  });
}

async function seedCuso(input: { byCore: boolean; paid?: boolean }) {
  const suffix = randomUUID().slice(0, 8);
  const userId = `month-calendar-user-${suffix}`;
  const organizationId = `month-calendar-org-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: "Month Calendar",
      email: `month-calendar-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Month Calendar Org",
      slug: organizationId,
      members: { create: { userId, role: "owner" } },
    },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId },
    select: { id: true },
  });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: "nmkr.io",
      websiteUrl: "https://www.nmkr.io",
    },
    select: { id: true },
  });
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      userId: null,
      createdByUserId: userId,
      versionId: "cmo-v22",
      name: "Cuso",
    },
    select: { id: true },
  });
  const row = {
    userId,
    organizationId,
    workspaceId: workspace.id,
    projectId: project.id,
    sokoBotId: bot.id,
  };
  seeded.push(row);
  const strategy = await prisma.marketingStrategy.create({
    data: {
      projectId: project.id,
      plan: plan(input.byCore),
      authorSokoBotId: bot.id,
    },
    select: { id: true },
  });
  await approveMarketingStrategy({
    projectId: project.id,
    workspaceId: workspace.id,
    userId,
    strategyId: strategy.id,
  });
  if (input.paid !== false) {
    const now = new Date();
    await prisma.polarSubscription.create({
      data: {
        kind: "CMO",
        projectId: project.id,
        organizationId,
        polarSubscriptionId: `sub_${randomUUID()}`,
        polarProductId: "prod_starter",
        tier: "starter",
        interval: "month",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * DAY),
        cancelAtPeriodEnd: false,
        endedAt: null,
        polarEventAt: now,
      },
    });
  }
  const cuso = await findCusoForBot(bot.id);
  if (!cuso) throw new Error("No Cuso");
  return { ...row, cuso, versionId: strategy.id };
}

function answerEvery(fail?: (prompt: string) => boolean) {
  generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
    if (fail?.(prompt)) throw new Error("timeout");
    const ids = [...prompt.matchAll(/^- (m-[\w-]+) ·/gm)].map((m) => m[1]!);
    return {
      output: {
        posts: ids.map((id) => ({
          id,
          title: `Post ${id}`,
          brief: `What ${id} says`,
          why: "Serves its pillar",
          claim: `Claim of ${id}`,
          story: null,
        })),
      },
      usage: { inputTokens: 1000, outputTokens: 400 },
      providerMetadata: {},
    };
  });
}

/** Puts the month's writer where a run of earlier writes left it. */
async function setWriter(versionId: string, writer: CmoMonthWriter) {
  const plan = await stored(versionId);
  await prisma.marketingStrategy.update({
    where: { id: versionId },
    data: { plan: jsonInput({ ...plan, monthWriter: writer }) },
  });
}

async function stored(versionId: string) {
  const version = await prisma.marketingStrategy.findUniqueOrThrow({
    where: { id: versionId },
    select: { plan: true },
  });
  return parseMarketingPlan(version.plan)!;
}

const posts = (versionId: string) =>
  prisma.socialPost.count({ where: { marketingStrategyId: versionId } });

const production = (
  cuso: Awaited<ReturnType<typeof seedCuso>>["cuso"],
  subscribed = true,
) =>
  readCmoProduction(cuso, {
    connected: new Set(),
    subscribed,
    now: new Date(),
  });

/** Starter on X and LinkedIn: 84 X posts and 20 LinkedIn posts. */
const STARTER_POSTS = 84 + 20;

beforeEach(() => {
  generateText.mockReset();
  kickCmoProduction.mockReset();
});

afterEach(async () => {
  for (const row of seeded.splice(0)) {
    await prisma.socialPost.deleteMany({ where: { projectId: row.projectId } });
    await prisma.marketingStrategy.deleteMany({
      where: { projectId: row.projectId },
    });
    await prisma.polarSubscription.deleteMany({
      where: { projectId: row.projectId },
    });
    await prisma.sokoBot.deleteMany({ where: { id: row.sokoBotId } });
    await prisma.project.deleteMany({ where: { id: row.projectId } });
    await prisma.workspace.deleteMany({ where: { id: row.workspaceId } });
    await prisma.member.deleteMany({
      where: { organizationId: row.organizationId },
    });
    await prisma.organization.deleteMany({
      where: { id: row.organizationId },
    });
    await prisma.user.deleteMany({ where: { id: row.userId } });
  }
});

// Each case seeds a Cuso and writes a whole month: a cold first case passes 5 s.
describe.skipIf(!enabled)(
  "Core's month calendar (cmo-v22)",
  { timeout: 30_000 },
  () => {
    it("waits for payment, plans the paid month, and production then makes all of it", async () => {
      const hire = await seedCuso({ byCore: true });
      expect((await production(hire.cuso, false)).status.state).toBe("waiting");
      expect((await production(hire.cuso)).status.state).toBe("planning");
      // The examples are Social posts from approval on.
      expect(await posts(hire.versionId)).toBe(3);

      answerEvery();
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ).toBe(true);

      const plan = await stored(hire.versionId);
      expect(plan.monthWriter).toMatchObject({
        state: "written",
        level: "steady",
        attempts: 1,
        start: tomorrow(),
      });
      expect(plan.calendar).toHaveLength(STARTER_POSTS);
      expect(plan.calendar.slice(0, 3).map((entry) => entry.title)).toEqual([
        "Example ex-1",
        "Example ex-2",
        "Example ex-3",
      ]);
      expect(await posts(hire.versionId)).toBe(STARTER_POSTS);
      const read = await production(hire.cuso);
      expect(read.status.state).not.toBe("planning");
      expect(read.status.total).toBe(STARTER_POSTS);
      expect(read.status.floor).toEqual({ promised: STARTER_POSTS, made: 0 });
      expect(read.status.beyondPlan).toEqual([]);
      expect(kickCmoProduction).toHaveBeenCalledWith(hire.sokoBotId);
    });

    it("claims one write when two callers race", async () => {
      const hire = await seedCuso({ byCore: true });
      answerEvery();
      const results = await Promise.all([
        runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
        runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await posts(hire.versionId)).toBe(STARTER_POSTS);
      expect((await stored(hire.versionId)).monthWriter?.attempts).toBe(1);
    });

    it("finishes a partial write with the next one, without a post twice", async () => {
      const hire = await seedCuso({ byCore: true });
      answerEvery(
        (prompt) => prompt.includes("· x post") || prompt.includes("· x reply"),
      );
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ).toBe(false);
      const partial = await stored(hire.versionId);
      expect(partial.monthWriter).toMatchObject({
        state: "writing",
        attempts: 1,
      });
      expect(partial.calendar.length).toBeLessThan(STARTER_POSTS);
      expect((await production(hire.cuso)).status.state).toBe("planning");

      answerEvery();
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ).toBe(true);
      const whole = await stored(hire.versionId);
      expect(whole.calendar).toHaveLength(STARTER_POSTS);
      expect(new Set(whole.calendar.map((entry) => entry.id)).size).toBe(
        STARTER_POSTS,
      );
      expect(await posts(hire.versionId)).toBe(STARTER_POSTS);
    });

    it("tries a failing write again, then every three hours, and never leaves the month dead", async () => {
      const hire = await seedCuso({ byCore: true });
      expectCoreLog("warn", "Core's write of a CMO month failed", 2);
      expectCoreLog("error", "Core's write of a CMO month failed", 1);
      generateText.mockRejectedValue(new Error("gateway down"));
      let now = Date.now();
      for (let attempt = 1; attempt <= CMO_MONTH_CALENDAR_ATTEMPTS; attempt++) {
        expect(
          await runCmoMonthCalendar(
            hire.cuso,
            hire.versionId,
            "steady",
            new Date(now),
          ),
        ).toBe(false);
        now += 60_000;
      }
      const failed = await stored(hire.versionId);
      expect(failed.monthWriter).toMatchObject({
        state: "writing",
        attempts: CMO_MONTH_CALENDAR_ATTEMPTS,
        error: "Error",
      });
      // Its tries ran out: the next waits, the owner still reads "planning".
      answerEvery();
      expect(
        await runCmoMonthCalendar(
          hire.cuso,
          hire.versionId,
          "steady",
          new Date(now),
        ),
      ).toBe(false);
      expect((await production(hire.cuso)).status.state).toBe("planning");
      expect(
        await runCmoMonthCalendar(
          hire.cuso,
          hire.versionId,
          "steady",
          new Date(Date.now() + CMO_MONTH_CALENDAR_RETRY_MS + 5 * 60_000),
        ),
      ).toBe(true);
      expect(await posts(hire.versionId)).toBe(STARTER_POSTS);
    });

    it("stops after its last try ends short, and the owner reads the month stuck on our side", async () => {
      const hire = await seedCuso({ byCore: true });
      expectCoreLog("error", "Core's write of a CMO month failed", 1);
      await setWriter(hire.versionId, {
        state: "writing",
        level: "steady",
        attempts: CMO_MONTH_CALENDAR_MAX_ATTEMPTS - 1,
        startedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
        endedAt: new Date(Date.now() - 4 * 3_600_000 + 60_000).toISOString(),
      });
      generateText.mockRejectedValue(new Error("gateway down"));
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ).toBe(false);
      expect((await stored(hire.versionId)).monthWriter).toMatchObject({
        state: "stopped",
        attempts: CMO_MONTH_CALENDAR_MAX_ATTEMPTS,
      });
      const { status } = await production(hire.cuso);
      expect(status).toMatchObject({
        state: "stuck",
        writerFailed: true,
        retryAt: null,
      });
      answerEvery();
      expect(
        await runCmoMonthCalendar(
          hire.cuso,
          hire.versionId,
          "steady",
          new Date(Date.now() + DAY),
        ),
      ).toBe(false);
    });

    it("stops a month whose eleventh write was interrupted, without a twelfth", async () => {
      const hire = await seedCuso({ byCore: true });
      expectCoreLog("error", "Core could not write a whole CMO month", 1);
      await setWriter(hire.versionId, {
        state: "writing",
        level: "steady",
        attempts: CMO_MONTH_CALENDAR_MAX_ATTEMPTS,
        startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        endedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
      });
      answerEvery();
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ).toBe(false);
      expect(generateText).not.toHaveBeenCalled();
      expect((await production(hire.cuso)).status.state).toBe("planning");

      expect(
        await stopCmoMonthCalendar(
          hire.cuso,
          hire.versionId,
          "steady",
          new Date(),
        ),
      ).toBe(true);
      expect((await stored(hire.versionId)).monthWriter?.state).toBe("stopped");
      expect((await production(hire.cuso)).status).toMatchObject({
        state: "stuck",
        writerFailed: true,
      });
    });

    it("adds the bigger plan's posts after an upgrade", async () => {
      const hire = await seedCuso({ byCore: true });
      answerEvery();
      await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady");
      // Scale is not paid for yet: nothing is written at its level.
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "all_in"),
      ).toBe(false);
      await prisma.polarSubscription.updateMany({
        where: { projectId: hire.projectId },
        data: { tier: "scale" },
      });
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "all_in"),
      ).toBe(true);
      // Scale on X and LinkedIn: 168 X posts and 28 LinkedIn posts.
      expect(await posts(hire.versionId)).toBe(168 + 28);
    });

    // Local e2e, 2026-11-25: the plan ended between production's two reads
    // and a Scale month started for a Cuso nobody paid for any more.
    it("writes nothing once the plan has ended, at any level", async () => {
      const hire = await seedCuso({ byCore: true });
      answerEvery();
      await prisma.polarSubscription.updateMany({
        where: { projectId: hire.projectId },
        data: { status: "canceled", endedAt: new Date() },
      });
      for (const level of ["steady", "all_in"] as const)
        expect(
          await runCmoMonthCalendar(hire.cuso, hire.versionId, level),
        ).toBe(false);
      expect(generateText).not.toHaveBeenCalled();
      expect((await stored(hire.versionId)).monthWriter?.state).toBe(
        "examples",
      );
    });

    it("makes a month Cuso wrote before cmo-v22 as it always was", async () => {
      const hire = await seedCuso({ byCore: false });
      const read = await production(hire.cuso);
      expect(read.status.state).not.toBe("planning");
      expect(read.status.floor).toBeNull();
      expect(
        await runCmoMonthCalendar(hire.cuso, hire.versionId, "steady"),
      ).toBe(false);
      expect(generateText).not.toHaveBeenCalled();
      expect((await stored(hire.versionId)).calendar).toHaveLength(3);
    });
  },
);

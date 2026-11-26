/**
 * The owner benchmark's checks against a real PostgreSQL. An in-memory test
 * passed while Prisma rejected a select at run time (an image job has an
 * `asset` relation, not an `assetId` column), so every outcome any journey
 * uses runs here against populated rows, and the image and draft verdicts
 * are asserted on them.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/evals/ownerbench/journey-checks.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { convertCreditsToCents } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { createTaskSchedule } from "@/services/task-schedule.service";
import {
  clearBotTaskSchedules,
  type EvalLaneRecord,
} from "../eval-lanes.service";
import {
  type CheckContext,
  durableSchedules,
  indexedTexts,
  outcomeCheck,
} from "./journey-checks";
import {
  answeredTaskId,
  claimedRunCheck,
  claimedRunState,
  deliverCoworkerAnswer,
  fireTaskSchedule,
  foregroundTurnId,
  freshConversationCheck,
  journeyTokens,
  routingFailures,
  scheduleToFire,
  wakeCheck,
  withDescendants,
} from "./journey-runner";
import {
  type JourneyWorld,
  seedAgent,
  seedPicturePosts,
  seedTeammateRoom,
} from "./journey-world";
import { type JourneyOutcome, OWNER_JOURNEYS } from "./journeys";

// A released Task is announced over Ably, which has no key here.
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(async () => undefined),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("owner benchmark checks on Postgres", () => {
  const userId = randomUUID();
  let workspaceId: string;
  let projectId: string;
  let context: CheckContext;
  const since = new Date(Date.now() - 60_000);

  async function imageJob(status: "SUCCEEDED" | "FAILED", made: boolean) {
    const job = await prisma.projectImageJob.create({
      data: {
        projectId,
        workspaceId,
        requestedByUserId: userId,
        kind: "GENERATE",
        model: "fixture",
        prompt: "white background, black bullet points about memory",
        settings: {},
        status,
        idempotencyKey: randomUUID(),
      },
      select: { id: true },
    });
    if (made)
      await prisma.projectImageAsset.create({
        data: {
          projectId,
          workspaceId,
          jobId: job.id,
          rootId: randomUUID(),
          version: 1,
          model: "fixture",
          prompt: "white background",
          settings: {},
          blobPathname: `fixture/${job.id}.png`,
          contentType: "image/png",
          width: 1024,
          height: 1024,
          bytes: 1,
          checksum: job.id,
        },
      });
    return job.id;
  }

  function file(name: string, mimeType: string) {
    return prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: "DRIVE_UPLOAD",
        sourceScope: "USER",
        sourceId: `users/${userId}/${name}`,
        displayName: name,
        normalizedName: name.toLowerCase(),
        mimeType,
        lifecycle: "ACTIVE",
      },
      select: { sourceId: true },
    });
  }

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Journey owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
    projectId = (
      await prisma.project.create({
        data: { workspaceId, name: "Padierfind" },
        select: { id: true },
      })
    ).id;
    // Two made studio images (one copied into Files), one failed job, and an
    // uploaded SVG; the draft carries the SVG and the copy, plus an old logo.
    const copied = await imageJob("SUCCEEDED", true);
    await imageJob("SUCCEEDED", true);
    await imageJob("FAILED", false);
    const copy = await file(
      `memory-${copied.replace(/-/g, "").slice(-8)}.png`,
      "image/png",
    );
    const svg = await file("bullets.svg", "image/svg+xml");
    await prisma.socialPost.create({
      data: {
        projectId,
        workspaceId,
        provider: "x",
        text: "How Soko Bots remember: typed memory.",
        status: "NEEDS_APPROVAL",
        creatorUserId: userId,
        media: [
          { pathname: svg.sourceId },
          { pathname: copy.sourceId },
          { pathname: `users/${userId}/old-logo.png` },
        ],
      },
    });
    const projects = {
      Padierfind: projectId,
      "Sokosumi Marketing": projectId,
      "utxo AG Outreach": projectId,
      Cuso: projectId,
    };
    context = {
      lane: {
        lane: 9,
        userId,
        organizationId: randomUUID(),
        workspaceId,
        sokoBotId: randomUUID(),
        cusoBotId: randomUUID(),
        cusoProjectId: projectId,
        world: {
          hannahUserId: randomUUID(),
          alexUserId: randomUUID(),
          marketingProjectId: projectId,
          outreachProjectId: projectId,
          roomId: randomUUID(),
        },
      } satisfies EvalLaneRecord,
      world: {
        coworkers: { CodePat: randomUUID(), Mira: randomUUID() },
        projects,
        seededSchedules: [],
        seededWeekdayPostIds: [],
        upcomingByNetwork: {},
      } satisfies JourneyWorld,
      journey: OWNER_JOURNEYS[0]!,
      journeyStartedAt: since,
      stepStartedAt: since,
      toolCalls: [],
      botId: randomUUID(),
      answer: null,
      memo: {},
    };
  });

  afterAll(async () => {
    await prisma.socialPost.deleteMany({ where: { workspaceId } });
    await prisma.fileResource.deleteMany({ where: { workspaceId } });
    await prisma.projectImageAsset.deleteMany({ where: { workspaceId } });
    await prisma.projectImageJob.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("runs every outcome any journey uses without a query error", async () => {
    const outcomes = OWNER_JOURNEYS.flatMap((journey) =>
      journey.steps.flatMap((step) => step.outcomes ?? []),
    );
    for (const outcome of outcomes) {
      const check = await outcomeCheck(outcome, context);
      expect(check.label, outcome.kind).toBe(outcome.label);
    }
  });

  it("counts made images from Files and studio jobs, failed ones aside", async () => {
    const check = await outcomeCheck(
      { kind: "images", label: "images", min: 3, max: 3 },
      context,
    );
    expect(check).toMatchObject({ pass: true });
    expect(check.actual).toContain("3 image(s) made, 1 failed or unfinished");
  });

  describe("the owner's schedule across a run and an edit", () => {
    let botId: string;
    const owned = { kind: "schedule", label: "owner's", count: 1 } as const;
    const check = (
      identity: "remember" | "unchanged" | "edited",
      extra: object = {},
    ) =>
      outcomeCheck(
        { ...owned, identity, ...extra },
        { ...context, botId, memo: context.memo },
      );
    const create = (prompt: string, enabled = true) =>
      prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name: "Monday report",
          timezone: "Europe/Berlin",
          cronExpression: "0 8 * * 1",
          prompt,
          enabled,
          nextRunAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });

    beforeAll(async () => {
      botId = (
        await prisma.sokoBot.create({
          data: { userId, workspaceId },
          select: { id: true },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
      await prisma.sokoBot.deleteMany({ where: { id: botId } });
    });

    it("fails a run that deleted it, and a disabled replacement under a new id", async () => {
      const original = await create("Report finished, stuck and waiting work.");
      expect((await check("remember")).pass).toBe(true);
      expect((await check("unchanged")).pass).toBe(true);
      await prisma.sokoBotSchedule.delete({ where: { id: original.id } });
      expect(await check("unchanged")).toMatchObject({
        pass: false,
        actual: expect.stringContaining("is gone"),
      });
      await create("Report finished and waiting work.", false);
      expect((await check("edited")).pass).toBe(false);
    });

    it("fails a run or an edit that moves the schedule to another time zone", async () => {
      await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
      const original = await create("Report finished and waiting work.");
      await check("remember");
      await prisma.sokoBotSchedule.update({
        where: { id: original.id },
        data: { timezone: "UTC" },
      });
      expect(await check("unchanged")).toMatchObject({
        pass: false,
        actual: expect.stringContaining("time zone Europe/Berlin → UTC"),
      });
      await prisma.sokoBotSchedule.update({
        where: { id: original.id },
        data: { cronExpression: "30 7 * * 1" },
      });
      expect((await check("edited")).pass).toBe(false);
      await prisma.sokoBotSchedule.update({
        where: { id: original.id },
        data: { timezone: "Europe/Berlin" },
      });
      expect((await check("edited")).pass).toBe(true);
    });

    it("fails an edit that keeps the dropped clause, passes the same id without it", async () => {
      await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
      const original = await create("Report finished, stuck and waiting work.");
      await check("remember");
      await prisma.sokoBotSchedule.update({
        where: { id: original.id },
        data: { cronExpression: "30 7 * * 1" },
      });
      expect(
        (await check("edited", { promptAvoids: ["stuck"] })).actual,
      ).toContain("prompt still says /stuck/");
      await prisma.sokoBotSchedule.update({
        where: { id: original.id },
        data: { prompt: "Report finished and waiting work." },
      });
      expect((await check("edited", { promptAvoids: ["stuck"] })).pass).toBe(
        true,
      );
    });
  });

  it("follows the claimed scheduled run: a failed or dead-lettered one ends and fails the step", async () => {
    const botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId },
        select: { id: true },
      })
    ).id;
    const schedule = await prisma.sokoBotSchedule.create({
      data: {
        sokoBotId: botId,
        workspaceId,
        requestedByUserId: userId,
        name: "Daily",
        timezone: "UTC",
        cronExpression: "0 9 * * *",
        prompt: "Daily brief.",
        nextRunAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });
    const run = (
      status: "FAILED" | "DEAD_LETTER" | "COMPLETED",
      turnId?: string,
    ) =>
      prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: schedule.id,
          scheduledFor: new Date(Date.now() - Math.random() * 1e9),
          status,
          ...(turnId ? { turnId } : {}),
        },
        select: { id: true },
      });
    for (const status of ["FAILED", "DEAD_LETTER"] as const) {
      const memo = { scheduleRun: [schedule.id, (await run(status)).id] };
      expect(await claimedRunState(memo, botId)).toBe("failed");
      expect(await claimedRunCheck(memo)).toMatchObject({
        pass: false,
        actual: `${status}, no turn`,
      });
    }
    const turn = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        workspaceId,
        requestedByUserId: userId,
        source: "SCHEDULE",
        status: "COMPLETED",
        clientTurnId: `schedule:${randomUUID()}`,
        userMessage: "Daily brief.",
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    });
    const ran = {
      scheduleRun: [schedule.id, (await run("COMPLETED", turn.id)).id],
    };
    expect(await claimedRunState(ran, botId)).toBe("started");
    expect((await claimedRunCheck(ran)).pass).toBe(true);
    // A deferred run's step starts with no turn; once the run's turn exists
    // it is the step's own, so the Coworker handover can see it.
    const journey = OWNER_JOURNEYS.find(
      (entry) => entry.id === "owner-codepat-daily-post",
    )!;
    const scheduleStep = journey.steps.findIndex(
      (step) => step.kind === "schedule_fires",
    );
    const record = {
      index: scheduleStep,
      kind: "schedule_fires" as const,
      label: "",
      startedAt: new Date().toISOString(),
      turnIds: [] as string[],
      checks: [],
    };
    const state = {
      world: context.world,
      journeyStartedAt: since.toISOString(),
      steps: [record],
      memo: ran,
    };
    expect(await foregroundTurnId(journey, record, state)).toBe(turn.id);
    expect(record.turnIds).toEqual([turn.id]);
    expect(
      await foregroundTurnId(
        journey,
        { ...record, index: 0, turnIds: [] },
        state,
      ),
    ).toBeNull();
    expect((await claimedRunCheck({})).actual).toBe("no run claimed");
    await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
  });

  it("finds a journey turn's background runs at any depth", async () => {
    const botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId },
        select: { id: true },
      })
    ).id;
    const turn = (parentTurnId?: string) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: `lab:fixture:${randomUUID()}`,
          userMessage: "hello",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          ...(parentTurnId ? { parentTurnId } : {}),
        },
        select: { id: true },
      });
    const root = await turn();
    const child = await turn(root.id);
    const grandchild = await turn(child.id);
    await turn();
    expect(
      (await withDescendants([root.id])).map((entry) => entry.id).sort(),
    ).toEqual([root.id, child.id, grandchild.id].sort());
    await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
  });

  it("finds the journey's failed route picks, background runs included", async () => {
    const botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId },
        select: { id: true },
      })
    ).id;
    const turn = (parentTurnId?: string) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: `lab:fixture:${randomUUID()}`,
          userMessage: "hello",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          ...(parentTurnId ? { parentTurnId } : {}),
        },
        select: { id: true },
      });
    const root = await turn();
    const child = await turn(root.id);
    const call = (turnId: string, failed: boolean) =>
      prisma.sokoBotModelCall.create({
        data: {
          turnId,
          role: "classifier",
          requestedModel: "typesafe-ai/jev",
          failed,
        },
      });
    await call(root.id, false);
    expect(await routingFailures([root.id])).toEqual({ calls: 1, failed: 0 });
    await call(child.id, true);
    expect(await routingFailures([root.id])).toEqual({ calls: 2, failed: 1 });
    // The answered pick reported no usage: the journey's tokens are unmeasured.
    expect((await journeyTokens([root.id])).inputTokensPerTurn).toBeNull();
    await prisma.sokoBotModelCall.updateMany({
      where: { turnId: root.id, failed: false },
      data: { inputTokens: 300 },
    });
    expect((await journeyTokens([root.id])).inputTokensPerTurn).toBe(150);
    await prisma.sokoBotModelCall.deleteMany({
      where: { turnId: { in: [root.id, child.id] } },
    });
    await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
  });

  it("grades contacts, saved files, Task replies, Cuso's schedule, published posts and hires", async () => {
    const bot = await prisma.sokoBot.create({
      data: { userId, workspaceId },
      select: { id: true },
    });
    const vendor = await prisma.vendor.upsert({
      where: { slug: "journey-checks-fixture" },
      create: { slug: "journey-checks-fixture", name: "Fixture" },
      update: {},
      select: { id: true },
    });
    const coworker = await prisma.coworker.create({
      data: {
        slug: `fixture-${randomUUID()}`,
        name: "Mira",
        baseURL: "https://coworker.evals.invalid",
        capabilities: ["tasks"],
        vendorId: vendor.id,
      },
      select: { id: true },
    });
    const task = await prisma.task.create({
      data: {
        workspaceId,
        name: "Fixture review",
        status: "RUNNING",
        assigneeId: coworker.id,
      },
      select: { id: true },
    });
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        sokoBotId: bot.id,
        comment: "Friendly nudge: how is the review going?",
      },
    });
    await prisma.contact.create({
      data: {
        workspaceId,
        name: "Pat Example",
        organization: "Example Fund",
        summary: "Met today; wants a follow-up.",
      },
    });
    const published = await prisma.socialPost.create({
      data: {
        projectId,
        workspaceId,
        provider: "x",
        text: "Already out.",
        status: "PUBLISHED",
        creatorUserId: userId,
        media: [
          { pathname: "users/fixture/out.png", name: "out.png", kind: "image" },
          { pathname: "users/fixture/two.png", name: "two.png", kind: "image" },
        ],
      },
      select: { id: true, text: true },
    });
    for (let index = 0; index < 2; index += 1)
      await prisma.socialPost.create({
        data: {
          projectId,
          workspaceId,
          provider: "x",
          text: `Upcoming ${index}`,
          status: "SCHEDULED",
          creatorUserId: userId,
        },
      });
    await file("report.md", "text/markdown");
    const report = await prisma.fileResource.findFirstOrThrow({
      where: { workspaceId, displayName: "report.md" },
      select: { id: true },
    });
    const graded = {
      ...context,
      botId: bot.id,
      world: {
        ...context.world,
        coworkers: { ...context.world.coworkers, Mira: coworker.id },
        seededPublished: [
          {
            ...published,
            pathnames: ["users/fixture/out.png", "users/fixture/two.png"],
          },
        ],
      },
      toolCalls: [
        {
          capability: "upload_file",
          status: "SUCCEEDED",
          input: {
            filename: "report.md",
            content: "Pick plan B. Link: docs.example",
          },
          result: { id: report.id, filename: "report.md", size: 31 },
        },
        {
          capability: "hire_agent",
          status: "FAILED",
          input: {},
          result: {},
        },
      ],
    } satisfies CheckContext;
    const verdicts = await Promise.all(
      (
        [
          {
            kind: "contact",
            label: "c",
            nameMatches: "pat example",
            notesMatch: ["example fund", "follow-up"],
          },
          { kind: "contact", label: "c2", nameMatches: "someone else" },
          {
            kind: "file",
            label: "f",
            textMatches: ["plan b"],
            textAvoids: ["plan c"],
          },
          {
            kind: "file",
            label: "f2",
            textMatches: ["plan b"],
            textAvoids: ["docs\\.example"],
          },
          {
            kind: "taskReply",
            label: "t",
            coworker: "Mira",
            textMatches: ["review"],
          },
          {
            kind: "taskReply",
            label: "t2",
            coworker: "Mira",
            textMatches: ["invoice"],
          },
          { kind: "scheduledPosts", label: "s", min: 2, max: 2 },
          { kind: "scheduledPosts", label: "s2", max: 0 },
          { kind: "publishedUntouched", label: "p" },
          { kind: "noHires", label: "h" },
        ] satisfies JourneyOutcome[]
      ).map((outcome: JourneyOutcome) => outcomeCheck(outcome, graded)),
    );
    expect(
      Object.fromEntries(verdicts.map((check) => [check.label, check.pass])),
    ).toEqual({
      c: true,
      c2: false,
      f: true,
      f2: false,
      t: true,
      t2: false,
      s: true,
      s2: false,
      p: true,
      h: true,
    });
    const untouched = () =>
      outcomeCheck({ kind: "publishedUntouched", label: "p" }, graded);
    const out = { kind: "image", pathname: "users/fixture/out.png" };
    const two = { kind: "image", pathname: "users/fixture/two.png" };
    const setMedia = (media: object[], status?: "CANCELED") =>
      prisma.socialPost.update({
        where: { id: published.id },
        data: { media, ...(status ? { status } : {}) },
      });
    // Same attachments, keys in another order: untouched.
    await setMedia([
      { name: "out.png", ...out },
      { name: "two.png", ...two },
    ]);
    expect((await untouched()).pass).toBe(true);
    // The same two images, reversed: changed.
    await setMedia([two, out]);
    expect((await untouched()).pass).toBe(false);
    await setMedia([
      { pathname: "users/fixture/other.png", kind: "image" },
      two,
    ]);
    expect((await untouched()).pass).toBe(false);
    await setMedia([out, two], "CANCELED");
    expect(
      (await outcomeCheck({ kind: "publishedUntouched", label: "p" }, graded))
        .pass,
    ).toBe(false);
    await prisma.taskEvent.deleteMany({ where: { taskId: task.id } });
    await prisma.task.deleteMany({ where: { id: task.id } });
    await prisma.coworker.deleteMany({ where: { id: coworker.id } });
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.sokoBot.deleteMany({ where: { id: bot.id } });
    await prisma.socialPost.deleteMany({
      where: {
        workspaceId,
        text: { in: ["Already out.", "Upcoming 0", "Upcoming 1"] },
      },
    });
    await prisma.fileResource.deleteMany({
      where: { workspaceId, displayName: "report.md" },
    });
  });

  it("passes a replaced picture on the seeded posts as jsonb returns them, and fails one left in place", async () => {
    const bot = await prisma.sokoBot.create({
      data: { userId, workspaceId },
      select: { id: true },
    });
    const lane = { ...context.lane, cusoBotId: bot.id };
    const saveImage = async (_lane: EvalLaneRecord, image: { name: string }) =>
      (await file(`seeded-${image.name}`, "image/svg+xml")).sourceId;
    const seeded = await seedPicturePosts(
      lane,
      [
        {
          text: "Target post.",
          pictureText: "Target",
          provider: "linkedin",
          inDays: 3,
          target: true,
        },
        { text: "Other one.", pictureText: "One", provider: "x", inDays: 4 },
        {
          text: "Other two.",
          pictureText: "Two",
          provider: "linkedin",
          inDays: 5,
        },
      ],
      saveImage,
    );
    const startedAt = new Date();
    const graded = {
      ...context,
      lane,
      world: { ...context.world, seededPicture: seeded },
      journeyStartedAt: startedAt,
      stepStartedAt: startedAt,
    } satisfies CheckContext;
    const outcome = {
      kind: "seededPictureReplaced",
      label: "replaced",
      promptAvoids: ["forbidden"],
    } as const;
    const kept = await outcomeCheck(
      { ...outcome, promptAvoids: [...outcome.promptAvoids] },
      graded,
    );
    expect(kept.pass).toBe(false);
    expect(kept.actual).toContain("the old picture is still on it");
    expect(kept.actual).not.toContain("other picture");
    const made = await file("made-new.png", "image/png");
    await prisma.socialPost.update({
      where: { id: seeded.postId },
      data: { media: [{ pathname: made.sourceId, kind: "image" }] },
    });
    expect(
      await outcomeCheck(
        { ...outcome, promptAvoids: [...outcome.promptAvoids] },
        graded,
      ),
    ).toMatchObject({ pass: true });
    await prisma.socialPost.deleteMany({
      where: {
        id: { in: [seeded.postId, ...seeded.others.map((o) => o.postId)] },
      },
    });
    await prisma.fileResource.deleteMany({
      where: { workspaceId, displayName: { startsWith: "seeded-" } },
    });
    await prisma.fileResource.deleteMany({
      where: { workspaceId, displayName: "made-new.png" },
    });
    await prisma.sokoBot.deleteMany({ where: { id: bot.id } });
  });

  it("makes one fixture Agent when three repeats seed it at once, and refreshes its listing", async () => {
    const agent = {
      name: `Fixture Agent ${randomUUID().slice(0, 8)}`,
      description: "Does fixture work.",
      credits: 4,
    };
    const blockchainIdentifier = `sokosumi-evals-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const read = () =>
      prisma.agent.findMany({
        where: { blockchainIdentifier },
        select: {
          id: true,
          description: true,
          pricingId: true,
          pricing: {
            select: {
              fixedPricing: {
                select: { id: true, amounts: { select: { amount: true } } },
              },
            },
          },
        },
      });
    await Promise.all([seedAgent(agent), seedAgent(agent), seedAgent(agent)]);
    const [made, ...extra] = await read();
    expect(extra).toEqual([]);
    expect(made?.pricing.fixedPricing?.amounts).toEqual([
      { amount: convertCreditsToCents(4) },
    ]);
    await seedAgent({ ...agent, description: "Does it better.", credits: 6 });
    const [refreshed] = await read();
    expect(refreshed?.description).toBe("Does it better.");
    expect(refreshed?.pricing.fixedPricing?.amounts).toEqual([
      { amount: convertCreditsToCents(6) },
    ]);
    const fixedId = refreshed?.pricing.fixedPricing?.id;
    await prisma.agent.deleteMany({ where: { blockchainIdentifier } });
    await prisma.agentPricing.deleteMany({
      where: { id: refreshed?.pricingId },
    });
    if (fixedId) {
      await prisma.unitValue.deleteMany({
        where: { agentFixedPricingId: fixedId },
      });
      await prisma.agentFixedPricing.deleteMany({ where: { id: fixedId } });
    }
  });

  it("seats the journey's own bot in the teammate room", async () => {
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: { id: organizationId, name: "Room fixture", slug: organizationId },
    });
    const teammates = [randomUUID(), randomUUID()];
    for (const id of teammates)
      await prisma.user.create({
        data: {
          id,
          name: "Teammate",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    const bot = await prisma.sokoBot.create({
      data: { userId, workspaceId },
      select: { id: true },
    });
    const roomId = await seedTeammateRoom(
      {
        ...context.lane,
        organizationId,
        world: {
          ...context.lane.world,
          hannahUserId: teammates[0]!,
          alexUserId: teammates[1]!,
        },
      },
      bot.id,
    );
    const room = await prisma.chatRoom.findUniqueOrThrow({
      where: { id: roomId },
      select: {
        sokoBotMembers: { select: { sokoBotId: true } },
        userMembers: { select: { userId: true } },
      },
    });
    expect(room.sokoBotMembers).toEqual([{ sokoBotId: bot.id }]);
    expect(room.userMembers.map((member) => member.userId).sort()).toEqual(
      [userId, ...teammates].sort(),
    );
    await prisma.chatRoom.deleteMany({ where: { id: roomId } });
    await prisma.sokoBot.deleteMany({ where: { id: bot.id } });
    await prisma.user.deleteMany({ where: { id: { in: teammates } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("reads a file's indexed text from its latest revision only, even while that one is still indexing", async () => {
    const resource = await prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: "DRIVE_UPLOAD",
        sourceScope: "USER",
        sourceId: `users/${userId}/revised.md`,
        displayName: "revised.md",
        normalizedName: "revised.md",
        mimeType: "text/markdown",
        lifecycle: "ACTIVE",
      },
      select: { id: true },
    });
    const scope = await prisma.fileEvidenceScope.create({
      data: {
        workspaceId,
        sourceKind: "DRIVE_UPLOAD",
        sourceScope: "USER",
        sourceId: `users/${userId}/revised.md`,
        actorKinds: ["USER"],
      },
      select: { id: true },
    });
    const version = (revision: number, text?: string) =>
      prisma.fileVersion.create({
        data: {
          resourceId: resource.id,
          revision,
          objectKey: `revised-${revision}`,
          ...(text
            ? {
                chunks: {
                  create: {
                    chunkId: `c${revision}`,
                    ordinal: 0,
                    text,
                    evidenceScopeId: scope.id,
                    scopeVersion: 1,
                    inputDigest: `d${revision}`,
                  },
                },
              }
            : {}),
        },
      });
    await version(1, "Old wording.");
    expect(await indexedTexts([resource.id])).toEqual({
      [resource.id]: "Old wording.",
    });
    await version(2);
    expect(await indexedTexts([resource.id])).toEqual({});
    const check = await outcomeCheck(
      { kind: "file", label: "f", textMatches: ["old wording"] },
      {
        ...context,
        toolCalls: [
          {
            capability: "upload_file",
            status: "SUCCEEDED",
            input: { filename: "revised.md", workspacePath: "out/revised.md" },
            result: { id: resource.id, filename: "revised.md", size: 1 },
          },
        ],
      },
    );
    expect(check.pass).toBe(false);
    await prisma.fileVersion.deleteMany({ where: { resourceId: resource.id } });
    await prisma.fileEvidenceScope.deleteMany({ where: { id: scope.id } });
    await prisma.fileResource.deleteMany({ where: { id: resource.id } });
  });

  describe("a schedule of either kind", () => {
    let botId: string;
    let coworkerId: string;
    const actor = () => ({
      kind: "user" as const,
      userId,
      sokoBotId: botId,
      workspace: { workspaceId, userId, organizationId: null },
    });

    beforeAll(async () => {
      botId = (
        await prisma.sokoBot.create({
          data: { userId, workspaceId },
          select: { id: true },
        })
      ).id;
      const vendor = await prisma.vendor.upsert({
        where: { slug: "journey-checks-fixture" },
        create: { slug: "journey-checks-fixture", name: "Fixture" },
        update: {},
        select: { id: true },
      });
      coworkerId = (
        await prisma.coworker.create({
          data: {
            slug: `fixture-${randomUUID()}`,
            name: "CodePat",
            baseURL: "https://coworker.evals.invalid",
            capabilities: ["tasks"],
            vendorId: vendor.id,
          },
          select: { id: true },
        })
      ).id;
      await prisma.coworkerWorkspaceAccess.create({
        data: { coworkerId, workspaceId, status: "GRANTED" },
      });
    });

    afterAll(async () => {
      await prisma.task.deleteMany({
        where: { workspaceId, assigneeId: coworkerId },
      });
      await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
      await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
      await prisma.coworkerWorkspaceAccess.deleteMany({
        where: { coworkerId },
      });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.sokoBot.deleteMany({ where: { id: botId } });
    });

    const graded = (memo: Record<string, string[]>): CheckContext => ({
      ...context,
      botId,
      world: {
        ...context.world,
        coworkers: { ...context.world.coworkers, CodePat: coworkerId },
      },
      memo,
    });
    const daily = {
      kind: "schedule",
      label: "daily",
      days: [0, 1, 2, 3, 4, 5, 6],
      hour: 9,
      minute: 0,
      timezone: "Europe/Berlin",
      promptMatches: ["fixture"],
      count: 1,
    } as const;

    it("finds the bot's Task Schedule, fires it through the release and hands its Task to the assignee", async () => {
      const schedule = await createTaskSchedule(actor(), {
        name: "Daily fixture review",
        description: "Review the fixture code and write a short note.",
        assigneeId: coworkerId,
        rule: {
          expr: "0 9 * * *",
          timezone: "Europe/Berlin",
          endsMode: "NEVER",
        },
      });
      const memo: Record<string, string[]> = {};
      const remembered = await outcomeCheck(
        {
          ...daily,
          days: [...daily.days],
          promptMatches: [...daily.promptMatches],
          identity: "remember",
        },
        graded(memo),
      );
      expect(remembered).toMatchObject({ pass: true });
      expect(remembered.actual).toContain("Task Schedule");
      // A second, newer schedule: the remembered one still fires.
      const other = await createTaskSchedule(actor(), {
        name: "Another daily note",
        assigneeId: coworkerId,
        rule: {
          expr: "0 8 * * *",
          timezone: "Europe/Berlin",
          endsMode: "NEVER",
        },
      });
      const chosen = scheduleToFire(
        await durableSchedules(botId, workspaceId),
        memo,
      );
      expect(chosen).toMatchObject({ id: schedule.id, kind: "task" });
      expect(await fireTaskSchedule(schedule.id, memo)).toBeNull();
      expect(await claimedRunState(memo, botId)).toBe("started");
      expect(await claimedRunCheck(memo)).toMatchObject({
        label: "The Task Schedule released its Task",
        pass: true,
      });
      const [releasedId] = memo.releasedTask ?? [];
      const released = await prisma.task.findUniqueOrThrow({
        where: { id: releasedId },
        select: { scheduleId: true },
      });
      expect(released.scheduleId).toBe(schedule.id);
      // The later checks read that released Task, and only it.
      expect(
        await outcomeCheck(
          {
            kind: "task",
            label: "brief",
            coworker: "CodePat",
            briefMatches: ["fixture"],
          },
          graded(memo),
        ),
      ).toMatchObject({
        pass: true,
        actual: expect.stringContaining("Daily fixture review"),
      });
      expect(
        await outcomeCheck(
          { kind: "schedule", label: "kept", identity: "unchanged" },
          graded(memo),
        ),
      ).toMatchObject({ pass: true });
      // The Coworker's answer lands on the released Task.
      const answerOn = await answeredTaskId(
        memo,
        coworkerId,
        "CodePat",
        async () => {
          throw new Error("no lookup when a Task was released");
        },
      );
      expect(answerOn).toBe(releasedId);
      // An earlier update on the same Task, before the scripted answer.
      const earlierUpdate = await prisma.taskEvent.create({
        data: {
          taskId: releasedId!,
          coworkerId,
          status: "RUNNING",
          comment: "Starting.",
        },
        select: { id: true },
      });
      const answerEventId = await deliverCoworkerAnswer(
        releasedId!,
        coworkerId,
        {
          kind: "coworker",
          coworker: "CodePat",
          status: "COMPLETED",
          comment: "Here is the note.",
        },
      );
      expect(
        await prisma.taskEvent.findUniqueOrThrow({
          where: { id: answerEventId },
          select: { taskId: true, comment: true },
        }),
      ).toEqual({ taskId: releasedId, comment: "Here is the note." });
      // A wake counts only when it carries exactly that answer's event.
      const since = new Date(Date.now() - 1_000);
      const wake = async (
        entityId: string,
        eventId: string,
        status: "COMPLETED" | "FAILED" = "COMPLETED",
      ) => {
        const turn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            source: "EVENT",
            status,
            clientTurnId: `lab:fixture:${randomUUID()}`,
            userMessage: "A Task changed",
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + 60_000),
          },
          select: { id: true },
        });
        await prisma.sokoBotEventInbox.create({
          data: {
            botId,
            turnId: turn.id,
            eventId,
            entityId,
            purpose: "fixture",
          },
        });
      };
      // The earlier update woke the bot: same Task, other event, no credit.
      await wake(releasedId!, earlierUpdate.id);
      expect(
        await wakeCheck(botId, since, "CodePat", answerEventId),
      ).toMatchObject({ pass: false, actual: "0 wake(s) by that answer" });
      // The answer's wake failed, then its follow-up retry got through: one wake.
      await wake(releasedId!, answerEventId, "FAILED");
      await wake(releasedId!, `${answerEventId}:follow-up-retry`);
      expect(
        await wakeCheck(botId, since, "CodePat", answerEventId),
      ).toMatchObject({
        label: "Woken once by CodePat's answer",
        pass: true,
        actual: "1 wake(s) by that answer, after 1 failed attempt(s)",
      });
      // A second wake by the same answer that also got through is a duplicate.
      await wake(releasedId!, `${answerEventId}:duplicate`);
      expect(
        await wakeCheck(botId, since, "CodePat", answerEventId),
      ).toMatchObject({
        pass: false,
        actual: expect.stringContaining("2 wake(s)"),
      });
      // A released Task that is not the Coworker's is the product's failure.
      expect(
        await answeredTaskId(memo, randomUUID(), "Mira", async () => undefined),
      ).toEqual({
        error: "The released Task is not Mira's (assigned elsewhere)",
      });
      expect(await fireTaskSchedule(randomUUID(), {})).toEqual({
        error: "The Task Schedule has no planned run to release",
      });
      await prisma.sokoBotEventInbox.deleteMany({ where: { botId } });
      await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
      await prisma.taskSchedule.deleteMany({ where: { id: other.id } });
    });

    it("counts a report as delivered only when it was made in the step, not reads, a release or an earlier one", async () => {
      const schedule = await createTaskSchedule(actor(), {
        name: "Weekly fixture report",
        assigneeId: coworkerId,
        rule: {
          expr: "0 8 * * 1",
          timezone: "Europe/Berlin",
          endsMode: "NEVER",
        },
      });
      const memo: Record<string, string[]> = {};
      expect(await fireTaskSchedule(schedule.id, memo)).toBeNull();
      const [releasedId] = memo.releasedTask ?? [];
      // Names only a read of the seeded board yields, all three parts.
      const report =
        "Last week Mira finished Compare EU invoicing tools. Draft the partner FAQ is stuck; Pick the webinar date waits on you.";
      const room = await prisma.chatRoom.create({
        data: {
          name: "Owner's chat",
          slug: `owner-${randomUUID()}`,
          createdByUserId: userId,
          userMembers: { create: { userId, access: "member" } },
        },
        select: { id: true },
      });
      const stepStartedAt = new Date();
      /** A bot turn of the step posting `content` to the owner; `traced`: woken by the released Task. */
      const postToOwner = async (
        content: string,
        traced = true,
        {
          via = "final",
          metadata,
          finalReply,
        }: {
          /** The final reply's delivery, or a post_chat receipt. */
          via?: "final" | "post_chat";
          metadata?: object;
          /** With post_chat: the turn's own short final reply. */
          finalReply?: string;
        } = {},
      ) => {
        const turn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requestedByUserId: userId,
            source: "EVENT",
            status: "COMPLETED",
            clientTurnId: `lab:fixture:${randomUUID()}`,
            userMessage: "A Task changed",
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + 60_000),
          },
          select: { id: true },
        });
        if (traced)
          await prisma.sokoBotEventInbox.create({
            data: {
              botId,
              turnId: turn.id,
              eventId: randomUUID(),
              entityId: releasedId!,
              purpose: "fixture",
            },
          });
        const message = await prisma.chatRoomMessage.create({
          data: {
            roomId: room.id,
            senderSokoBotId: botId,
            content,
            ...(metadata ? { metadata } : {}),
          },
          select: { id: true },
        });
        if (via === "post_chat") {
          await prisma.sokoBotToolCall.create({
            data: {
              turnId: turn.id,
              toolCallId: randomUUID(),
              capability: "post_chat",
              inputHash: randomUUID(),
              status: "COMPLETED",
              targetId: message.id,
            },
          });
          if (finalReply) {
            const final = await prisma.chatRoomMessage.create({
              data: {
                roomId: room.id,
                senderSokoBotId: botId,
                content: finalReply,
              },
              select: { id: true },
            });
            await prisma.sokoBotDelivery.create({
              data: {
                turnId: turn.id,
                roomId: room.id,
                messageId: final.id,
                status: "PERSISTED",
              },
            });
          }
          return;
        }
        await prisma.sokoBotDelivery.create({
          data: {
            turnId: turn.id,
            roomId: room.id,
            messageId: message.id,
            status: "PERSISTED",
          },
        });
      };
      const clearPosts = async () => {
        await prisma.sokoBotToolCall.deleteMany({
          where: { turn: { sokoBotId: botId } },
        });
        await prisma.sokoBotDelivery.deleteMany({ where: { roomId: room.id } });
        await prisma.chatRoomMessage.deleteMany({ where: { roomId: room.id } });
        await prisma.sokoBotEventInbox.deleteMany({ where: { botId } });
        await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
      };
      // The Monday report journey's own delivery outcome.
      const delivered = OWNER_JOURNEYS.find(
        (journey) => journey.id === "owner-weekly-report-schedule",
      )!
        .steps.flatMap((step) => step.outcomes ?? [])
        .find((outcome) => outcome.kind === "delivered")!;
      const step = {
        ...graded(memo),
        stepStartedAt,
        answer: null,
        // The run read the board.
        toolCalls: [
          {
            capability: "list_tasks",
            status: "COMPLETED",
            input: {},
            result: [],
          },
        ],
      };
      // Reads, and the Coworker's result naming every part, but nothing sent.
      await prisma.taskEvent.create({
        data: {
          taskId: releasedId!,
          coworkerId,
          status: "COMPLETED",
          comment: report,
        },
      });
      expect(await outcomeCheck(delivered, step)).toMatchObject({
        pass: false,
        actual: "nothing reached the owner in this step",
      });
      for (const [why, content, traced] of [
        [
          "a promise",
          "I will check the invoicing and webinar tasks and send the report tomorrow",
          true,
        ],
        [
          "no stuck part",
          "Last week Mira finished Compare EU invoicing tools; Pick the webinar date waits on you.",
          true,
        ],
        ["not from this run", report, false],
        [
          "every status wrong",
          "The partner FAQ is finished, invoicing waits on you and the webinar is stuck.",
          true,
        ],
        [
          "one status wrong",
          "Mira finished Compare EU invoicing tools. The partner FAQ is done. Pick the webinar date waits on you.",
          true,
        ],
      ] as const) {
        await postToOwner(content, traced);
        expect(await outcomeCheck(delivered, step), why).toMatchObject({
          pass: false,
        });
        await clearPosts();
      }
      // A saved report the message only names was never shared.
      const savedReport = await prisma.fileResource.create({
        data: {
          workspaceId,
          sourceKind: "DRIVE_UPLOAD",
          sourceScope: "USER",
          sourceId: `users/${userId}/${randomUUID()}/weekly-result.md`,
          displayName: "weekly-result.md",
          normalizedName: "weekly-result.md",
          mimeType: "text/markdown",
          lifecycle: "ACTIVE",
        },
        select: { id: true },
      });
      const withSavedReport = {
        ...step,
        toolCalls: [
          ...step.toolCalls,
          {
            capability: "upload_file",
            status: "COMPLETED",
            input: { filename: "weekly-result.md", content: report },
            result: {
              id: savedReport.id,
              filename: "weekly-result.md",
              size: 1,
            },
          },
        ],
      };
      await postToOwner(
        "I could not attach weekly-result.md. I have nothing to share with you yet.",
      );
      expect(await outcomeCheck(delivered, withSavedReport)).toMatchObject({
        pass: false,
      });
      await clearPosts();
      // The same file as a result card on the message: shared.
      await postToOwner("Here is your weekly report.", true, {
        metadata: {
          result_preview_snapshots: [
            {
              workspaceId,
              reference: { kind: "file", id: savedReport.id },
              data: {
                id: savedReport.id,
                state: "available",
                capturedAt: new Date().toISOString(),
                kind: "file",
                title: "weekly-result.md",
                status: null,
                sourceHref: `/drive/files/${savedReport.id}`,
              },
            },
          ],
        },
      });
      expect(await outcomeCheck(delivered, withSavedReport)).toMatchObject({
        pass: true,
        actual:
          'delivered as a message to the owner linking "weekly-result.md"',
      });
      await clearPosts();
      // post_chat posted the full report; the final reply only says so.
      await postToOwner(report, true, {
        via: "post_chat",
        finalReply: "I posted your report.",
      });
      expect(await outcomeCheck(delivered, step)).toMatchObject({
        pass: true,
        actual: "delivered as a message to the owner",
      });
      await clearPosts();
      // A correct report may also say when it looks again.
      await postToOwner(`${report} I'll check again tomorrow.`);
      expect(await outcomeCheck(delivered, step)).toMatchObject({ pass: true });
      await clearPosts();
      await prisma.fileResource.deleteMany({ where: { id: savedReport.id } });
      // A message sent before the step is an earlier case's, not this run's.
      await postToOwner(report);
      expect(
        await outcomeCheck(delivered, {
          ...step,
          stepStartedAt: new Date(Date.now() + 1_000),
        }),
      ).toMatchObject({ pass: false });
      // The genuine report, sent to the owner by the run.
      expect(await outcomeCheck(delivered, step)).toMatchObject({
        pass: true,
        actual: "delivered as a message to the owner",
      });
      await clearPosts();
      await prisma.chatRoom.deleteMany({ where: { id: room.id } });
      await prisma.taskSchedule.deleteMany({ where: { id: schedule.id } });
    });

    it("still finds and grades the bot's own schedule", async () => {
      await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
      await prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          name: "Fixture reminder",
          timezone: "Europe/Berlin",
          cronExpression: "0 9 * * *",
          prompt: "Remind me to read the fixture note.",
          nextRunAt: new Date(Date.now() + 86_400_000),
        },
      });
      const [found] = await durableSchedules(botId, workspaceId);
      expect(found).toMatchObject({ kind: "bot", enabled: true });
      const check = await outcomeCheck(
        {
          ...daily,
          days: [...daily.days],
          promptMatches: [...daily.promptMatches],
          identity: "remember",
        },
        graded({}),
      );
      expect(check).toMatchObject({ pass: true });
      expect(check.actual).toContain("bot schedule");
      await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
    });

    it("clears an earlier case's bot Task Schedule with its released Task, and keeps a member's with theirs", async () => {
      const made = await createTaskSchedule(actor(), {
        name: "Earlier journey's schedule",
        assigneeId: coworkerId,
        rule: {
          expr: "0 9 * * *",
          timezone: "Europe/Berlin",
          endsMode: "NEVER",
        },
      });
      const members = await createTaskSchedule(
        { ...actor(), sokoBotId: undefined },
        {
          name: "A member's schedule",
          assigneeId: coworkerId,
          rule: {
            expr: "0 10 * * *",
            timezone: "Europe/Berlin",
            endsMode: "NEVER",
          },
        },
      );
      // The earlier case ran both: each released a Task in the workspace.
      const earlier: Record<string, string[]> = {};
      const member: Record<string, string[]> = {};
      expect(await fireTaskSchedule(made.id, earlier)).toBeNull();
      expect(await fireTaskSchedule(members.id, member)).toBeNull();
      // The next case starts: the reset every Cuso and Soko Bot journey runs.
      await clearBotTaskSchedules({ workspaceId });
      expect(
        await prisma.taskSchedule.findMany({
          where: { id: { in: [made.id, members.id] } },
          select: { id: true },
        }),
      ).toEqual([{ id: members.id }]);
      expect(
        await prisma.taskScheduleRun.count({ where: { scheduleId: made.id } }),
      ).toBe(0);
      expect(
        await prisma.task.findMany({
          where: {
            id: {
              in: [earlier.releasedTask?.[0], member.releasedTask?.[0]].filter(
                Boolean,
              ) as string[],
            },
          },
          select: { id: true },
        }),
      ).toEqual([{ id: member.releasedTask?.[0] }]);
      expect(await durableSchedules(botId, workspaceId)).toEqual([]);
    });
  });

  it("counts a file read only when it returned the file's text", async () => {
    const read = (result: unknown) =>
      outcomeCheck(
        { kind: "readSeededFile", label: "read" },
        {
          ...context,
          world: {
            ...context.world,
            seededFileId: "file-1",
            seededFileMarker: "Nightly dreaming",
          },
          toolCalls: [
            {
              capability: "read_file",
              status: "COMPLETED",
              input: { fileId: "file-1" },
              result,
            },
          ],
        },
      );
    expect(
      await read({ text: "", note: "Still being processed; try again." }),
    ).toMatchObject({
      pass: false,
      actual: "1 read(s), none returned the file's text",
    });
    expect(
      (await read({ text: "- Nightly dreaming: the bot tidies its memory." }))
        .pass,
    ).toBe(true);
  });

  it("fails a turn without a context snapshot as no evidence of a fresh start", async () => {
    const botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId },
        select: { id: true },
      })
    ).id;
    const turn = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        workspaceId,
        requestedByUserId: userId,
        source: "CHAT",
        status: "COMPLETED",
        clientTurnId: `lab:fixture:${randomUUID()}`,
        userMessage: "hello",
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    });
    expect(await freshConversationCheck(turn.id, since)).toMatchObject({
      pass: false,
      actual: "no context snapshot",
    });
    await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
  });

  it("passes the draft on its two attached made images, not the old logo", async () => {
    const draft = (min: number) =>
      outcomeCheck(
        {
          kind: "posts",
          label: "draft",
          project: "Padierfind",
          provider: "x",
          min: 1,
          max: 1,
          draftsOnly: true,
          media: { min },
        },
        context,
      );
    expect((await draft(2)).pass).toBe(true);
    expect(await draft(3)).toMatchObject({
      pass: false,
      actual: expect.stringContaining("2 made image(s) attached of 3 media"),
    });
  });
});

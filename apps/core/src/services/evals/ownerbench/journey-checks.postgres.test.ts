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
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { ContextPacketBuilder } from "@/lib/soko-bot/context-packet";
import { searchFiles } from "@/services/file-search.service";
import {
  clearEarlierCaseArtifacts,
  type DeleteBlobs,
  type EvalLaneRecord,
  PENDING_BLOB_PREFIX,
} from "../eval-lanes.service";
import {
  type CheckContext,
  indexedTexts,
  outcomeCheck,
} from "./journey-checks";
import {
  claimedRunCheck,
  claimedRunState,
  earlierCaseFilesCheck,
  earlierCaseTasksCheck,
  foregroundTurnId,
  freshConversationCheck,
  isolationFailed,
  journeyTokens,
  journeyTurns,
  organizerFailures,
  packetTaskIds,
  routingFailures,
  withDescendants,
} from "./journey-runner";
import {
  type JourneyWorld,
  seedAgent,
  seedPicturePosts,
  seedTeammateRoom,
} from "./journey-world";
import { type JourneyOutcome, OWNER_JOURNEYS } from "./journeys";

// Clearing a lane also deletes its uploads' blobs; nothing leaves this test.
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  del: vi.fn(async () => undefined),
}));
const driveDel = vi.hoisted(() =>
  vi.fn<(pathnames: readonly string[]) => Promise<void>>(async () => undefined),
);
vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
  driveDel,
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

  it("finds turns whose context organizer lost its read, background runs included", async () => {
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
    const snapshot = (turnId: string, organizer: unknown) =>
      prisma.sokoBotContextSnapshot.create({
        data: {
          turnId,
          generatedAt: new Date(),
          schemaVersion: 1,
          hash: randomUUID(),
          packet: jsonInput({ workspace: { marketing: { organizer } } }),
          byteSize: 1,
          tokenEstimate: 1,
          counts: {},
          omissions: [],
        },
      });
    const root = await turn();
    const child = await turn(root.id);
    const plain = await turn(root.id);
    await snapshot(root.id, { kind: "chat", jev: { ms: 900, asked: 4 } });
    await snapshot(plain.id, null);
    expect(await organizerFailures([root.id])).toEqual({
      turns: 1,
      failed: 0,
    });
    await snapshot(child.id, {
      kind: "chat",
      jev: { ms: 4000, asked: 4, failed: "TimeoutError" },
    });
    expect(await organizerFailures([root.id])).toEqual({
      turns: 2,
      failed: 1,
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

  it("counts only this journey's work: an earlier run's watch firing mid-step is not the step's", async () => {
    const botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId, versionId: "cmo-v27" },
        select: { id: true },
      })
    ).id;
    const turn = (
      versionId: string,
      kind: string,
      parentTurnId?: string,
      createdAt?: Date,
    ) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "CHAT",
          status: "COMPLETED",
          versionId,
          clientTurnId: `${kind}:${randomUUID()}`,
          userMessage: "fixture",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          ...(parentTurnId ? { parentTurnId } : {}),
          ...(createdAt ? { createdAt } : {}),
        },
        select: { id: true },
      });
    // A previous run (another version) left a watch behind.
    const previousRun = await turn(
      "cmo-v23",
      "chat",
      undefined,
      new Date(Date.now() - 13 * 3_600_000),
    );
    const journeyStartedAt = new Date(Date.now() - 1_000);
    const stepStartedAt = new Date(Date.now() - 500);
    const owner = await turn("cmo-v27", "chat");
    const oldWatch = await turn("cmo-v23", "watch", previousRun.id);
    const oldWatchSameVersion = await turn("cmo-v27", "watch", previousRun.id);
    const ownWatch = await turn("cmo-v27", "watch", owner.id);
    const own = await journeyTurns(botId, stepStartedAt, journeyStartedAt);
    expect(own.map((entry) => entry.id)).toEqual([owner.id, ownWatch.id]);
    expect(own.map((entry) => entry.id)).not.toContain(oldWatch.id);
    expect(own.map((entry) => entry.id)).not.toContain(oldWatchSameVersion.id);
    await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
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

  describe("a case's first context holds no earlier case's work", () => {
    // Its own owner and workspace: clearing a lane tombstones every upload in
    // it, and the other tests' files live in the shared one.
    const userId = randomUUID();
    let workspaceId: string;
    let projectId: string;
    let botId: string;
    const classification = {
      schemaVersion: 1 as const,
      route: "MANAGE_WORK" as const,
      confidence: 0.9,
      rationaleSummary: "The owner asked about the board",
      requestedOutcome: "Answer from the board",
      candidateProjectIds: [],
      candidateCoworkerIds: [],
      candidateAgentIds: [],
      requiresClarification: false,
      requiresApproval: false,
    };

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Isolation owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
      projectId = (
        await prisma.project.create({
          data: { workspaceId, name: "Cuso" },
          select: { id: true },
        })
      ).id;
      botId = (
        await prisma.sokoBot.create({
          data: { userId, workspaceId },
          select: { id: true },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
      await prisma.socialPost.deleteMany({ where: { workspaceId } });
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.sokoBot.deleteMany({ where: { id: botId } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    /** What one case leaves: a Task it delegated, a Task its schedule released, a post. */
    async function runCase(kind: "delegated" | "released"): Promise<string> {
      if (kind === "delegated")
        return (
          await prisma.task.create({
            data: {
              workspaceId,
              name: "Earlier case's delegation",
              creatorSokoBotId: botId,
            },
            select: { id: true },
          })
        ).id;
      const schedule = await prisma.taskSchedule.create({
        data: {
          workspaceId,
          creatorSokoBotId: botId,
          name: "Earlier case's schedule",
          expr: "0 9 * * *",
          timezone: "Europe/Berlin",
          anchorAt: new Date(),
          ruleEffectiveFrom: new Date(),
          epochId: randomUUID(),
        },
        select: { id: true },
      });
      await prisma.socialPost.create({
        data: {
          projectId,
          workspaceId,
          provider: "x",
          text: "Earlier case's draft",
          creatorSokoBotId: botId,
        },
      });
      // A released Task carries the member who owns the schedule, not the bot.
      return (
        await prisma.task.create({
          data: {
            workspaceId,
            name: "Earlier case's released Task",
            creatorUserId: userId,
            scheduleId: schedule.id,
          },
          select: { id: true },
        })
      ).id;
    }

    /** The next case's opening turn, with the packet Core builds for it. */
    async function openingTurn(): Promise<{
      turnId: string;
      taskIds: string[];
    }> {
      const built = await new ContextPacketBuilder().build({
        userId,
        sokoBotId: botId,
        workspaceId,
        source: "CHAT",
        classification,
        sharedScope: null,
      });
      const turn = await prisma.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: `lab:fixture:${randomUUID()}`,
          userMessage: "What is on my board?",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          contextSnapshot: {
            create: {
              generatedAt: new Date(),
              schemaVersion: 1,
              hash: randomUUID(),
              packet: built.packet as object,
              byteSize: built.byteSize,
              tokenEstimate: built.tokenEstimate,
              counts: built.counts,
              omissions: built.omissions,
            },
          },
        },
        select: { id: true },
      });
      return { turnId: turn.id, taskIds: packetTaskIds(built.packet) };
    }

    for (const order of [
      ["delegated", "released"],
      ["released", "delegated"],
    ] as const)
      it(`keeps the first case's Tasks out of the second's opening packet (${order.join(" then ")})`, async () => {
        const seeded = await prisma.task.create({
          data: {
            workspaceId,
            name: "The owner's seeded Task",
            creatorUserId: userId,
          },
          select: { id: true },
        });
        const earlier = await runCase(order[0]);
        // The second case starts: its reset, then its own work.
        await clearEarlierCaseArtifacts({
          workspaceId,
          cusoProjectId: projectId,
        });
        const startedAt = new Date();
        const own = await runCase(order[1]);
        const { turnId, taskIds } = await openingTurn();
        expect(taskIds).not.toContain(earlier);
        // Positive controls: the owner's seeded Task and this case's own work.
        expect(taskIds).toContain(seeded.id);
        expect(taskIds).toContain(own);
        expect(await earlierCaseTasksCheck(turnId, startedAt)).toMatchObject({
          pass: true,
        });
        expect(
          await prisma.socialPost.count({
            where: {
              projectId,
              text: "Earlier case's draft",
              createdAt: { lt: startedAt },
            },
          }),
        ).toBe(0);
        await prisma.task.deleteMany({ where: { workspaceId } });
        await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
        await prisma.socialPost.deleteMany({
          where: { projectId, text: "Earlier case's draft" },
        });
      });

    it("keeps an earlier case's evidence file out of the next case's Files and first reads", async () => {
      const upload = (name: string) =>
        prisma.fileResource.create({
          data: {
            workspaceId,
            sourceKind: "DRIVE_UPLOAD",
            sourceScope: "USER",
            // Each upload its own object; the shown name may repeat.
            sourceId: `drive/users/${userId}/${randomUUID()}/${name}`,
            ownerUserId: userId,
            displayName: name,
            normalizedName: name.toLowerCase(),
            mimeType: "application/pdf",
            lifecycle: "ACTIVE",
          },
          select: { id: true, displayName: true },
        });
      const listing = async () =>
        (
          await searchFiles({
            workspaceId,
            actor: { userId, organizationId: null, kind: "soko_bot" },
            query: null,
            filters: {},
            sortBy: "modified",
            sortOrder: "desc",
            cursor: null,
            limit: 50,
          })
        ).items.map((file) => file.id);
      // Case A's prepare seeded its evidence PDF.
      const evidence = await upload("evidence.pdf");
      expect(await listing()).toContain(evidence.id);
      // Case B starts: the clear, its isolation point, then its own file of
      // the same name.
      await clearEarlierCaseArtifacts({
        workspaceId,
        cusoProjectId: projectId,
      });
      const isolatedAt = new Date();
      const own = await upload("evidence.pdf");
      expect(await listing()).toEqual([own.id]);
      const { turnId } = await openingTurn();
      // Its first read listed Files: its own "evidence.pdf" is fresh.
      const ownRead = [
        {
          capability: "list_files",
          result: { files: [{ id: own.id, name: own.displayName }] },
        },
      ];
      expect(
        await earlierCaseFilesCheck(turnId, isolatedAt, workspaceId, ownRead),
      ).toMatchObject({ pass: true });
      // A read that still returned case A's file, by its id, fails.
      expect(
        await earlierCaseFilesCheck(turnId, isolatedAt, workspaceId, [
          {
            capability: "list_files",
            result: { files: [{ id: evidence.id, name: "evidence.pdf" }] },
          },
        ]),
      ).toMatchObject({
        pass: false,
        actual: expect.stringContaining("evidence.pdf"),
      });
      await prisma.fileResource.deleteMany({
        where: { id: { in: [evidence.id, own.id] } },
      });
    });

    it("retries a blob delete, and keeps a failed one hidden and due for the next reset", async () => {
      const upload = (name: string) =>
        prisma.fileResource.create({
          data: {
            workspaceId,
            sourceKind: "DRIVE_UPLOAD",
            sourceScope: "USER",
            sourceId: `drive/users/${userId}/${randomUUID()}/${name}`,
            ownerUserId: userId,
            displayName: name,
            normalizedName: name.toLowerCase(),
            mimeType: "application/pdf",
            lifecycle: "ACTIVE",
          },
          select: { id: true, sourceId: true, tombstonedAt: true },
        });
      const visible = async (id: string) =>
        (
          await prisma.fileResource.findUniqueOrThrow({
            where: { id },
            select: { tombstonedAt: true },
          })
        ).tombstonedAt === null;
      const pending = () =>
        prisma.syncMetadata.findMany({
          where: {
            key: { startsWith: `${PENDING_BLOB_PREFIX}${workspaceId}:` },
          },
          select: { key: true },
        });
      const lane = { workspaceId, cusoProjectId: projectId };
      // The store fails once, then deletes: the file and its blob are gone.
      const first = await upload("flaky.pdf");
      const flaky = vi.fn<DeleteBlobs>();
      flaky
        .mockRejectedValueOnce(new Error("store down"))
        .mockResolvedValue(undefined);
      expect(await clearEarlierCaseArtifacts(lane, flaky)).toEqual({
        blobsPending: [],
      });
      expect(flaky).toHaveBeenCalledTimes(2);
      expect(await visible(first.id)).toBe(false);
      expect(await pending()).toEqual([]);
      // The store keeps failing: the file is hidden, its blob waits.
      const second = await upload("stuck.pdf");
      const down = vi
        .fn<DeleteBlobs>()
        .mockRejectedValue(new Error("store down"));
      expect(await clearEarlierCaseArtifacts(lane, down)).toEqual({
        blobsPending: [second.sourceId],
      });
      expect(down).toHaveBeenCalledTimes(3);
      expect(await visible(second.id)).toBe(false);
      expect(await pending()).toHaveLength(1);
      // That case, and the next while the store stays down, are unscored.
      const journey = OWNER_JOURNEYS[0]!;
      for (const blobs of [
        [second.sourceId],
        (await clearEarlierCaseArtifacts(lane, down)).blobsPending,
      ])
        expect(isolationFailed(journey, blobs)).toMatchObject({
          kind: "done",
          outcome: {
            status: "ERROR",
            error: expect.stringContaining(
              `The lane was not cleaned: 1 earlier upload blob(s) could not be deleted (${second.sourceId})`,
            ),
          },
        });
      // The next reset deletes that blob: nothing waits, the case scores.
      const back = vi.fn<DeleteBlobs>().mockResolvedValue(undefined);
      expect(await clearEarlierCaseArtifacts(lane, back)).toEqual({
        blobsPending: [],
      });
      expect(back).toHaveBeenCalledWith([second.sourceId]);
      expect(await pending()).toEqual([]);
      // The default deletes through Drive's store routing; a store it can't
      // reach (none configured) keeps the pathname pending, never clears it.
      const third = await upload("routed.pdf");
      driveDel.mockRejectedValue(new Error("Blob storage is not configured"));
      expect(await clearEarlierCaseArtifacts(lane)).toEqual({
        blobsPending: [third.sourceId],
      });
      expect(driveDel).toHaveBeenLastCalledWith([third.sourceId]);
      expect(await pending()).toHaveLength(1);
      driveDel.mockResolvedValue(undefined);
      expect(await clearEarlierCaseArtifacts(lane)).toEqual({
        blobsPending: [],
      });
      expect(driveDel).toHaveBeenLastCalledWith([third.sourceId]);
      expect(await pending()).toEqual([]);
      await prisma.fileResource.deleteMany({
        where: { id: { in: [first.id, second.id, third.id] } },
      });
    }, 20_000);

    it("fails a case whose opening packet carries another case's Task", async () => {
      const leaked = await runCase("delegated");
      const startedAt = new Date();
      const { turnId, taskIds } = await openingTurn();
      expect(taskIds).toContain(leaked);
      expect(await earlierCaseTasksCheck(turnId, startedAt)).toMatchObject({
        pass: false,
        actual: expect.stringContaining("Earlier case's delegation"),
      });
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

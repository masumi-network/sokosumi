/**
 * The owner benchmark's checks against a real PostgreSQL. An in-memory test
 * passed while Prisma rejected a select at run time (an image job has an
 * `asset` relation, not an `assetId` column), so every outcome any journey
 * uses runs here against populated rows, and the image and draft verdicts
 * are asserted on them.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/evals/ownerbench/journey-checks.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "../eval-lanes.service";
import { type CheckContext, outcomeCheck } from "./journey-checks";
import { freshConversationCheck } from "./journey-runner";
import type { JourneyWorld } from "./journey-world";
import { OWNER_JOURNEYS } from "./journeys";

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

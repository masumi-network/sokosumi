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

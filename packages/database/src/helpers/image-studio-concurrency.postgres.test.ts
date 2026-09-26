import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../client.js";
import { Prisma } from "../generated/prisma/client.js";

/**
 * The two concurrency claims the image studio makes, proved against a real
 * PostgreSQL rather than a mocked transaction.
 *
 * Mocked `$transaction` helpers run the callback and return; they cannot show
 * that Postgres actually serializes two writers, which is the whole mechanism
 * the per-project cap and the version counter rely on. An independent review
 * called that out, correctly.
 *
 * Run with IMAGE_STUDIO_TEST_DATABASE_URL pointing at a disposable database
 * that has the repository's migrations applied. Skipped otherwise, so CI stays
 * green without a database.
 */

const databaseUrl = process.env.IMAGE_STUDIO_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("image studio PostgreSQL concurrency", () => {
  const db = createPrismaClient(databaseUrl ?? "");
  afterAll(() => db.$disconnect());

  const suffix = Math.random().toString(36).slice(2, 8);
  const userId = `img-user-${suffix}`;
  let workspaceId = "";
  let projectId = "";

  beforeAll(async () => {
    await db.user.create({
      data: {
        id: userId,
        name: "Image Studio Concurrency",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const workspace = await db.workspace.create({ data: { userId } });
    workspaceId = workspace.id;
    const project = await db.project.create({
      data: { name: `concurrency-${suffix}`, workspaceId },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.projectImageAsset.deleteMany({ where: { projectId } });
      await db.projectImageJob.deleteMany({ where: { projectId } });
      await db.project.deleteMany({ where: { id: projectId } });
    }
    if (workspaceId)
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: userId } });
  });

  /** The reservation step, exactly as the service performs it. */
  async function reserve(limit: number, key: string) {
    return await db.$transaction(
      async (tx) => {
        const inFlight = await tx.projectImageJob.count({
          where: {
            projectId,
            status: { in: ["PENDING", "SUBMITTING", "QUEUED", "RUNNING"] },
          },
        });
        if (inFlight >= limit) return null;
        return await tx.projectImageJob.create({
          data: {
            projectId,
            workspaceId,
            requestedByUserId: userId,
            kind: "GENERATE",
            model: "fal-ai/test",
            prompt: "a cup",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: key,
          },
          select: { id: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  it("lets a burst of reservations create at most the per-project limit", async () => {
    const limit = 3;
    const attempts = 8;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, index) =>
        reserve(limit, `burst-${suffix}-${index}`),
      ),
    );

    const created = await db.projectImageJob.count({ where: { projectId } });

    // Counting and inserting as two statements would let all eight read the
    // same count, all pass, and each buy an image. Serializable is what turns
    // that into "at most three", with the losers aborting.
    expect(created).toBeLessThanOrEqual(limit);
    expect(created).toBeGreaterThan(0);
    const aborted = results.filter((r) => r.status === "rejected").length;
    const refused = results.filter(
      (r) => r.status === "fulfilled" && r.value === null,
    ).length;
    expect(aborted + refused).toBe(attempts - created);

    await db.projectImageJob.deleteMany({ where: { projectId } });
  });

  it("refuses a second job for the same idempotency key", async () => {
    const key = `replay-${suffix}`;
    const first = await db.projectImageJob.create({
      data: {
        projectId,
        workspaceId,
        requestedByUserId: userId,
        kind: "GENERATE",
        model: "fal-ai/test",
        prompt: "a cup",
        settings: {},
        referenceAssetIds: [],
        idempotencyKey: key,
      },
      select: { id: true },
    });

    // The unique index is what makes a replayed HTTP request safe: it cannot
    // become a second paid generation even if the application logic slips.
    await expect(
      db.projectImageJob.create({
        data: {
          projectId,
          workspaceId,
          requestedByUserId: userId,
          kind: "GENERATE",
          model: "fal-ai/test",
          prompt: "a cup",
          settings: {},
          referenceAssetIds: [],
          idempotencyKey: key,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await db.projectImageJob.deleteMany({ where: { id: first.id } });
  });

  it("gives the submission lease to exactly one of many concurrent claimants", async () => {
    const job = await db.projectImageJob.create({
      data: {
        projectId,
        workspaceId,
        requestedByUserId: userId,
        kind: "GENERATE",
        model: "fal-ai/test",
        prompt: "a cup",
        settings: {},
        referenceAssetIds: [],
        idempotencyKey: `lease-${suffix}`,
      },
      select: { id: true },
    });

    const claims = await Promise.all(
      Array.from({ length: 6 }, () =>
        db.projectImageJob.updateMany({
          where: { id: job.id, status: "PENDING", submitAttempts: 0 },
          data: {
            status: "SUBMITTING",
            submitLeaseAt: new Date(),
            submitAttempts: { increment: 1 },
          },
        }),
      ),
    );

    // Exactly one caller may reach the provider for one row. This is the
    // guard against two callers with the same key each buying an image.
    const winners = claims.filter((claim) => claim.count === 1).length;
    expect(winners).toBe(1);

    const after = await db.projectImageJob.findUniqueOrThrow({
      where: { id: job.id },
      select: { submitAttempts: true, status: true },
    });
    expect(after.submitAttempts).toBe(1);
    expect(after.status).toBe("SUBMITTING");

    await db.projectImageJob.deleteMany({ where: { id: job.id } });
  });

  it("refuses two versions taking the same number in one lineage", async () => {
    const jobs = await Promise.all(
      [0, 1].map((index) =>
        db.projectImageJob.create({
          data: {
            projectId,
            workspaceId,
            requestedByUserId: userId,
            kind: "GENERATE",
            model: "fal-ai/test",
            prompt: "a cup",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: `version-${suffix}-${index}`,
          },
          select: { id: true },
        }),
      ),
    );

    const rootId = crypto.randomUUID();
    const base = {
      projectId,
      workspaceId,
      rootId,
      version: 1,
      model: "fal-ai/test",
      prompt: "a cup",
      settings: {},
      contentType: "image/png",
      width: 1024,
      height: 1024,
      bytes: 10,
      checksum: "abc",
    };

    await db.projectImageAsset.create({
      data: { ...base, jobId: jobs[0]!.id, blobPathname: "a" },
    });

    // Two settlements racing inside one lineage must not both become v1. The
    // unique index is the final arbiter behind the serializable read.
    await expect(
      db.projectImageAsset.create({
        data: { ...base, jobId: jobs[1]!.id, blobPathname: "b" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await db.projectImageAsset.deleteMany({ where: { rootId } });
    await db.projectImageJob.deleteMany({
      where: { id: { in: jobs.map((job) => job.id) } },
    });
  });

  it("allows one asset per job only", async () => {
    const job = await db.projectImageJob.create({
      data: {
        projectId,
        workspaceId,
        requestedByUserId: userId,
        kind: "GENERATE",
        model: "fal-ai/test",
        prompt: "a cup",
        settings: {},
        referenceAssetIds: [],
        idempotencyKey: `settle-${suffix}`,
      },
      select: { id: true },
    });
    const rootId = crypto.randomUUID();
    const base = {
      projectId,
      workspaceId,
      jobId: job.id,
      rootId,
      model: "fal-ai/test",
      prompt: "a cup",
      settings: {},
      contentType: "image/png",
      width: 1024,
      height: 1024,
      bytes: 10,
      checksum: "abc",
    };

    await db.projectImageAsset.create({
      data: { ...base, version: 1, blobPathname: "a" },
    });

    // A webhook and a poll settling the same job at once produce one version.
    await expect(
      db.projectImageAsset.create({
        data: {
          ...base,
          version: 2,
          rootId: crypto.randomUUID(),
          blobPathname: "b",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await db.projectImageAsset.deleteMany({ where: { jobId: job.id } });
    await db.projectImageJob.deleteMany({ where: { id: job.id } });
  });
});

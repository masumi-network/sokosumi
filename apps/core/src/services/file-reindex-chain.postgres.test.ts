import { randomUUID } from "node:crypto";

import {
  FileIndexJobPipeline,
  FileIndexJobState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { headMock } = vi.hoisted(() => ({ headMock: vi.fn() }));

vi.mock("@vercel/blob", () => ({ head: headMock }));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), BLOB_READ_WRITE_TOKEN: "test-token" }),
  };
});

import prisma from "@/lib/db/prisma";
import { requeueFileIndexJob } from "@/lib/files/index-jobs";
import { runExtractionJob } from "@/services/file-index.service";

/**
 * The second half of a retry, driven through the real extraction job.
 *
 * `requeueFileIndexJob` gives EXTRACT a new generation, but the chained
 * SUGGEST enqueue inside `runExtractionJob` passed no generation of its
 * own and so asked for generation 1 — the key the original SUGGEST
 * already holds at SUCCEEDED. The upsert matched it, changed nothing,
 * and the document would have been re-extracted and never re-labelled,
 * which is most of what "the labels came out wrong" means.
 *
 * This has to go through `runExtractionJob` rather than simulating the
 * enqueue: a test that calls `enqueueFileIndexJob` with the generation
 * itself asserts its own arithmetic, and stays green when the service
 * stops propagating. That gap was found by mutating the service and
 * watching nothing fail.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let workspaceId = "";
let ownerId = "";

const TEXT = "Quarterly commuting report for the finance committee.";

async function extractedResource() {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${ownerId}/${randomUUID()}.txt`,
      ownerUserId: ownerId,
      displayName: "chain.txt",
      normalizedName: "chain.txt",
      mimeType: "text/plain",
      sizeBytes: TEXT.length,
      lifecycle: FileResourceLifecycle.ACTIVE,
      contentRevision: 1,
      versions: {
        create: {
          revision: 1,
          objectKey: `drive/users/${ownerId}/chain-${randomUUID()}.txt`,
          mimeType: "text/plain",
          sizeBytes: TEXT.length,
        },
      },
    },
    select: { id: true, contentRevision: true },
  });

  // Both halves already done, which is the state reindex is offered from.
  const { enqueueFileIndexJob } = await import("@/lib/files/index-jobs");
  for (const pipeline of [
    FileIndexJobPipeline.EXTRACT,
    FileIndexJobPipeline.SUGGEST,
  ]) {
    const jobId = await enqueueFileIndexJob({
      resourceId: resource.id,
      pipeline,
      contentRevision: 1,
    });
    await prisma.fileIndexJob.update({
      where: { id: jobId },
      data: { state: FileIndexJobState.SUCCEEDED },
    });
  }
  return resource;
}

/**
 * Lease this resource's EXTRACT job specifically.
 *
 * `leaseNextFileIndexJob` takes the oldest runnable job in the whole
 * database, and every `*.postgres.test.ts` shares one — so calling it
 * here returns whichever job another suite left queued. Racing for it in
 * a loop was the first attempt and it lost, deterministically enough to
 * fail every run.
 *
 * This performs the same claim the real function performs, scoped to one
 * row: the state transition, the attempt and fence increments, and the
 * lease owner. What is under test is what `runExtractionJob` does once
 * it holds a lease, not how the lease was acquired.
 */
async function leaseFor(resourceId: string) {
  const candidate = await prisma.fileIndexJob.findFirst({
    where: {
      resourceId,
      pipeline: FileIndexJobPipeline.EXTRACT,
      state: FileIndexJobState.QUEUED,
    },
    orderBy: { desiredGeneration: "desc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const leaseOwner = randomUUID();
  await prisma.fileIndexJob.update({
    where: { id: candidate.id },
    data: {
      state: FileIndexJobState.LEASED,
      attempt: { increment: 1 },
      fence: { increment: 1 },
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });

  const job = await prisma.fileIndexJob.findUnique({
    where: { id: candidate.id },
  });
  return job ? { job, leaseOwner } : null;
}

async function suggestGenerations(resourceId: string) {
  const rows = await prisma.fileIndexJob.findMany({
    where: { resourceId, pipeline: FileIndexJobPipeline.SUGGEST },
    select: { desiredGeneration: true },
    orderBy: { desiredGeneration: "asc" },
  });
  return rows.map((row) => row.desiredGeneration);
}

describe.skipIf(!enabled)("a retry re-labels, not just re-extracts", () => {
  /**
   * Leave nothing runnable behind.
   *
   * `leaseNextFileIndexJob` takes the oldest runnable job in the whole
   * database, and every `*.postgres.test.ts` shares one. These tests
   * deliberately create QUEUED jobs for resources with no chunks, so a
   * suite running beside this one leased them and reported `no-text`
   * about its own document. That is what happened: the full run went red
   * in `file-suggestions.postgres.test.ts` while every file passed alone.
   *
   * Assertions have all run by this point, so removing the rows costs
   * this file nothing and stops it breaking its neighbours.
   */
  afterEach(async () => {
    await prisma.fileIndexJob.deleteMany({
      where: { resource: { workspaceId } },
    });
  });
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Chain owner",
        email: `chain-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ownerId = owner.id;
    workspaceId = (
      await prisma.workspace.create({
        data: { userId: ownerId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(() => {
    headMock.mockReset().mockResolvedValue({
      url: "https://blob.example/chain.txt",
      size: TEXT.length,
    });
    // A fresh Response per call. `mockResolvedValue` hands back the same
    // object every time, and a Response body can only be read once — so
    // the second extraction in a test got an already-consumed body and
    // failed, which looked exactly like the propagation being broken.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(new TextEncoder().encode(TEXT)),
    );
  });

  it("queues a suggestion at the retry's generation", async () => {
    const resource = await extractedResource();

    const requeued = await requeueFileIndexJob({
      resourceId: resource.id,
      pipeline: FileIndexJobPipeline.EXTRACT,
      contentRevision: resource.contentRevision,
    });
    expect(requeued.generation).toBe(2);

    const leased = await leaseFor(resource.id);
    expect(leased).not.toBeNull();
    if (!leased) return;

    const outcome = await runExtractionJob(leased);
    expect(outcome.chunkCount).toBeGreaterThan(0);

    // Generation 1 is the original, succeeded. Generation 2 is the one
    // the retry created, and before the fix it never existed.
    expect(await suggestGenerations(resource.id)).toEqual([1, 2]);
  }, 60_000);

  it("reaches generation 3 on a second retry, on both halves", async () => {
    /**
     * Asked for explicitly and not previously tested by anyone.
     * `requeueFileIndexJob` derives the next generation from the highest
     * existing EXTRACT row, and the service carries `desiredGeneration`
     * across, so a second press should land on 3 in both pipelines.
     */
    const resource = await extractedResource();

    for (const expected of [2, 3]) {
      const requeued = await requeueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });
      expect(requeued.generation).toBe(expected);

      const leased = await leaseFor(resource.id);
      expect(leased).not.toBeNull();
      if (!leased) return;
      expect(leased.job.desiredGeneration).toBe(expected);

      const ran = await runExtractionJob(leased);
      // Each press must actually extract, or the generations below would
      // line up for the wrong reason.
      expect(ran.chunkCount).toBeGreaterThan(0);
    }

    expect(await suggestGenerations(resource.id)).toEqual([1, 2, 3]);

    const extract = await prisma.fileIndexJob.findMany({
      where: {
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
      },
      select: { desiredGeneration: true },
      orderBy: { desiredGeneration: "asc" },
    });
    expect(extract.map((row) => row.desiredGeneration)).toEqual([1, 2, 3]);
  }, 120_000);
});

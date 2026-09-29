import { randomUUID } from "node:crypto";

import {
  FileIndexJobPipeline,
  FileIndexJobState,
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import {
  backfillMissingSuggestionJobs,
  enqueueFileIndexJob,
  FILE_SUGGEST_BACKFILL_MAX_GENERATION,
} from "@/lib/files/index-jobs";

/**
 * Does anything ever look at a document again?
 *
 * Every workspace was seeded with the curated vocabulary by migration, and the
 * migration reached no file that already existed. A SUGGEST job that ran before
 * the seed counted the workspace's labels, found none, wrote nothing and
 * SUCCEEDED — and nothing re-leases a SUCCEEDED job. Measured against
 * production the day the vocabulary landed: nine extracted documents, two
 * SUGGEST jobs, both SUCCEEDED with zero labels four hours before the
 * vocabulary existed, and zero `file_label` rows in the entire database.
 *
 * So the sweep, and these are the four conditions that make it safe to run
 * every minute. Only a real database shows any of it: the predicate is a set of
 * `NOT EXISTS` clauses over four tables, which is exactly what disappears when
 * Prisma is mocked.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";
let labelId = "";

/** One extracted document, ready for a suggestion run. */
async function createResource(input: {
  name: string;
  extractionState: "INDEXED" | "PARTIAL" | "UNSUPPORTED";
}): Promise<string> {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${ownerId}/${input.name}`,
      ownerUserId: ownerId,
      displayName: input.name,
      normalizedName: input.name,
      mimeType: "text/plain",
      lifecycle: FileResourceLifecycle.ACTIVE,
      versions: {
        create: {
          revision: 1,
          objectKey: `drive/users/${ownerId}/${input.name}`,
          mimeType: "text/plain",
          extractionState: input.extractionState,
          extractionCoverage: input.extractionState === "INDEXED" ? 1 : 0.5,
        },
      },
    },
    select: { id: true },
  });
  return resource.id;
}

/** The state production was left in: succeeded, and nothing written. */
async function succeededSuggestJob(
  resourceId: string,
  generation: number,
): Promise<string> {
  const jobId = await enqueueFileIndexJob({
    resourceId,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision: 1,
    desiredGeneration: generation,
  });
  await prisma.fileIndexJob.update({
    where: { id: jobId },
    data: { state: FileIndexJobState.SUCCEEDED, completedAt: new Date() },
  });
  return jobId;
}

async function suggestJobsFor(resourceId: string) {
  return prisma.fileIndexJob.findMany({
    where: { resourceId, pipeline: FileIndexJobPipeline.SUGGEST },
    orderBy: { desiredGeneration: "asc" },
    select: { state: true, desiredGeneration: true },
  });
}

/**
 * How many of this suite's own documents the sweep has queued work for.
 *
 * The sweep is workspace-agnostic on purpose — every workspace was seeded, so
 * every workspace has documents to reach — and the Postgres suites share one
 * database and run serially. So its return value counts other suites' fixtures
 * too, and asserting on that number measures the run order rather than the
 * sweep. These assertions are scoped to this workspace instead.
 */
async function queuedHere(): Promise<number> {
  return prisma.fileIndexJob.count({
    where: {
      pipeline: FileIndexJobPipeline.SUGGEST,
      state: FileIndexJobState.QUEUED,
      resource: { workspaceId },
    },
  });
}

describe.skipIf(!enabled)("the suggestion backfill sweep", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Backfill owner",
        email: `sweep-owner-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ownerId = owner.id;

    const workspace = await prisma.workspace.create({
      data: { userId: ownerId },
      select: { id: true },
    });
    workspaceId = workspace.id;

    const scope = await ensureEvidenceScope({
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: ownerId,
    });
    scopeId = scope.id;

    const label = await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.TAG,
        displayName: "Finance",
        normalizedName: `finance-${suffix}`,
        description: "Money",
      },
      select: { id: true },
    });
    labelId = label.id;
  });

  /**
   * Every SUGGEST job that existed before this test ran.
   *
   * The sweep is workspace-agnostic, the Postgres suites share one database and
   * run serially, and `leaseNextFileIndexJob` hands back the globally oldest
   * runnable job. So a sweep here queues work for other suites' fixtures, and
   * the next file to run leases a job that is not its own — which shows up as a
   * failure in whichever suite lost the race rather than as anything about this
   * one. Measured: three failures in `jev-failure-loses-labels` from exactly
   * this.
   *
   * So this suite puts back every job it caused anywhere but here.
   */
  let jobsBefore = new Set<string>();

  beforeEach(async () => {
    const existing = await prisma.fileIndexJob.findMany({
      where: { pipeline: FileIndexJobPipeline.SUGGEST },
      select: { id: true },
    });
    jobsBefore = new Set(existing.map((job) => job.id));
  });

  afterEach(async () => {
    const after = await prisma.fileIndexJob.findMany({
      where: { pipeline: FileIndexJobPipeline.SUGGEST },
      select: { id: true, resource: { select: { workspaceId: true } } },
    });
    const strays = after
      .filter(
        (job) =>
          !jobsBefore.has(job.id) && job.resource.workspaceId !== workspaceId,
      )
      .map((job) => job.id);
    if (strays.length > 0) {
      await prisma.fileIndexJob.deleteMany({ where: { id: { in: strays } } });
    }

    await prisma.fileLabel.deleteMany({ where: { resource: { workspaceId } } });
    await prisma.fileIndexJob.deleteMany({
      where: { resource: { workspaceId } },
    });
    await prisma.fileResource.deleteMany({ where: { workspaceId } });
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
    await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("requeues the document the seed migration could not reach", async () => {
    const resourceId = await createResource({
      name: "brief.txt",
      extractionState: "INDEXED",
    });
    await succeededSuggestJob(resourceId, 1);

    await backfillMissingSuggestionJobs();

    const jobs = await suggestJobsFor(resourceId);
    expect(jobs).toHaveLength(2);
    // A new identity, not a new attempt at the settled one: `desiredGeneration`
    // is part of the dedupe key, so this is the only shape that can be leased.
    expect(jobs[1]).toMatchObject({
      state: FileIndexJobState.QUEUED,
      desiredGeneration: 2,
    });
  });

  it("stops after its extra turns, so a silent document is not paid for twice", async () => {
    const resourceId = await createResource({
      name: "quiet.txt",
      extractionState: "INDEXED",
    });
    await succeededSuggestJob(resourceId, 1);

    // Generation 2 is the sweep that followed the first vocabulary, generation
    // 3 the one that followed the widened vocabulary. Then it stops.
    for (const generation of [2, 3]) {
      await backfillMissingSuggestionJobs();
      expect(await suggestJobsFor(resourceId)).toHaveLength(generation);
      // The document the model correctly had nothing to say about looks
      // exactly like an unevaluated one. Without the generation ceiling this
      // would be a paid evaluation every minute, forever.
      await prisma.fileIndexJob.updateMany({
        where: { resourceId, desiredGeneration: generation },
        data: { state: FileIndexJobState.SUCCEEDED, completedAt: new Date() },
      });
    }

    await backfillMissingSuggestionJobs();
    await backfillMissingSuggestionJobs();
    expect(await suggestJobsFor(resourceId)).toHaveLength(3);
    expect(FILE_SUGGEST_BACKFILL_MAX_GENERATION).toBe(3);
  });

  it("leaves a document that already has a label alone", async () => {
    const resourceId = await createResource({
      name: "labelled.txt",
      extractionState: "INDEXED",
    });
    await succeededSuggestJob(resourceId, 1);
    await prisma.fileLabel.create({
      data: {
        resourceId,
        labelId,
        evidenceScopeId: scopeId,
        state: FileMetadataState.SUGGESTED,
        provenance: FileMetadataProvenance.MODEL,
        contentRevision: 1,
        vocabularyVersion: 1,
      },
    });

    await backfillMissingSuggestionJobs();
    expect(await suggestJobsFor(resourceId)).toHaveLength(1);
  });

  it("leaves a document with no readable text alone", async () => {
    // Five of ten production rows are UNSUPPORTED — mp4, svg, zip. There is
    // nothing for the model to have an opinion about, and asking anyway is the
    // whole per-document cost of this sweep spent on nothing.
    const resourceId = await createResource({
      name: "clip.mp4",
      extractionState: "UNSUPPORTED",
    });

    await backfillMissingSuggestionJobs();
    expect(await suggestJobsFor(resourceId)).toHaveLength(0);
  });

  it("does not duplicate work that is already queued", async () => {
    const resourceId = await createResource({
      name: "pending.txt",
      extractionState: "INDEXED",
    });
    await enqueueFileIndexJob({
      resourceId,
      pipeline: FileIndexJobPipeline.SUGGEST,
      contentRevision: 1,
      desiredGeneration: 1,
    });

    await backfillMissingSuggestionJobs();
    expect(await suggestJobsFor(resourceId)).toHaveLength(1);
  });

  it("does nothing in a workspace with no vocabulary", async () => {
    /**
     * The state every workspace started in, and the reason the two production
     * jobs wrote nothing. Sweeping here would reproduce the defect it exists to
     * fix: a job that completes with zero labels and consumes its one turn.
     */
    const bareOwner = await prisma.user.create({
      data: {
        name: "Bare owner",
        email: `sweep-bare-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const bare = await prisma.workspace.create({
      data: { userId: bareOwner.id },
      select: { id: true },
    });
    const resource = await prisma.fileResource.create({
      data: {
        workspaceId: bare.id,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: `drive/users/${bareOwner.id}/orphan.txt`,
        ownerUserId: bareOwner.id,
        displayName: "orphan.txt",
        normalizedName: "orphan.txt",
        mimeType: "text/plain",
        lifecycle: FileResourceLifecycle.ACTIVE,
        versions: {
          create: {
            revision: 1,
            objectKey: `drive/users/${bareOwner.id}/orphan.txt`,
            mimeType: "text/plain",
            extractionState: "INDEXED",
            extractionCoverage: 1,
          },
        },
      },
      select: { id: true },
    });

    try {
      await backfillMissingSuggestionJobs();
      expect(await suggestJobsFor(resource.id)).toHaveLength(0);
    } finally {
      await prisma.fileIndexJob.deleteMany({
        where: { resource: { workspaceId: bare.id } },
      });
      await prisma.fileResource.deleteMany({ where: { workspaceId: bare.id } });
      await prisma.fileEvidenceScope.deleteMany({
        where: { workspaceId: bare.id },
      });
      await prisma.workspace.deleteMany({ where: { id: bare.id } });
      await prisma.user.deleteMany({ where: { id: bareOwner.id } });
    }
  });

  it("stays within its per-tick cap", async () => {
    for (let index = 0; index < 4; index += 1) {
      const resourceId = await createResource({
        name: `bulk-${index}.txt`,
        extractionState: "INDEXED",
      });
      await succeededSuggestJob(resourceId, 1);
    }

    // A backlog costs one paid evaluation per document, spread over ticks,
    // rather than the whole corpus in one minute.
    const first = await backfillMissingSuggestionJobs({ limit: 2 });
    expect(first).toBeLessThanOrEqual(2);
    expect(await queuedHere()).toBeLessThanOrEqual(2);

    // And it does finish: repeated ticks reach all four rather than stalling.
    for (let tick = 0; tick < 4; tick += 1) {
      await backfillMissingSuggestionJobs({ limit: 2 });
    }
    expect(await queuedHere()).toBe(4);
  });
});

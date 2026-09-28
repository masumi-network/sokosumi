import { randomUUID } from "node:crypto";

import {
  FileIndexJobPipeline,
  FileIndexJobState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import {
  enqueueFileIndexJob,
  requeueFileIndexJob,
} from "@/lib/files/index-jobs";

/**
 * Is this job runnable, by the same test `leaseNextFileIndexJob` applies?
 *
 * Asserted on the row rather than by leasing. `leaseNextFileIndexJob`
 * takes the oldest runnable job in the whole database, and this suite
 * shares one with every other `*.postgres.test.ts` — so leasing here
 * returns whichever job some other file happened to leave queued, and
 * the assertion fails for a reason that has nothing to do with the code
 * under test. It did, twice, before this was written this way.
 *
 * The defect is precisely that no runnable row existed at all, which is
 * what this checks.
 */
async function runnableJob(resourceId: string, pipeline: FileIndexJobPipeline) {
  return prisma.fileIndexJob.findFirst({
    where: {
      resourceId,
      pipeline,
      state: FileIndexJobState.QUEUED,
      runAfter: { lte: new Date() },
    },
    select: { desiredGeneration: true, state: true },
  });
}

/**
 * Reindex was a no-op for the one document it exists to rescue.
 *
 * `POST /v1/drive/resources/{id}/reindex` describes itself as queueing
 * re-extraction, and the dismissal copy offers it as the recovery path
 * for a document whose labels came out wrong. That document has
 * EXTRACT=SUCCEEDED and SUGGEST=SUCCEEDED.
 *
 * The route's own sequence, walked against a real database:
 *
 *     before: EXTRACT=SUCCEEDED(g1) SUGGEST=SUCCEEDED(g1)
 *     after:  EXTRACT=SUCCEEDED(g1) SUGGEST=SUCCEEDED(g1)
 *     rows:   2 -> 2
 *     lease:  EXTRACT=NO SUGGEST=NO
 *
 * and a 200 saying `{ queued: true }`.
 *
 * `enqueueFileIndexJob`'s dedupe key is built from the resource,
 * pipeline, content revision, scope version and generation. The route
 * passed none of the last two, so it computed the key the original job
 * already had; the upsert matched it, `update: {}` changed nothing, and
 * the requeue branch covers only FAILED and CANCELLED.
 *
 * These cannot be written against the mocked route tests, which stub
 * `@/lib/files/index-jobs` and so never create a prior job — they assert
 * wiring, and the bug is in what the real function does with a row that
 * is already there.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let workspaceId = "";
let ownerId = "";

async function settledResource() {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${ownerId}/${randomUUID()}.txt`,
      ownerUserId: ownerId,
      displayName: "settled.txt",
      normalizedName: "settled.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      lifecycle: FileResourceLifecycle.ACTIVE,
      contentRevision: 1,
    },
    select: { id: true, contentRevision: true },
  });

  // Extracted and labelled: the state the recovery path is offered from.
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

describe.skipIf(!enabled)(
  "reindexing a document that already succeeded",
  () => {
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
          name: "Reindex owner",
          email: `reindex-${suffix}@example.test`,
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

    it("makes extraction runnable again", async () => {
      const resource = await settledResource();

      const outcome = await requeueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });

      expect(outcome.queued).toBe(true);
      // A new identity, not a new attempt at the settled one.
      expect(outcome.generation).toBe(2);

      // Before the fix there was no runnable EXTRACT row at all: the
      // upsert matched the settled one and changed nothing.
      expect(
        await runnableJob(resource.id, FileIndexJobPipeline.EXTRACT),
      ).toEqual({ state: FileIndexJobState.QUEUED, desiredGeneration: 2 });
    });

    it("leaves the settled job alone rather than reopening it", async () => {
      // The old row is history. Reusing it would lose the record that the
      // first attempt succeeded, and is what a same-identity retry would
      // have done had the requeue branch covered SUCCEEDED.
      const resource = await settledResource();

      await requeueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });

      const extract = await prisma.fileIndexJob.findMany({
        where: {
          resourceId: resource.id,
          pipeline: FileIndexJobPipeline.EXTRACT,
        },
        select: { state: true, desiredGeneration: true },
        orderBy: { desiredGeneration: "asc" },
      });

      expect(extract).toHaveLength(2);
      expect(extract[0]).toEqual({
        state: FileIndexJobState.SUCCEEDED,
        desiredGeneration: 1,
      });
      expect(extract[1]).toEqual({
        state: FileIndexJobState.QUEUED,
        desiredGeneration: 2,
      });
    });

    it("lets the chained suggestion run again at the new generation", async () => {
      /**
       * The half that would still have been dead. `runExtractionJob`
       * enqueues SUGGEST with the extraction job's content revision and,
       * before this, no generation — so it asked for generation 1, the key
       * the original SUGGEST holds at SUCCEEDED. The document would be
       * re-extracted and never re-labelled, which is most of what "the
       * labels came out wrong" means.
       */
      const resource = await settledResource();

      const extract = await requeueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });

      // What the extraction job does when it finishes with chunks.
      await enqueueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.SUGGEST,
        contentRevision: resource.contentRevision,
        desiredGeneration: extract.generation,
      });

      expect(
        await runnableJob(resource.id, FileIndexJobPipeline.SUGGEST),
      ).toEqual({ state: FileIndexJobState.QUEUED, desiredGeneration: 2 });
    });

    it("does not queue a second attempt while one is pending", async () => {
      /**
       * Pressing the button twice must not buy two evaluations. The second
       * call reports `already-pending` rather than claiming it queued
       * something, which is the distinction the route's response now
       * carries.
       */
      const resource = await settledResource();

      const first = await requeueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });
      const second = await requeueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });

      expect(first.queued).toBe(true);
      expect(second.queued).toBe(false);
      expect(second.jobId).toBe(first.jobId);

      const rows = await prisma.fileIndexJob.count({
        where: {
          resourceId: resource.id,
          pipeline: FileIndexJobPipeline.EXTRACT,
        },
      });
      expect(rows).toBe(2);
    });

    it("does not reopen a succeeded job for an ordinary enqueue", async () => {
      /**
       * The condition on the fix, and the one direction here that can cost
       * real money.
       *
       * Upload and the cron enqueue through `enqueueFileIndexJob` too. If
       * that function requeued SUCCEEDED for everyone, every ordinary
       * enqueue against settled work would re-run it — provider spend
       * nobody asked for. The new identity is minted only by
       * `requeueFileIndexJob`, on the side where a person pressed a
       * button.
       */
      const resource = await settledResource();

      await enqueueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      });

      const rows = await prisma.fileIndexJob.findMany({
        where: {
          resourceId: resource.id,
          pipeline: FileIndexJobPipeline.EXTRACT,
        },
        select: { state: true, desiredGeneration: true },
      });

      // Untouched: one row, still succeeded, nothing runnable.
      expect(rows).toEqual([
        { state: FileIndexJobState.SUCCEEDED, desiredGeneration: 1 },
      ]);
      expect(
        await runnableJob(resource.id, FileIndexJobPipeline.EXTRACT),
      ).toBeNull();
    });

    it("still requeues a failed job without minting a generation", async () => {
      // The existing path has to keep working: a FAILED job is a new
      // attempt at the same identity, not a new identity.
      const resource = await settledResource();
      const failed = await prisma.fileIndexJob.findFirst({
        where: {
          resourceId: resource.id,
          pipeline: FileIndexJobPipeline.SUGGEST,
        },
        select: { id: true },
      });
      await prisma.fileIndexJob.update({
        where: { id: failed?.id ?? "" },
        data: { state: FileIndexJobState.FAILED },
      });

      await enqueueFileIndexJob({
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.SUGGEST,
        contentRevision: resource.contentRevision,
      });

      const rows = await prisma.fileIndexJob.findMany({
        where: {
          resourceId: resource.id,
          pipeline: FileIndexJobPipeline.SUGGEST,
        },
        select: { state: true, desiredGeneration: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        state: FileIndexJobState.QUEUED,
        desiredGeneration: 1,
      });
    });
  },
);

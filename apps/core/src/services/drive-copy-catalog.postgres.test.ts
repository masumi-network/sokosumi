import { randomUUID } from "node:crypto";

import { FileIndexJobPipeline, FileLabelKind } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import {
  backfillMissingSuggestionJobs,
  enqueueFileIndexJob,
  FILE_SUGGEST_BACKFILL_MAX_GENERATION,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import {
  activateDriveUploadResource,
  adoptDriveUploadResource,
  driveCopyHolder,
  reserveDriveCopyResource,
} from "@/services/file-catalog.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

/**
 * A Drive copy against the real catalog and job queue.
 *
 * The route test models these with mocks. This one follows a copy through
 * what happens after the request: the backfill adopting its bytes, the
 * SUGGEST job extraction enqueues, and the missing-suggestion sweep, and
 * checks no step ever asks the paid label model.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";

function key(name: string) {
  return {
    workspaceId,
    scope: "user" as const,
    ownerId,
    pathname: `drive/users/${ownerId}/${name}`,
  };
}

/** A label model that counts how often it is asked and declines. */
const evaluator = {
  calls: 0,
  async evaluateLabels() {
    evaluator.calls += 1;
    return {
      ok: true,
      chosen: [],
      reason: null,
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: "0.0001",
      generationId: "gen-test",
    };
  },
};

describe.skipIf(!enabled)("a Drive copy in the catalog", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Copy owner",
        email: `copy-owner-${suffix}@example.test`,
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
    // A vocabulary exists, so an unpinned document would be sent to the model.
    await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.TAG,
        displayName: "Briefs",
        normalizedName: "briefs",
      },
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.fileResource.deleteMany({ where: { workspaceId } });
    await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
    await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("owns the name before the bytes, and refuses a second reservation", async () => {
    const copy = key("weekly (copy).md");
    expect(await driveCopyHolder(copy)).toBe("free");

    await reserveDriveCopyResource({
      key: copy,
      displayName: "weekly (copy).md",
      mimeType: "text/markdown",
      sizeBytes: 42,
      decidedByUserId: ownerId,
    });

    expect(await driveCopyHolder(copy)).toBe("unfinished-copy");
    await expect(
      reserveDriveCopyResource({
        key: copy,
        displayName: "weekly (copy).md",
        mimeType: "text/markdown",
        sizeBytes: 42,
        decidedByUserId: ownerId,
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps one identity when the backfill adopts the bytes first", async () => {
    const copy = key("plan (copy).md");
    const reserved = await reserveDriveCopyResource({
      key: copy,
      displayName: "plan (copy).md",
      mimeType: "text/markdown",
      sizeBytes: 7,
      decidedByUserId: ownerId,
    });

    const adopted = await adoptDriveUploadResource({
      key: copy,
      displayName: "plan (copy).md",
      mimeType: "text/markdown",
      sizeBytes: 7,
      uploadedAt: new Date(),
    });
    const activated = await activateDriveUploadResource({
      key: copy,
      sizeBytes: 7,
      mimeType: "text/markdown",
    });

    expect(adopted).toBe(reserved);
    expect(activated?.resourceId).toBe(reserved);
    expect(await driveCopyHolder(copy)).toBe("taken");
    const extractJobs = await prisma.fileIndexJob.count({
      where: { resourceId: reserved, pipeline: FileIndexJobPipeline.EXTRACT },
    });
    expect(extractJobs).toBe(1);
  });

  it("never asks the label model, through enqueue and the sweep", async () => {
    const copy = key("notes (copy).txt");
    const resourceId = await reserveDriveCopyResource({
      key: copy,
      displayName: "notes (copy).txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      decidedByUserId: ownerId,
    });
    await activateDriveUploadResource({
      key: copy,
      sizeBytes: 5,
      mimeType: "text/plain",
    });
    // What extraction does when it finishes: settle the text, queue SUGGEST.
    await prisma.fileVersion.updateMany({
      where: { resourceId },
      data: { extractionState: "UNSUPPORTED" },
    });
    await prisma.fileIndexJob.updateMany({
      where: { resourceId, pipeline: FileIndexJobPipeline.EXTRACT },
      data: { state: "SUCCEEDED" },
    });
    await enqueueFileIndexJob({
      resourceId,
      pipeline: FileIndexJobPipeline.SUGGEST,
      contentRevision: 1,
      runAfter: new Date(Date.now() - 1_000),
    });

    let runs = 0;
    let copyCalls = 0;
    for (
      let round = 0;
      round <= FILE_SUGGEST_BACKFILL_MAX_GENERATION;
      round++
    ) {
      for (;;) {
        const leased = await leaseNextFileIndexJob({
          pipeline: FileIndexJobPipeline.SUGGEST,
        });
        if (!leased) break;
        const before = evaluator.calls;
        await runSuggestionJob(leased, {
          evaluator: evaluator as unknown as JevLabelEvaluator,
          configured: () => true,
        });
        // Other documents in a shared database may be asked; the copy may not.
        if (leased.job.resourceId === resourceId) {
          runs += 1;
          copyCalls += evaluator.calls - before;
        }
      }
      await backfillMissingSuggestionJobs({ limit: 100 });
    }

    expect(runs).toBeGreaterThan(1);
    expect(copyCalls).toBe(0);
    expect(await prisma.fileLabel.count({ where: { resourceId } })).toBe(0);
  });
});

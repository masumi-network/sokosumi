import { randomUUID } from "node:crypto";

import { FileIndexJobPipeline, FileLabelKind } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import {
  backfillMissingSuggestionJobs,
  enqueueFileIndexJob,
  FILE_SUGGEST_BACKFILL_MAX_GENERATION,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import {
  createDriveCopyResource,
  driveResourceHeld,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

/** Set to make the next enqueue throw, as a dropped connection would. */
const enqueueFault = vi.hoisted(() => ({ failNext: false }));
vi.mock("@/lib/files/index-jobs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/files/index-jobs")>();
  return {
    ...actual,
    enqueueFileIndexJob: (
      ...args: Parameters<typeof actual.enqueueFileIndexJob>
    ) => {
      if (enqueueFault.failNext) {
        enqueueFault.failNext = false;
        return Promise.reject(new Error("connection dropped"));
      }
      return actual.enqueueFileIndexJob(...args);
    },
  };
});

/**
 * A Drive copy against the real catalog and job queue.
 *
 * The route test models these with mocks. This one checks the catalog's
 * side: the copy's document is created live, pinned and queued for
 * extraction in one step or not at all, never over another row, and no
 * later step asks the paid label model.
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

  function create(name: string) {
    return createDriveCopyResource({
      key: key(name),
      displayName: name,
      mimeType: "text/markdown",
      sizeBytes: 42,
      decidedByUserId: ownerId,
    });
  }

  function extractJobs(resourceId: string) {
    return prisma.fileIndexJob.count({
      where: { resourceId, pipeline: FileIndexJobPipeline.EXTRACT },
    });
  }

  it("creates a live, pinned document with one extraction job", async () => {
    const id = await create("plan (copy).md");

    expect(
      await prisma.fileResource.findUniqueOrThrow({
        where: { id },
        select: {
          lifecycle: true,
          sizeBytes: true,
          mimeType: true,
          versions: { select: { revision: true, sizeBytes: true } },
          overrides: { select: { field: true, labelId: true } },
        },
      }),
    ).toEqual({
      lifecycle: "ACTIVE",
      sizeBytes: 42,
      mimeType: "text/markdown",
      versions: [{ revision: 1, sizeBytes: 42 }],
      overrides: expect.arrayContaining([
        { field: "category", labelId: null },
        { field: "tags", labelId: null },
      ]),
    });
    expect(await extractJobs(id)).toBe(1);
    expect(await driveResourceHeld(key("plan (copy).md"))).toBe(true);
  });

  it("never takes over a name any row holds, such as a pending upload", async () => {
    await reserveDriveUploadResource({
      key: key("sheet (copy).md"),
      displayName: "sheet (copy).md",
      mimeType: "text/plain",
      sizeBytes: 9,
    });

    expect(await driveResourceHeld(key("sheet (copy).md"))).toBe(true);
    await expect(create("sheet (copy).md")).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("writes nothing when its job cannot be queued", async () => {
    enqueueFault.failNext = true;

    await expect(create("agenda (copy).md")).rejects.toThrow(
      "connection dropped",
    );

    expect(await driveResourceHeld(key("agenda (copy).md"))).toBe(false);
  });

  it("never asks the label model, through enqueue and the sweep", async () => {
    const copy = key("notes (copy).txt");
    const resourceId = await createDriveCopyResource({
      key: copy,
      displayName: "notes (copy).txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      decidedByUserId: ownerId,
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

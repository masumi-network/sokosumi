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
  activateDriveCopyResource,
  adoptDriveUploadResource,
  releaseDriveCopyResource,
  reserveDriveCopyResource,
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
 * side of the contract: a reservation is never shared, release and
 * activation touch only the copy's own row at revision 1, activation and its
 * job land together, and no later step asks the paid label model.
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

  function reserve(name: string) {
    return reserveDriveCopyResource({
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

  it("refuses a second reservation of a held name", async () => {
    await reserve("weekly (copy).md");

    await expect(reserve("weekly (copy).md")).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("activates with the written metadata and queues extraction once", async () => {
    const id = await reserve("plan (copy).md");

    expect(
      await activateDriveCopyResource({
        resourceId: id,
        sizeBytes: 7,
        mimeType: "text/plain",
      }),
    ).toBe(true);

    const row = await prisma.fileResource.findUniqueOrThrow({
      where: { id },
      select: { lifecycle: true, sizeBytes: true, mimeType: true },
    });
    expect(row).toEqual({
      lifecycle: "ACTIVE",
      sizeBytes: 7,
      mimeType: "text/plain",
    });
    expect(await extractJobs(id)).toBe(1);
  });

  it("keeps one identity and one job when the backfill adopts first", async () => {
    const id = await reserve("brief (copy).md");
    const name = "brief (copy).md";

    const adopted = await adoptDriveUploadResource({
      key: key(name),
      displayName: name,
      mimeType: null,
      sizeBytes: 42,
      uploadedAt: new Date(),
    });

    expect(adopted).toBe(id);
    expect(
      await activateDriveCopyResource({
        resourceId: id,
        sizeBytes: 42,
        mimeType: "text/markdown",
      }),
    ).toBe(true);
    expect(await extractJobs(id)).toBe(1);
  });

  it("leaves a backfill adoption pending when its job cannot be queued", async () => {
    const name = "agenda (copy).md";
    const id = await reserve(name);

    enqueueFault.failNext = true;
    await expect(
      adoptDriveUploadResource({
        key: key(name),
        displayName: name,
        mimeType: null,
        sizeBytes: 42,
        uploadedAt: new Date(),
      }),
    ).rejects.toThrow("connection dropped");

    const row = await prisma.fileResource.findUniqueOrThrow({
      where: { id },
      select: { lifecycle: true },
    });
    expect(row.lifecycle).toBe("PENDING");
    expect(await extractJobs(id)).toBe(0);
  });

  it("neither activates nor releases a row an upload versioned meanwhile", async () => {
    const name = "deck (copy).md";
    const id = await reserve(name);
    await reserveDriveUploadResource({
      key: key(name),
      displayName: name,
      mimeType: "text/markdown",
      sizeBytes: 9,
    });

    expect(
      await activateDriveCopyResource({
        resourceId: id,
        sizeBytes: 42,
        mimeType: "text/markdown",
      }),
    ).toBe(false);
    await releaseDriveCopyResource(id);

    const row = await prisma.fileResource.findUniqueOrThrow({
      where: { id },
      select: { lifecycle: true, contentRevision: true },
    });
    expect(row).toEqual({ lifecycle: "PENDING", contentRevision: 2 });
    expect(await extractJobs(id)).toBe(0);
  });

  it("releases its own pending reservation, so the name is free again", async () => {
    const id = await reserve("memo (copy).md");

    await releaseDriveCopyResource(id);

    expect(await prisma.fileResource.count({ where: { id } })).toBe(0);
    await expect(reserve("memo (copy).md")).resolves.toEqual(
      expect.any(String),
    );
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
    await activateDriveCopyResource({
      resourceId,
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

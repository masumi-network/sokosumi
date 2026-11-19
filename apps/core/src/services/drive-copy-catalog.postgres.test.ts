import { randomUUID } from "node:crypto";

import { FileIndexJobPipeline, FileLabelKind } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { runExtractionNudge } from "@/lib/files/in-process-indexer";
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
  renameDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

/**
 * A Drive copy is an ordinary upload whose reservation pins category and
 * tags empty. Against the real catalog and job queue: the pins exist before
 * any bytes, only on a new document, survive every existing writer that
 * carries a reservation forward, and leave no step that asks the paid model.
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

  function reserve(name: string, pinLabelsEmpty = true) {
    return reserveDriveUploadResource({
      key: key(name),
      displayName: name,
      mimeType: "text/markdown",
      sizeBytes: 42,
      pinLabelsEmpty: pinLabelsEmpty ? { decidedByUserId: ownerId } : undefined,
    });
  }

  function pins(resourceId: string) {
    return prisma.fileFieldOverride.findMany({
      where: { resourceId },
      select: { field: true, labelId: true, decision: true },
      orderBy: { field: "asc" },
    });
  }

  const EMPTY_PINS = [
    { field: "category", labelId: null, decision: "PIN" },
    { field: "tags", labelId: null, decision: "PIN" },
  ];

  it("pins a new reservation empty before any bytes", async () => {
    const { resourceId } = await reserve("plan (copy).md");

    expect(await pins(resourceId)).toEqual(EMPTY_PINS);
  });

  it("never pins or joins a document that already holds the name", async () => {
    const { resourceId: other } = await reserve("taken (copy).md", false);

    await expect(reserve("taken (copy).md")).rejects.toMatchObject({
      status: 409,
    });
    expect(await pins(other)).toEqual([]);
  });

  it("keeps the pins through finalize, a lost-finalize adoption and a rename", async () => {
    const { resourceId: finalized } = await reserve("a (copy).md");
    await activateDriveUploadResource({
      key: key("a (copy).md"),
      sizeBytes: 42,
      mimeType: "text/markdown",
    });
    const { resourceId: adopted } = await reserve("b (copy).md");
    await adoptDriveUploadResource({
      key: key("b (copy).md"),
      displayName: "b (copy).md",
      mimeType: null,
      sizeBytes: 42,
      uploadedAt: new Date(),
    });
    await renameDriveUploadResource({
      workspaceId,
      scope: "user",
      fromPathname: key("b (copy).md").pathname,
      toPathname: key("b.md").pathname,
      displayName: "b.md",
    });

    for (const id of [finalized, adopted]) {
      expect(await pins(id)).toEqual(EMPTY_PINS);
      expect(
        (
          await prisma.fileResource.findUniqueOrThrow({
            where: { id },
            select: { lifecycle: true },
          })
        ).lifecycle,
      ).toBe("ACTIVE");
    }
  });

  it("tells finalize whether the upload's labels are pinned empty", async () => {
    await reserve("flag (copy).md");
    await reserve("flag.md", false);
    const finalize = (name: string) =>
      activateDriveUploadResource({
        key: key(name),
        sizeBytes: 42,
        mimeType: "text/markdown",
      });

    expect(await finalize("flag (copy).md")).toMatchObject({
      labelsPinnedEmpty: true,
    });
    expect(await finalize("flag.md")).toMatchObject({
      labelsPinnedEmpty: false,
    });
  });

  it("answers 409, not a database error, when copies race for one name", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => reserve("race (copy).md")),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const outcome of outcomes.filter((o) => o.status === "rejected")) {
      expect(outcome).toMatchObject({ reason: { status: 409 } });
    }
  });

  /** Fake evaluator calls for one document's queued suggestion work. */
  async function suggestionsAsked(resourceId: string) {
    await prisma.fileVersion.updateMany({
      where: { resourceId },
      data: { extractionState: "UNSUPPORTED" },
    });
    await prisma.fileIndexJob.updateMany({
      where: { resourceId, pipeline: FileIndexJobPipeline.EXTRACT },
      data: { state: "SUCCEEDED" },
    });
    const { contentRevision } = await prisma.fileResource.findUniqueOrThrow({
      where: { id: resourceId },
      select: { contentRevision: true },
    });
    await enqueueFileIndexJob({
      resourceId,
      pipeline: FileIndexJobPipeline.SUGGEST,
      contentRevision,
      runAfter: new Date(Date.now() - 1_000),
    });
    let asked = 0;
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
      if (leased.job.resourceId === resourceId)
        asked += evaluator.calls - before;
    }
    return asked;
  }

  function finalize(name: string, sizeBytes = 42) {
    return activateDriveUploadResource({
      key: key(name),
      sizeBytes,
      mimeType: "text/markdown",
    });
  }

  describe("a copy grant that may still land keeps its name", () => {
    it("refuses an ordinary upload, so a late copy PUT finalizes as the copy, pinned", async () => {
      const { resourceId } = await reserve("late (copy).md");

      // The ordinary upload sees no bytes yet and asks for the name.
      await expect(reserve("late (copy).md", false)).rejects.toMatchObject({
        status: 409,
      });
      // Then the copy's PUT lands and its own success callback finalizes.
      expect(await finalize("late (copy).md")).toEqual({
        resourceId,
        labelsPinnedEmpty: true,
      });
      expect(await pins(resourceId)).toEqual(EMPTY_PINS);
      expect(await suggestionsAsked(resourceId)).toBe(0);
    });

    it("keeps the pins when the backfill adopts a copy whose finalize was lost", async () => {
      const { resourceId } = await reserve("lost (copy).md");
      await expect(reserve("lost (copy).md", false)).rejects.toMatchObject({
        status: 409,
      });

      await adoptDriveUploadResource({
        key: key("lost (copy).md"),
        displayName: "lost (copy).md",
        mimeType: null,
        sizeBytes: 42,
        uploadedAt: new Date(),
      });

      expect(await pins(resourceId)).toEqual(EMPTY_PINS);
      expect(await suggestionsAsked(resourceId)).toBe(0);
    });

    it("lets an ordinary upload take the name once the copy grant has expired", async () => {
      const { resourceId } = await reserve("draft (copy).md");
      await prisma.fileResource.update({
        where: { id: resourceId },
        data: { createdAt: new Date(Date.now() - 21 * 60_000) },
      });

      await reserve("draft (copy).md", false);
      expect(await finalize("draft (copy).md", 9)).toEqual({
        resourceId,
        labelsPinnedEmpty: false,
      });

      expect(await pins(resourceId)).toEqual([]);
      // The ordinary upload is labelled like any other.
      expect(await suggestionsAsked(resourceId)).toBe(1);
    });
  });

  it("finalizing a copy runs extraction only, leaving other files' paid work queued", async () => {
    const { resourceId: other } = await reserve("other.md", false);
    await enqueueFileIndexJob({
      resourceId: other,
      pipeline: FileIndexJobPipeline.SUGGEST,
      contentRevision: 1,
      runAfter: new Date(Date.now() - 1_000),
    });
    const before = evaluator.calls;

    await runExtractionNudge();

    expect(evaluator.calls).toBe(before);
    expect(
      await prisma.fileIndexJob.findFirstOrThrow({
        where: { resourceId: other, pipeline: FileIndexJobPipeline.SUGGEST },
        select: { state: true },
      }),
    ).toEqual({ state: "QUEUED" });
  });

  it("never asks the label model, through enqueue and the sweep", async () => {
    const { resourceId } = await reserve("notes (copy).txt");
    await activateDriveUploadResource({
      key: key("notes (copy).txt"),
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

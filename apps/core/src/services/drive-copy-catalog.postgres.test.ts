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
import { reconcileStaleDriveCopies } from "@/services/drive-copy-reconcile";
import {
  activateDriveUploadResource,
  adoptDriveUploadResource,
  publishDriveCopyResource,
  releaseDriveCopyResource,
  renameDriveUploadResource,
  reserveDriveCopyResource,
  reserveDriveUploadResource,
  tombstoneDriveUploadResource,
} from "@/services/file-catalog.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

/** Objects in the mocked Blob store, by pathname. */
const objects = vi.hoisted(
  () => new Map<string, { size: number; contentType: string }>(),
);
vi.mock("@/lib/drive-blob", () => ({
  driveHead: async (pathname: string) => objects.get(pathname) ?? null,
}));

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
 * The route test models storage. This one checks the catalog's side of the
 * publication protocol: a copy's identity and its free-indexing pins exist
 * before its bytes, no ordinary writer (upload, finalize, backfill) takes
 * or activates a claim, publication is fenced and atomic, and a claim a
 * request left behind is settled by the sweep, never by guessing.
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

  function publish(id: string, name: string) {
    return publishDriveCopyResource({
      resourceId: id,
      pathname: key(name).pathname,
      sizeBytes: 7,
      mimeType: "text/plain",
    });
  }

  function upload(name: string) {
    return reserveDriveUploadResource({
      key: key(name),
      displayName: name,
      mimeType: "text/plain",
      sizeBytes: 9,
    });
  }

  function row(id: string) {
    return prisma.fileResource.findUnique({
      where: { id },
      select: {
        lifecycle: true,
        sourceId: true,
        sizeBytes: true,
        mimeType: true,
        overrides: { select: { field: true, labelId: true } },
      },
    });
  }

  function extractJobs(resourceId: string) {
    return prisma.fileIndexJob.count({
      where: { resourceId, pipeline: FileIndexJobPipeline.EXTRACT },
    });
  }

  async function age(id: string) {
    await prisma.fileResource.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
  }

  it("reserves a pending identity, pinned free, before any bytes", async () => {
    const id = await reserve("plan (copy).md");

    expect(await row(id)).toMatchObject({
      lifecycle: "PENDING",
      overrides: expect.arrayContaining([
        { field: "category", labelId: null },
        { field: "tags", labelId: null },
      ]),
    });
    await expect(reserve("plan (copy).md")).rejects.toMatchObject({
      code: "P2002",
    });
  });

  describe("ordinary writers never take a claim", () => {
    it("refuses an upload at a claimed name", async () => {
      const id = await reserve("deck (copy).md");

      await expect(upload("deck (copy).md")).rejects.toMatchObject({
        status: 409,
      });
      expect((await row(id))?.mimeType).toBe("text/markdown");
    });

    it("leaves an upload's earlier reservation to the upload", async () => {
      await upload("sheet (copy).md");

      await expect(reserve("sheet (copy).md")).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("never finalizes a claim as an upload, and still finalizes uploads", async () => {
      const id = await reserve("final (copy).md");
      const finalize = (name: string) =>
        activateDriveUploadResource({
          key: key(name),
          sizeBytes: 9,
          mimeType: "text/plain",
        });

      expect(await finalize("final (copy).md")).toBeNull();
      expect((await row(id))?.lifecycle).toBe("PENDING");

      const { resourceId } = await upload("report.txt");
      expect(await finalize("report.txt")).toEqual({ resourceId });
      expect(await finalize("report.txt")).toEqual({ resourceId });
    });

    it("is never adopted by a backfill that lists the bytes first", async () => {
      const id = await reserve("brief (copy).md");

      expect(
        await adoptDriveUploadResource({
          key: key("brief (copy).md"),
          displayName: "brief (copy).md",
          mimeType: null,
          sizeBytes: 42,
          uploadedAt: new Date(),
        }),
      ).toBe(id);

      expect((await row(id))?.lifecycle).toBe("PENDING");
      expect(await extractJobs(id)).toBe(0);
    });
  });

  describe("publication", () => {
    it("goes live with the written metadata and one job, atomically", async () => {
      const id = await reserve("memo (copy).md");

      expect(await publish(id, "memo (copy).md")).toBe(true);
      expect(await row(id)).toMatchObject({
        lifecycle: "ACTIVE",
        sizeBytes: 7,
        mimeType: "text/plain",
      });
      expect(await extractJobs(id)).toBe(1);
      expect(await publish(id, "memo (copy).md")).toBe(false);
    });

    it("writes nothing when its job cannot be queued", async () => {
      const id = await reserve("agenda (copy).md");

      enqueueFault.failNext = true;
      await expect(publish(id, "agenda (copy).md")).rejects.toThrow(
        "connection dropped",
      );

      expect((await row(id))?.lifecycle).toBe("PENDING");
      expect(await extractJobs(id)).toBe(0);
    });

    it("does not publish a claim deleted or renamed in the meantime", async () => {
      const deleted = await reserve("gone (copy).md");
      await tombstoneDriveUploadResource({
        workspaceId,
        scope: "user",
        pathname: key("gone (copy).md").pathname,
      });
      const renamed = await reserve("moved (copy).md");
      await renameDriveUploadResource({
        workspaceId,
        scope: "user",
        fromPathname: key("moved (copy).md").pathname,
        toPathname: key("moved.md").pathname,
        displayName: "moved.md",
      });

      expect(await publish(deleted, "gone (copy).md")).toBe(false);
      expect(await publish(renamed, "moved (copy).md")).toBe(false);
      expect((await row(deleted))?.lifecycle).toBe("TOMBSTONED");
      expect((await row(renamed))?.lifecycle).toBe("PENDING");
    });

    it("releases only its own claim", async () => {
      const id = await reserve("undo (copy).md");
      await releaseDriveCopyResource({
        resourceId: id,
        pathname: key("undo (copy).md").pathname,
      });
      expect(await row(id)).toBeNull();

      const live = await reserve("kept (copy).md");
      await publish(live, "kept (copy).md");
      await releaseDriveCopyResource({
        resourceId: live,
        pathname: key("kept (copy).md").pathname,
      });
      expect((await row(live))?.lifecycle).toBe("ACTIVE");
    });
  });

  describe("the sweep settles claims a request left behind", () => {
    it("releases a stale claim with no bytes, publishes one with bytes, and leaves fresh ones", async () => {
      const empty = await reserve("empty (copy).md");
      const landed = await reserve("landed (copy).md");
      const fresh = await reserve("fresh (copy).md");
      await age(empty);
      await age(landed);
      objects.set(key("landed (copy).md").pathname, {
        size: 5,
        contentType: "text/csv",
      });
      objects.set(key("fresh (copy).md").pathname, {
        size: 5,
        contentType: "text/csv",
      });

      await reconcileStaleDriveCopies();

      expect(await row(empty)).toBeNull();
      expect(await row(landed)).toMatchObject({
        lifecycle: "ACTIVE",
        sizeBytes: 5,
        mimeType: "text/csv",
      });
      expect(await extractJobs(landed)).toBe(1);
      expect((await row(fresh))?.lifecycle).toBe("PENDING");
    });

    it("publishes a renamed claim at the name its bytes now have", async () => {
      const id = await reserve("away (copy).md");
      await renameDriveUploadResource({
        workspaceId,
        scope: "user",
        fromPathname: key("away (copy).md").pathname,
        toPathname: key("away.md").pathname,
        displayName: "away.md",
      });
      objects.set(key("away.md").pathname, {
        size: 3,
        contentType: "text/plain",
      });
      await age(id);

      await reconcileStaleDriveCopies();

      expect(await row(id)).toMatchObject({
        lifecycle: "ACTIVE",
        sourceId: key("away.md").pathname,
      });
    });
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
    await publishDriveCopyResource({
      resourceId,
      pathname: copy.pathname,
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

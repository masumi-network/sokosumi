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
  renameDriveUploadResource,
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

  function upload(name: string, sizeBytes = 9) {
    return reserveDriveUploadResource({
      key: key(name),
      displayName: name,
      mimeType: "text/plain",
      sizeBytes,
    });
  }

  function adopt(
    name: string,
    client?: Parameters<typeof adoptDriveUploadResource>[0]["client"],
  ) {
    return adoptDriveUploadResource({
      key: key(name),
      displayName: name,
      mimeType: null,
      sizeBytes: 11,
      uploadedAt: new Date(),
      client,
    });
  }

  function row(id: string) {
    return prisma.fileResource.findUniqueOrThrow({
      where: { id },
      select: {
        lifecycle: true,
        contentRevision: true,
        sizeBytes: true,
        mimeType: true,
        versions: { select: { revision: true, sizeBytes: true } },
      },
    });
  }

  it("activates with the written metadata and queues extraction once", async () => {
    const id = await reserve("plan (copy).md");

    expect(
      await activateDriveCopyResource({
        resourceId: id,
        pathname: key("plan (copy).md").pathname,
        sizeBytes: 7,
        mimeType: "text/plain",
      }),
    ).toBe(true);

    expect(await row(id)).toMatchObject({
      lifecycle: "ACTIVE",
      sizeBytes: 7,
      mimeType: "text/plain",
      versions: [{ revision: 1, sizeBytes: 7 }],
    });
    expect(await extractJobs(id)).toBe(1);
  });

  it("refuses to activate a copy that was renamed before it finished", async () => {
    const id = await reserve("moved (copy).md");
    await renameDriveUploadResource({
      workspaceId,
      scope: "user",
      fromPathname: key("moved (copy).md").pathname,
      toPathname: key("elsewhere.md").pathname,
      displayName: "elsewhere.md",
    });

    expect(
      await activateDriveCopyResource({
        resourceId: id,
        pathname: key("moved (copy).md").pathname,
        sizeBytes: 7,
        mimeType: "text/plain",
      }),
    ).toBe(false);
    expect((await row(id)).lifecycle).toBe("PENDING");
    expect(await extractJobs(id)).toBe(0);
  });

  describe("an upload and a copy never share a reservation", () => {
    it("refuses an upload while a copy holds the name, then versions the finished copy", async () => {
      const name = "deck (copy).md";
      const id = await reserve(name);

      await expect(upload(name)).rejects.toMatchObject({ status: 409 });
      expect(await row(id)).toMatchObject({
        lifecycle: "PENDING",
        contentRevision: 1,
        mimeType: "text/markdown",
      });

      await activateDriveCopyResource({
        resourceId: id,
        pathname: key(name).pathname,
        sizeBytes: 42,
        mimeType: "text/markdown",
      });
      await expect(upload(name)).resolves.toMatchObject({ resourceId: id });
    });

    it("refuses a copy at a name an upload reserved first", async () => {
      await upload("sheet (copy).md");

      await expect(reserve("sheet (copy).md")).rejects.toMatchObject({
        code: "P2002",
      });
    });
  });

  describe("the backfill", () => {
    it("never adopts an interrupted copy", async () => {
      const id = await reserve("brief (copy).md");

      expect(await adopt("brief (copy).md")).toBe(id);

      expect((await row(id)).lifecycle).toBe("PENDING");
      expect(await extractJobs(id)).toBe(0);
    });

    it("adopts a lost upload with the listed size and its job together", async () => {
      const { resourceId } = await upload("lost.txt");

      await adopt("lost.txt");

      expect(await row(resourceId)).toMatchObject({
        lifecycle: "ACTIVE",
        sizeBytes: 11,
        versions: [{ revision: 1, sizeBytes: 11 }],
      });
      expect(await extractJobs(resourceId)).toBe(1);
    });

    it("leaves an adoption pending when its job cannot be queued", async () => {
      const { resourceId } = await upload("agenda.txt");

      enqueueFault.failNext = true;
      await expect(adopt("agenda.txt")).rejects.toThrow("connection dropped");

      expect((await row(resourceId)).lifecycle).toBe("PENDING");
      expect(await extractJobs(resourceId)).toBe(0);
    });

    it("does not activate a revision an upload added after it looked", async () => {
      const { resourceId } = await upload("draft.txt");
      // The upload's next grant lands between adoption's read and its write.
      const racing = new Proxy(prisma, {
        get(target, property) {
          if (property !== "fileResource") return Reflect.get(target, property);
          return {
            ...target.fileResource,
            findUnique: async (args: object) => {
              const seen = await target.fileResource.findUnique(
                args as Parameters<typeof target.fileResource.findUnique>[0],
              );
              await upload("draft.txt", 99);
              return seen;
            },
          };
        },
      });

      await adopt("draft.txt", racing as unknown as typeof prisma);

      expect(await row(resourceId)).toMatchObject({
        lifecycle: "PENDING",
        contentRevision: 2,
      });
      expect(await extractJobs(resourceId)).toBe(0);
    });
  });

  describe("releasing a failed copy", () => {
    it("drops the row only once its own bytes are gone", async () => {
      const id = await reserve("memo (copy).md");
      const removed: string[] = [];

      await releaseDriveCopyResource(
        { resourceId: id, pathname: key("memo (copy).md").pathname },
        async () => {
          removed.push("bytes");
        },
      );

      expect(removed).toEqual(["bytes"]);
      expect(await prisma.fileResource.count({ where: { id } })).toBe(0);
      await expect(reserve("memo (copy).md")).resolves.toEqual(
        expect.any(String),
      );
    });

    it("keeps the claim pending when its bytes cannot be removed", async () => {
      const id = await reserve("stuck (copy).md");

      await expect(
        releaseDriveCopyResource(
          { resourceId: id, pathname: key("stuck (copy).md").pathname },
          async () => {
            throw new Error("Blob service unavailable");
          },
        ),
      ).rejects.toThrow("Blob service unavailable");

      expect((await row(id)).lifecycle).toBe("PENDING");
    });

    it("touches neither bytes nor row once the copy is live", async () => {
      const name = "live (copy).md";
      const id = await reserve(name);
      await activateDriveCopyResource({
        resourceId: id,
        pathname: key(name).pathname,
        sizeBytes: 42,
        mimeType: "text/markdown",
      });
      let removed = false;

      await releaseDriveCopyResource(
        { resourceId: id, pathname: key(name).pathname },
        async () => {
          removed = true;
        },
      );

      expect(removed).toBe(false);
      expect((await row(id)).lifecycle).toBe("ACTIVE");
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
    await activateDriveCopyResource({
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

import { randomUUID } from "node:crypto";

import {
  FileIndexJobPipeline,
  FileLabelKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import {
  enqueueFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import { resetJevScheduler } from "@/lib/files/jev-scheduler";
import { writeVersionChunks } from "@/services/file-index.service";
import {
  processFileSuggestionJobs,
  runSuggestionJob,
  SUGGESTION_VOCABULARY_MAX,
} from "@/services/file-suggestions.service";

/**
 * A cap that fires and tells nobody, one frame further along.
 *
 * `runSuggestionJob` computes `vocabularyTruncated` and its docstring says
 * why: "A cap that fires and tells nobody is the defect this feature has
 * produced repeatedly", and "the workspace owner is the only person who
 * can act on it." Its only production caller,
 * `processFileSuggestionJobs`, read `suggested`, `deferred` and `failed`
 * and never read it. The one other reader in the repository was a test.
 *
 * So a workspace that had outgrown the shortlist window got suggestions
 * drawn from part of its vocabulary, every document, and nothing outside
 * that one stack frame could tell. The signal existed and stopped short of
 * anybody who could act on it, which is the same defect the docstring is
 * about rather than a different one.
 *
 * It was also returned on the success path only, and the cap fires when
 * the shortlist is built — before the model is asked. A document that was
 * then deferred, or whose dispatch failed, had its vocabulary cut just the
 * same and reported nothing.
 *
 * Both halves are asserted here: the tick counts it, and a run that does
 * not reach a verdict still carries it.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";
let resourceId = "";

/** One category and enough tags that the window has to cut them. */
const TAGS = SUGGESTION_VOCABULARY_MAX + 10;

function evaluatorDeclining(): JevLabelEvaluator {
  return {
    async evaluateLabels() {
      return {
        ok: true as const,
        chosen: [],
        reason: null,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: "0.0001",
      };
    },
  } as unknown as JevLabelEvaluator;
}

/** Fails the dispatch, so the run ends without a verdict. */
function evaluatorFailing(): JevLabelEvaluator {
  return {
    async evaluateLabels() {
      return {
        ok: false as const,
        chosen: [],
        reason: "status-503",
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 0,
        costUsd: null,
      };
    },
  } as unknown as JevLabelEvaluator;
}

async function queueJob(generation: number): Promise<void> {
  await enqueueFileIndexJob({
    resourceId,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision: 1,
    desiredGeneration: generation,
    runAfter: new Date(Date.now() - 1_000),
  });
}

describe.skipIf(!enabled)(
  "a vocabulary the window had to cut reaches the caller",
  () => {
    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Truncation owner",
          email: `trunc-${suffix}@example.test`,
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
      scopeId = (
        await ensureEvidenceScope({
          workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: ownerId,
        })
      ).id;

      await prisma.workspaceLabel.create({
        data: {
          workspaceId,
          kind: FileLabelKind.CATEGORY,
          displayName: "Contracts",
          normalizedName: "contracts",
        },
      });
      for (let n = 0; n < TAGS; n += 1) {
        await prisma.workspaceLabel.create({
          data: {
            workspaceId,
            kind: FileLabelKind.TAG,
            displayName: `Tag ${n}`,
            normalizedName: `tag-${String(n).padStart(3, "0")}`,
          },
        });
      }

      const resource = await prisma.fileResource.create({
        data: {
          workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: `users/${ownerId}/commuters.txt`,
          ownerUserId: ownerId,
          displayName: "commuters.txt",
          normalizedName: "commuters.txt",
          mimeType: "text/plain",
          lifecycle: FileResourceLifecycle.ACTIVE,
          versions: {
            create: {
              revision: 1,
              objectKey: `users/${ownerId}/commuters.txt`,
              extractionState: "INDEXED",
              extractionCoverage: 1,
            },
          },
        },
        select: { id: true, versions: { select: { id: true } } },
      });
      resourceId = resource.id;
      await writeVersionChunks({
        versionId: resource.versions[0].id,
        evidenceScopeId: scopeId,
        scopeVersion: 1,
        chunks: chunkExtractedText(
          "Findings about bicycle commuters and their travel patterns.",
        ),
      });
    }, 300_000);

    beforeEach(async () => {
      resetJevScheduler();
      await prisma.fileIndexJob.deleteMany({ where: { resourceId } });
      await prisma.fileLabel.deleteMany({ where: { resourceId } });
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
    });

    afterAll(async () => {
      if (!enabled) return;
      resetJevScheduler();
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    /**
     * The premise: the window really is cutting this workspace's tags. If
     * it were not, everything below would pass by reporting nothing about
     * nothing.
     */
    it("1. the window cuts this workspace's vocabulary", async () => {
      await queueJob(1);
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      expect(leased).not.toBeNull();
      if (!leased) return;

      const outcome = await runSuggestionJob(leased, {
        evaluator: evaluatorDeclining(),
        configured: () => true,
      });

      expect(outcome.vocabularyTruncated).toBe("tags");
    }, 120_000);

    it("2. the tick reports it, not just the function that computed it", async () => {
      await queueJob(2);

      const tick = await processFileSuggestionJobs({
        shouldContinue: () => true,
        maxJobs: 1,
        dependencies: {
          evaluator: evaluatorDeclining(),
          configured: () => true,
        },
      });

      expect(
        tick.vocabularyTruncated,
        "the run computed that this workspace's tags did not fit and the " +
          "tick it belongs to reports nothing: the cap fired and told " +
          "nobody, which is the defect the field was added for",
      ).toEqual({ tags: 1, categories: 0 });
    }, 120_000);

    it("3. a run that never reached a verdict still reports it", async () => {
      /**
       * The cap fires when the shortlist is built, before the model is
       * asked. Reporting it only when everything afterwards went well is
       * the same silence one step along — and a provider outage is
       * exactly when a workspace is least likely to notice on its own.
       */
      await queueJob(3);
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      expect(leased).not.toBeNull();
      if (!leased) return;

      const outcome = await runSuggestionJob(leased, {
        evaluator: evaluatorFailing(),
        configured: () => true,
      });

      expect(
        outcome.failed,
        "this case is not exercising the failure path",
      ).toBe(true);
      expect(
        outcome.vocabularyTruncated,
        "the dispatch failed and the truncation went unreported with it",
      ).toBe("tags");
    }, 120_000);
  },
);

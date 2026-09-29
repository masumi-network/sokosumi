import { randomUUID } from "node:crypto";

import {
  FileIndexJobPipeline,
  FileLabelKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import {
  ensureEvidenceScope,
  resolveScopeEpoch,
} from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import {
  enqueueFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import { admitJevRequest } from "@/lib/files/jev-admission";
import type { JevEvaluator, JevLabelEvaluator } from "@/lib/files/jev-client";
import { rerankFileCandidates } from "@/lib/files/jev-ranking";
import {
  JevScheduler,
  PER_WORKSPACE_USD_PER_DAY,
} from "@/lib/files/jev-scheduler";
import type { FileCandidate } from "@/lib/files/retrieval";
import { writeVersionChunks } from "@/services/file-index.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

/**
 * The daily spend cap rests on one argument, and nothing guarded it.
 *
 * `jev-ranking.ts` is the only place on the ranking path that puts a real
 * cost into `recordDispatch`, and `jev-admission.ts` sums `costUsd`
 * across the day to decide whether the next request may go out. So if
 * that one argument becomes `null`, every dispatched call is free as far
 * as the budget is concerned, the cap never fires, and every existing
 * test stays green. A cap nothing can break is not a cap.
 *
 * Two assertions, and the order matters:
 *
 * 1. a dispatched call writes a **non-null** `costUsd` — not merely that
 *    an admission row exists;
 * 2. the **next** admission sees the higher daily total, read through the
 *    real `admitJevRequest` rather than by querying the column here.
 *
 * The second is the one that is actually the cap. Asserting the column
 * proves the write happened; asserting the next admission proves the
 * write is the thing the budget reads. Those are different claims and
 * only the second would survive somebody changing which column the
 * aggregate sums.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let workspaceId = "";
let ownerId = "";
let neighbourWorkspaceId = "";
let neighbourOwnerId = "";

function actorFor(userId: string): FileActor {
  return { userId, organizationId: null, kind: "interactive" };
}

function candidate(id: string): FileCandidate {
  return {
    resourceId: id,
    lineageId: null,
    displayName: `${id}.txt`,
    normalizedName: `${id}.txt`,
    mimeType: "text/plain",
    sizeBytes: 10,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceId: `drive/users/u1/${id}.txt`,
    sourceTaskId: null,
    sourceProjectId: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    contentRevision: 1,
    metadataRevision: 1,
    extractionState: null,
    extractionCoverage: null,
    exactNameMatch: false,
    ftsRank: 0.1,
    bestChunkId: `${id}-chunk`,
    bestChunkText: `${id} passage about commuters`,
    bestChunkAnchor: null,
    metadataMatch: false,
    fusedScore: 0.01,
  };
}

/**
 * Reports a cost large enough to cross the daily cap in one call.
 *
 * The number is ours, not the provider's, and it is deliberately over
 * `PER_WORKSPACE_USD_PER_DAY` so that a single dispatch makes the budget
 * observable through the next admission rather than needing hundreds of
 * calls to accumulate.
 */
function evaluatorCosting(costUsd: string | null): JevEvaluator {
  return {
    async evaluate({ request }: { request: { tokens: number } }) {
      return {
        ok: true,
        score: 5,
        reason: null,
        latencyMs: 1,
        inputTokens: request.tokens,
        outputTokens: 2,
        costUsd,
        generationId: "gen-spend-cap",
      };
    },
  } as unknown as JevEvaluator;
}

async function rank(costUsd: string | null) {
  return rerankFileCandidates({
    workspaceId,
    actor: actorFor(ownerId),
    epoch: await resolveScopeEpoch({
      workspaceId,
      actor: actorFor(ownerId),
    }),
    query: "commuters",
    candidates: [candidate("doc-a"), candidate("doc-b"), candidate("doc-c")],
    configured: () => true,
    evaluator: evaluatorCosting(costUsd),
    scheduler: new JevScheduler(),
  });
}

/** One admission through the real path, which is where the cap lives. */
async function admit(workspace: string, owner: string) {
  return admitJevRequest({
    workspaceId: workspace,
    actor: actorFor(owner),
    purpose: "search-rank",
    payloadDigest: `probe-${randomUUID()}`,
    inputTokens: 1,
    model: "typesafe-ai/jev",
    preparedEpoch: await resolveScopeEpoch({
      workspaceId: workspace,
      actor: actorFor(owner),
    }),
  });
}

describe.skipIf(!enabled)(
  "the daily spend cap reads what dispatch wrote",
  () => {
    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Spend owner",
          email: `spend-${suffix}@example.test`,
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

      // A second tenant, so a refusal can be shown to be about this
      // workspace's spending and not about something global.
      const neighbour = await prisma.user.create({
        data: {
          name: "Spend neighbour",
          email: `spend-n-${suffix}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      neighbourOwnerId = neighbour.id;
      neighbourWorkspaceId = (
        await prisma.workspace.create({
          data: { userId: neighbourOwnerId },
          select: { id: true },
        })
      ).id;
    });

    beforeEach(async () => {
      // Each case starts from an empty ledger, or a previous case's spend
      // decides the next one's outcome.
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId: { in: [workspaceId, neighbourWorkspaceId] } },
      });
    });

    it("writes a non-null cost on the admission it dispatched", async () => {
      /**
       * A small cost on purpose. A wave admits each candidate in turn, so
       * a cost over the cap makes the *second* admission of the same wave
       * refuse and the run falls back with `admission-denied` — which is
       * the cap working, and not what this case is about. Crossing the
       * cap is the next test's job.
       */
      const outcome = await rank("0.000100");

      expect(outcome.mode, `fallback: ${outcome.fallbackReason}`).toBe("model");
      expect(outcome.evaluated).toBeGreaterThan(0);

      const dispatched = await prisma.fileAuthorizationAdmission.findMany({
        where: { workspaceId, dispatchedAt: { not: null } },
        select: { costUsd: true, outcome: true },
      });

      expect(dispatched.length).toBeGreaterThan(0);
      // Not "a row exists" — a row with a cost in it. A dispatched call
      // that records no cost is a call the budget cannot see.
      for (const row of dispatched) {
        expect(row.costUsd, `outcome=${row.outcome}`).not.toBeNull();
      }
      expect(
        dispatched.some((row) => Number(row.costUsd) > 0),
        "every dispatched admission recorded a zero or absent cost",
      ).toBe(true);
    }, 120_000);

    it("refuses the next admission once that spend crosses the cap", async () => {
      /**
       * The assertion that is actually the cap.
       *
       * Read through `admitJevRequest`, not by summing the column here: the
       * first test proves the write, and this proves the write is what the
       * budget consults. If the aggregate were ever re-pointed at a
       * different column, the first test would still pass and this one
       * would not.
       */
      expect(await admit(workspaceId, ownerId)).not.toBeNull();
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });

      await rank(String(PER_WORKSPACE_USD_PER_DAY + 0.5));

      expect(
        await admit(workspaceId, ownerId),
        "the recorded spend did not reach the budget the next admission reads",
      ).toBeNull();
    }, 120_000);

    it("refuses only the workspace that spent it", async () => {
      // Otherwise a cap that fires for everyone would pass the test above
      // for the wrong reason.
      await rank(String(PER_WORKSPACE_USD_PER_DAY + 0.5));

      expect(await admit(workspaceId, ownerId)).toBeNull();
      expect(
        await admit(neighbourWorkspaceId, neighbourOwnerId),
      ).not.toBeNull();
    }, 120_000);

    it("still admits when the day's spend is below the cap", async () => {
      // The other direction: a cap that always refused would also pass the
      // assertions above.
      await rank("0.000100");

      expect(await admit(workspaceId, ownerId)).not.toBeNull();
    }, 120_000);

    /**
     * The label path writes into the same column the cap sums, and nothing
     * watched it.
     *
     * `costUsd` reaches `recordJevDispatch` from exactly two places:
     * `jev-ranking.ts:345` on the search path, and
     * `file-suggestions.service.ts:581` on the label path. Everything above
     * this block drives `rerankFileCandidates` only, so the label writer was
     * unguarded: replacing its `costUsd: verdict.costUsd` with `0` left
     * `jev-spend-cap`, `file-suggestions.postgres`, `jev-client` and
     * `jev-ranking` all green — 100 passed. Every tagging call would then be
     * free as far as the budget is concerned, and a cap that cannot see the
     * spend is not a cap.
     *
     * A guard placed where the thing it guards cannot fail is the shape this
     * branch has already produced once.
     */
    describe("the label path bills against the same budget", () => {
      let labelResourceId = "";
      let labelId = "";

      beforeAll(async () => {
        const scope = await ensureEvidenceScope({
          workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: ownerId,
        });

        // A vocabulary, or the job completes without calling the model at all
        // and this measures nothing.
        labelId = (
          await prisma.workspaceLabel.create({
            data: {
              workspaceId,
              kind: FileLabelKind.TAG,
              displayName: "Commuting",
              normalizedName: "commuting",
              description: "Documents about commuting",
            },
            select: { id: true },
          })
        ).id;

        const resource = await prisma.fileResource.create({
          data: {
            workspaceId,
            sourceKind: FileSourceKind.DRIVE_UPLOAD,
            sourceScope: FileSourceScope.USER,
            sourceId: `drive/users/${ownerId}/spend.txt`,
            ownerUserId: ownerId,
            displayName: "spend.txt",
            normalizedName: "spend.txt",
            mimeType: "text/plain",
            lifecycle: FileResourceLifecycle.ACTIVE,
            versions: {
              create: {
                revision: 1,
                objectKey: `drive/users/${ownerId}/spend.txt`,
                mimeType: "text/plain",
                extractionState: "INDEXED",
                extractionCoverage: 1,
              },
            },
          },
          select: { id: true, versions: { select: { id: true } } },
        });
        labelResourceId = resource.id;

        await writeVersionChunks({
          versionId: resource.versions[0].id,
          evidenceScopeId: scope.id,
          scopeVersion: 1,
          chunks: chunkExtractedText(
            "Findings about bicycle commuters and their travel patterns.",
          ),
        });
      }, 60_000);

      afterEach(async () => {
        if (!enabled) return;
        await prisma.fileLabel.deleteMany({
          where: { resourceId: labelResourceId },
        });
        await prisma.fileIndexJob.deleteMany({
          where: { resourceId: labelResourceId },
        });
      });

      /** Says yes to everything and reports the cost it was given. */
      function labelEvaluatorCosting(costUsd: string | null) {
        return {
          async evaluateLabels(input: { labels: readonly { id: string }[] }) {
            return {
              ok: true,
              chosen: input.labels.map((label) => label.id),
              reason: null,
              latencyMs: 1,
              inputTokens: 10,
              outputTokens: 2,
              costUsd,
              generationId: "gen-label-spend",
            };
          },
        } as unknown as JevLabelEvaluator;
      }

      /**
       * One real suggestion job, through the real dispatch recorder.
       *
       * The wait is the scheduler's per-second bucket: it is a module-level
       * singleton whose burst for background work is three, and the ranking
       * cases above spend it. Without this a job is refused before it reaches
       * the admission, which records no cost — so the cap assertions would fail
       * for a reason that has nothing to do with the cap.
       */
      async function suggest(
        costUsd: string | null,
        generation: number,
      ): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 300));

        await enqueueFileIndexJob({
          resourceId: labelResourceId,
          pipeline: FileIndexJobPipeline.SUGGEST,
          contentRevision: 1,
          desiredGeneration: generation,
          runAfter: new Date(Date.now() - 1_000),
        });
        const leased = await leaseNextFileIndexJob({
          pipeline: FileIndexJobPipeline.SUGGEST,
        });
        expect(leased, "no SUGGEST job was leasable").not.toBeNull();
        if (!leased) return;
        const outcome = await runSuggestionJob(leased, {
          evaluator: labelEvaluatorCosting(costUsd),
          configured: () => true,
        });
        // A refused job records no cost, and "no cost recorded" is precisely
        // what the defect under test looks like. Saying which happened is the
        // difference between a failing cap and a starved scheduler.
        expect(
          outcome.skipped,
          `the label job never dispatched: ${outcome.skipped}`,
        ).toBeNull();
      }

      it("writes a non-null cost on the admission a label job dispatched", async () => {
        await suggest("0.000100", 900);

        const dispatched = await prisma.fileAuthorizationAdmission.findMany({
          where: { workspaceId, dispatchedAt: { not: null } },
          select: { costUsd: true, outcome: true, purpose: true },
        });

        expect(dispatched.length, "the label job dispatched nothing").toBe(1);
        // Not "a row exists" — a row with a cost in it. A dispatched call that
        // records no cost is a call the budget cannot see.
        expect(
          dispatched[0].costUsd,
          `outcome=${dispatched[0].outcome}`,
        ).not.toBeNull();
        expect(Number(dispatched[0].costUsd)).toBeGreaterThan(0);
        // And it is the label path, not a ranking call that wandered in.
        expect(dispatched[0].purpose).toBe("label-suggest");

        // The labels were actually written, so this is a real job and not a
        // skip that happened to leave an admission behind.
        await expect(
          prisma.fileLabel.count({
            where: { resourceId: labelResourceId, labelId },
          }),
        ).resolves.toBe(1);
      }, 120_000);

      it("refuses the next admission once a label job crosses the cap", async () => {
        /**
         * The assertion that is actually the cap, read through
         * `admitJevRequest` rather than by summing the column here. The case
         * above proves the write; this proves the write is what the budget
         * consults, so re-pointing the aggregate at another column fails here
         * and not there.
         */
        expect(await admit(workspaceId, ownerId)).not.toBeNull();
        await prisma.fileAuthorizationAdmission.deleteMany({
          where: { workspaceId },
        });

        await suggest(String(PER_WORKSPACE_USD_PER_DAY + 0.5), 901);

        expect(
          await admit(workspaceId, ownerId),
          "a label job's recorded spend did not reach the budget",
        ).toBeNull();
      }, 120_000);

      it("still admits when a label job's spend is below the cap", async () => {
        // The other direction: a cap that always refused would pass the case
        // above for the wrong reason.
        await suggest("0.000100", 902);

        expect(await admit(workspaceId, ownerId)).not.toBeNull();
      }, 120_000);
    });
  },
);

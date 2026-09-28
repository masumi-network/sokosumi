/**
 * REPRODUCTION ARTIFACT — a provider outage long enough to exhaust the retry
 * budget leaves every document in the suggestion backlog permanently
 * unlabelled, and the provider recovering does not bring them back.
 *
 * Written by the reviewer, not the implementer. Red at `093bde2d2`.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * **What `093bde2d2` fixed and what it left.** That commit's premise is
 * exact: "nothing re-leases a SUCCEEDED row and nothing re-enqueues a
 * SUGGEST on a timer, so the document was permanently unlabelled." It moved
 * a failed dispatch from `completeFileIndexJob` to `failFileIndexJob`, which
 * buys bounded retries and a visible state — a real improvement, and
 * `REPRO-jev-failure-loses-labels` is green at this head because of it.
 *
 * The premise is equally true of a FAILED row. `leaseNextFileIndexJob` leases
 * QUEUED and expired-LEASED only. `enqueueFileIndexJob` does move a FAILED
 * row back to QUEUED, but its only automatic caller is the extraction chain
 * in `file-index.service.ts`, which runs when a document is re-extracted and
 * on no timer. `requeueFileIndexJob`'s only caller is
 * `POST /v1/drive/resources/{id}/reindex`. So once
 * `FILE_INDEX_JOB_MAX_ATTEMPTS` is spent, nothing in the repository will ever
 * look at that document again unless a person asks.
 *
 * **What bounds the damage, and what does not.** The scheduler's circuit
 * breaker throttles hard — measured at 3 dispatches per 5 simulated minutes
 * once open, half-opening every `BREAKER_PROBE_AFTER_MS`. So attempts are
 * spent slowly and a short outage costs nothing: the loss is a function of
 * outage *duration*, not of backlog size. Measured on 40 documents, the
 * whole backlog was FAILED by simulated hour 6. Nothing bounds it after
 * that.
 *
 * **Measured on PostgreSQL 18.6 at `093bde2d2`**, 12 documents, one virtual
 * clock driving the lease, the retry backoffs and the breaker together:
 *
 *   during the outage, total dispatches      : 60  (= 12 x 5 attempts)
 *   jobs FAILED when the outage ends         : 12 of 12
 *   labels written                           : 0
 *   then, provider healthy, 40 further ticks
 *   over ~6.7 more simulated hours:
 *     jobs processed                         : 0
 *     model calls made                       : 0
 *     labels written                         : 0
 *     jobs still FAILED                      : 12 of 12
 *
 * **The drain is hand-rolled, and that is the one liberty taken.** It leases
 * one SUGGEST job and runs it, exactly as `processFileSuggestionJobs` does,
 * but passes `now` so the retry backoffs can be stepped over without
 * sleeping for hours. A foreign job is handed back untouched, because
 * `leaseNextFileIndexJob` takes a pipeline and no workspace filter.
 *
 * **Deliberately not asserting a mechanism.** Case 2 asks only that a
 * healthy provider eventually labels documents that were waiting for it. A
 * sweeper that requeues FAILED SUGGEST jobs, deferring instead of failing a
 * provider error, or anything else that reaches them all satisfy it.
 */
import { randomUUID } from "node:crypto";
import {
  FileIndexJobPipeline,
  FileLabelKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** One virtual clock for the lease, the backoffs and the breaker. */
const clock = { ms: Date.now() };

vi.mock("@/lib/files/jev-scheduler", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/files/jev-scheduler")>();
  let instance: InstanceType<typeof actual.JevScheduler> | null = null;
  return {
    ...actual,
    getJevScheduler: () => {
      instance ??= new actual.JevScheduler(() => clock.ms);
      return instance;
    },
    resetJevScheduler: () => {
      instance = null;
    },
  };
});

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import {
  enqueueFileIndexJob,
  FILE_INDEX_JOB_MAX_ATTEMPTS,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import { resetJevScheduler } from "@/lib/files/jev-scheduler";
import { writeVersionChunks } from "@/services/file-index.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
const DOCS = 12;
const STEP_MS = 300_000;
/** Long enough for 12 x 5 attempts at the throttled rate, with room over. */
const OUTAGE_STEPS = (8 * 3_600_000) / STEP_MS;

let ownerId = "";
let workspaceId = "";
let labelId = "";

function evaluator(mode: "dead" | "healthy") {
  const stub = {
    calls: 0,
    async evaluateLabels() {
      stub.calls += 1;
      if (mode === "dead") {
        return {
          ok: false as const,
          chosen: [],
          reason: "status-503",
          latencyMs: 5,
          inputTokens: 10,
          outputTokens: 0,
          costUsd: null,
          generationId: null,
        };
      }
      return {
        ok: true as const,
        chosen: [labelId],
        reason: null,
        latencyMs: 5,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: "0.0001",
        generationId: "gen",
      };
    },
  };
  return stub as unknown as JevLabelEvaluator & { calls: number };
}

async function drain(evaluate: JevLabelEvaluator, maxJobs: number) {
  const now = new Date(clock.ms);
  let processed = 0;
  for (let visited = 0; visited < maxJobs; visited += 1) {
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
      now,
    });
    if (!leased) break;
    const mine = await prisma.fileResource.count({
      where: { id: leased.job.resourceId, workspaceId },
    });
    if (mine === 0) {
      await prisma.fileIndexJob.updateMany({
        where: { id: leased.job.id, leaseOwner: leased.leaseOwner },
        data: {
          state: "QUEUED",
          attempt: { decrement: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      continue;
    }
    await runSuggestionJob(leased, {
      evaluator: evaluate,
      configured: () => true,
    });
    processed += 1;
  }
  return processed;
}

async function failedCount(): Promise<number> {
  return prisma.fileIndexJob.count({
    where: {
      pipeline: FileIndexJobPipeline.SUGGEST,
      state: "FAILED",
      resource: { workspaceId },
    },
  });
}

async function labelCount(): Promise<number> {
  return prisma.fileLabel.count({ where: { resource: { workspaceId } } });
}

describe.skipIf(!enabled)(
  "a provider outage must not permanently unlabel the backlog",
  () => {
    const outage = { dispatches: 0, failedJobs: 0, labels: 0 };
    const recovery = { processed: 0, calls: 0, labels: 0, failedJobs: 0 };

    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Outage owner",
          email: `outage-${suffix}@example.test`,
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
      labelId = (
        await prisma.workspaceLabel.create({
          data: {
            workspaceId,
            kind: FileLabelKind.TAG,
            displayName: "Commuting",
            normalizedName: "commuting",
            description: "About commuting",
          },
          select: { id: true },
        })
      ).id;
      const scope = await ensureEvidenceScope({
        workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: ownerId,
      });
      for (let d = 1; d <= DOCS; d += 1) {
        const name = `doc-${String(d).padStart(3, "0")}.txt`;
        const resource = await prisma.fileResource.create({
          data: {
            workspaceId,
            sourceKind: FileSourceKind.DRIVE_UPLOAD,
            sourceScope: FileSourceScope.USER,
            sourceId: `users/${ownerId}/${name}`,
            ownerUserId: ownerId,
            displayName: name,
            normalizedName: name,
            mimeType: "text/plain",
            lifecycle: FileResourceLifecycle.ACTIVE,
            versions: {
              create: {
                revision: 1,
                objectKey: name,
                extractionState: "INDEXED",
                extractionCoverage: 1,
              },
            },
          },
          select: { id: true, versions: { select: { id: true } } },
        });
        await writeVersionChunks({
          versionId: resource.versions[0].id,
          evidenceScopeId: scope.id,
          scopeVersion: 1,
          chunks: chunkExtractedText(`Findings about bicycle commuters ${d}.`),
        });
        await enqueueFileIndexJob({
          resourceId: resource.id,
          pipeline: FileIndexJobPipeline.SUGGEST,
          contentRevision: 1,
          desiredGeneration: 1,
          runAfter: new Date(Date.now() - 1_000),
        });
      }

      // The outage.
      resetJevScheduler();
      const dead = evaluator("dead");
      for (let step = 0; step < OUTAGE_STEPS; step += 1) {
        clock.ms = Date.now() + (step + 1) * STEP_MS;
        await drain(dead, DOCS * 3);
      }
      outage.dispatches = dead.calls;
      outage.failedJobs = await failedCount();
      outage.labels = await labelCount();

      // The provider comes back, and the clock keeps moving.
      resetJevScheduler();
      const healthy = evaluator("healthy");
      for (let tick = 0; tick < 40; tick += 1) {
        clock.ms += 600_000;
        recovery.processed += await drain(healthy, DOCS);
      }
      recovery.calls = healthy.calls;
      recovery.labels = await labelCount();
      recovery.failedJobs = await failedCount();
    }, 1_800_000);

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
     * The premise. Not the defect — spending a bounded number of attempts
     * against a dead provider is the intended behaviour of `093bde2d2`, and
     * the FAILED state with a reason is the improvement it bought.
     */
    it("1. the outage spends the retry budget and leaves a visible state", () => {
      expect(
        outage.dispatches,
        "the provider was not called the expected number of times, so the " +
          "retry budget was not what was exercised",
      ).toBe(DOCS * FILE_INDEX_JOB_MAX_ATTEMPTS);
      expect(outage.failedJobs).toBe(DOCS);
      expect(outage.labels).toBe(0);
    });

    /**
     * FAILS TODAY. Measured: 0 processed, 0 model calls, 0 labels across 40
     * ticks and roughly seven further simulated hours of a healthy provider.
     */
    it("2. a healthy provider eventually labels the documents that waited", () => {
      expect(
        recovery.labels,
        `the provider recovered and ${recovery.failedJobs} of ${DOCS} ` +
          "documents were never looked at again: 40 ticks processed " +
          `${recovery.processed} jobs and made ${recovery.calls} model ` +
          "calls. `leaseNextFileIndexJob` leases QUEUED and expired-LEASED " +
          "only; nothing on a timer requeues a FAILED SUGGEST job. The " +
          "document is permanently unlabelled through the provider " +
          "recovering and through a restart, which is the sentence this " +
          "commit's own message uses for the defect it fixed.",
      ).toBe(DOCS);
    });
  },
);

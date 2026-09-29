/**
 * REPRODUCTION ARTIFACT — a provider failure permanently costs a document
 * its labels, and one bad request costs every document after it.
 *
 * Written by the reviewer, not the implementer. This is the failing evidence
 * a fix has to satisfy; it contains no fix and touches no product code.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts
 *
 * The CI step's substring filter picks it up with no further wiring.
 *
 * **Two defects, one line apart.**
 *
 * 1. `file-suggestions.service.ts`, the `if (!verdict.ok)` ending, calls
 *    `completeFileIndexJob`. A dispatched call that the provider failed is
 *    recorded as the document being done, with zero labels and a null
 *    `lastError`. Nothing re-leases a SUCCEEDED job, so the loss is terminal
 *    in the database and survives a restart. Twenty lines above it, the
 *    admission-denied branch carries a comment saying this exact bug was
 *    found and fixed for the capacity case.
 *
 * 2. `jev-client.ts` latches the whole process off on any HTTP 400 or 422,
 *    permanently, which makes `isJevConfigured()` false, which sends every
 *    later document down the `model-disabled` branch — also
 *    `completeFileIndexJob`. So one malformed request converts every
 *    document processed afterwards into a document recorded as having no
 *    labels.
 *
 * **Measured on PostgreSQL 18.6 against the branch at 535b933c4**, 30
 * documents, one workspace label, a stubbed Gateway:
 *
 *   as shipped                 : 1 dispatched call, breaker never opens,
 *                                30x SUCCEEDED/attempt1/labels0,
 *                                0/30 recover when the provider returns
 *   latch deleted only         : breaker opens after 20 calls,
 *                                20x SUCCEEDED/labels0 + 10x QUEUED/attempt0,
 *                                10/30 recover
 *   latch deleted + fail rule  : breaker opens after 20 calls,
 *                                30x QUEUED, 30/30 recover
 *
 * and for one transient 503 on a single document:
 *
 *   as shipped : state=SUCCEEDED attempt=1 labels=0 lastError=null
 *                completedAt=set — and it never gets another chance
 *   with rule  : state=QUEUED attempt=1 lastError=status-503 — and it
 *                recovers on the next tick
 *
 * **Cases 1 to 5, 7 and 8 fail today. Cases 6 and 9 pass today and must keep
 * passing** — 6 because a genuine verdict about a document should complete, and
 * 9 because it is the control that says the defect is the failure branch and
 * not the fixture.
 */
import { randomUUID } from "node:crypto";
import {
  FileIndexJobPipeline,
  FileIndexJobState,
  FileLabelKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The real Gateway client is used deliberately — `fetch` is stubbed rather
 * than the evaluator injected, because the latch lives inside the client and
 * an injected evaluator would bypass the defect under test.
 */
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    AI_GATEWAY_API_KEY: "test-key",
    FILES_JEV_ENABLED: true,
    INSTANCE_ID: "instance-under-test",
    BLOB_READ_WRITE_TOKEN: undefined,
  }),
}));
vi.mock("@sentry/node", () => ({
  captureMessage: () => {},
  captureException: () => {},
}));

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import {
  enqueueFileIndexJob,
  FILE_INDEX_JOB_MAX_ATTEMPTS,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import {
  buildJevLabelRequest,
  isJevRequestRejection,
  LABEL_EVALUATION_CEILINGS,
} from "@/lib/files/jev-request";
import { getJevScheduler, resetJevScheduler } from "@/lib/files/jev-scheduler";
import {
  processFileSuggestionJobs,
  runSuggestionJob,
  SUGGESTION_VOCABULARY_MAX,
} from "@/services/file-suggestions.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";

/** How the stubbed Gateway behaves. Flipped between phases. */
let mode: "reject400" | "fail503" | "ok" | "declines" = "ok";
let fetches = 0;

function installFetch() {
  vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
    fetches += 1;
    if (mode === "reject400") {
      // The status the latch treats as fatal. The body is the Gateway's own
      // envelope; `error.param` names the field, which the client never reads.
      return new Response(
        JSON.stringify({
          error: {
            message: "bad",
            type: "invalid_request_error",
            param: "state",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (mode === "fail503") {
      return new Response(
        JSON.stringify({
          error: { message: "down", type: "internal_server_error" },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    const body = JSON.parse(init.body ?? "{}") as {
      questions: Record<string, unknown>;
    };
    // "declines" is a healthy call in which the model says no to every label:
    // a document that was considered and warranted none. It is the state case
    // 7 compares a provider failure against.
    const probability = mode === "declines" ? 0.01 : 0.99;
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(body.questions)) {
      answers[id] = { type: "boolean", probability };
    }
    return new Response(
      JSON.stringify({
        model: "typesafe-ai/jev",
        answers,
        usage: { inputTokens: 10, outputTokens: 2 },
        providerMetadata: { gateway: { cost: "0.0001", generationId: "g" } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

async function seedDoc(name: string, withText = true): Promise<string> {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `users/${ownerId}/${name}`,
      ownerUserId: ownerId,
      displayName: name,
      normalizedName: name,
      lifecycle: FileResourceLifecycle.ACTIVE,
      contentRevision: 1,
    },
    select: { id: true },
  });
  const version = await prisma.fileVersion.create({
    data: {
      resourceId: resource.id,
      revision: 1,
      objectKey: name,
      extractionState: "INDEXED",
    },
    select: { id: true },
  });
  if (withText) {
    const text = `this document ${name} concerns the quarterly reconciliation of the ledger`;
    // `search_vector` is not generated; the indexer writes it and so must this.
    await prisma.$executeRaw(PrismaRaw.sql`
      INSERT INTO file_chunk (id,"createdAt","versionId","chunkId",ordinal,text,
        "evidenceScopeId","scopeVersion","inputDigest",search_vector)
      VALUES (gen_random_uuid(), now(), ${version.id}::uuid, 'c1', 1, ${text},
        ${scopeId}::uuid, 1, 'repro', to_tsvector('simple', ${text}))`);
  }
  await enqueueFileIndexJob({
    resourceId: resource.id,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision: 1,
    runAfter: new Date(Date.now() - 1_000),
  });
  return resource.id;
}

async function jobOf(resourceId: string) {
  const job = await prisma.fileIndexJob.findFirstOrThrow({
    where: { resourceId, pipeline: FileIndexJobPipeline.SUGGEST },
    orderBy: { desiredGeneration: "desc" },
    select: { state: true, attempt: true, lastError: true, completedAt: true },
  });
  const labels = await prisma.fileLabel.count({ where: { resourceId } });
  return { ...job, labels };
}

/**
 * Lease one SUGGEST job and run it, pausing so the background rate bucket
 * refills. `GLOBAL_BURST_CAPACITY * (1 - INTERACTIVE_RESERVED_FRACTION)` is
 * 3 tokens at 12/s, so without a pause the loop self-throttles and the
 * breaker never receives a sample.
 */
async function tick() {
  /**
   * `leaseNextFileIndexJob` takes a pipeline and nothing else — no workspace
   * filter — so it hands back the globally oldest runnable SUGGEST job. Two
   * suites draining this queue against one database therefore steal each
   * other's work, and CI runs the PostgreSQL files in parallel workers. This
   * loop keeps the real lease for its own jobs and puts anybody else's back
   * exactly as it found it.
   *
   * `deferFileIndexJob` is deliberately not used for the hand-back: it also
   * pushes `runAfter` thirty seconds out, which would disturb the suite the
   * job belongs to.
   */
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    if (!leased) return null;

    const mine = await prisma.fileResource.count({
      where: { id: leased.job.resourceId, workspaceId },
    });
    if (mine === 0) {
      await prisma.fileIndexJob.updateMany({
        where: { id: leased.job.id, leaseOwner: leased.leaseOwner },
        data: {
          state: FileIndexJobState.QUEUED,
          attempt: { decrement: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }

    const before = fetches;
    const outcome = await runSuggestionJob(leased);
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      resourceId: leased.job.resourceId,
      outcome,
      dispatched: fetches > before,
    };
  }
  return null;
}

/**
 * Deferred and failed jobs carry a `runAfter` in the future. Pulling it
 * forward stands in for the backoff elapsing, so the test does not sleep
 * for the real 30 s / 60 s.
 */
async function elapseBackoff(resourceIds: string[]) {
  await prisma.fileIndexJob.updateMany({
    where: { resourceId: { in: resourceIds }, state: FileIndexJobState.QUEUED },
    data: { runAfter: new Date(Date.now() - 1_000) },
  });
}

describe.skipIf(!enabled)(
  "a provider failure must not cost a document its labels",
  () => {
    beforeAll(async () => {
      installFetch();
      const owner = await prisma.user.create({
        data: {
          name: "Jev repro owner",
          email: `jev-repro-${suffix}@example.test`,
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
          kind: FileLabelKind.TAG,
          displayName: "Finance",
          normalizedName: "finance",
          description: "Financial documents",
        },
      });
    }, 120_000);

    afterAll(async () => {
      vi.unstubAllGlobals();
      // The scheduler is a module singleton and the latch is module state;
      // both outlive this file inside a worker. Cases 2 and 3 deliberately
      // open the breaker, so leaving it open would deny admission in
      // whatever suite ran next.
      resetJevScheduler();
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    /**
     * FAILS TODAY. Measured: state=SUCCEEDED attempt=1 labels=0
     * lastError=null completedAt=set, and no later tick ever leases it.
     */
    it("1. one transient 503 does not cost the document its labels", async () => {
      resetJevScheduler();
      mode = "fail503";
      const id = await seedDoc(`c1-${suffix}`);

      const first = await tick();
      expect(first?.dispatched, "the call must actually have gone out").toBe(
        true,
      );

      const afterFailure = await jobOf(id);
      expect(
        afterFailure.state,
        `one 503 recorded the document as ${afterFailure.state} with ` +
          `${afterFailure.labels} labels and lastError=${afterFailure.lastError}; ` +
          "nothing re-leases a SUCCEEDED job, so the loss is permanent",
      ).not.toBe(FileIndexJobState.SUCCEEDED);

      // The provider recovers at once.
      mode = "ok";
      resetJevScheduler();
      await elapseBackoff([id]);
      for (let k = 0; k < 6; k += 1) if (!(await tick())) break;

      const recovered = await jobOf(id);
      expect(
        recovered.labels,
        "after the provider recovered the document still has no labels",
      ).toBeGreaterThan(0);
    }, 300_000);

    /**
     * FAILS TODAY. Measured: 1 dispatched call latches the process, the
     * other 29 documents take the `model-disabled` branch without a call,
     * and all 30 end SUCCEEDED with zero labels.
     */
    it("2. a rejecting provider does not record 30 documents as done", async () => {
      resetJevScheduler();
      mode = "reject400";
      const ids: string[] = [];
      for (let d = 1; d <= 30; d += 1) {
        ids.push(await seedDoc(`c2-${d}-${suffix}`));
      }

      let dispatched = 0;
      for (let k = 0; k < 40; k += 1) {
        const t = await tick();
        if (!t) break;
        if (t.dispatched) dispatched += 1;
        if (getJevScheduler().isBreakerOpen()) break;
      }

      const settled: string[] = [];
      for (const id of ids) {
        const row = await jobOf(id);
        if (row.state === FileIndexJobState.SUCCEEDED && row.labels === 0) {
          settled.push(id);
        }
      }

      expect(
        settled.length,
        `${settled.length} of ${ids.length} documents were recorded SUCCEEDED ` +
          `with zero labels after ${dispatched} dispatched call(s). A provider ` +
          "refusal is not a verdict about a document.",
      ).toBe(0);
    }, 600_000);

    /**
     * FAILS TODAY. Measured: 0/30 recover as shipped, 10/30 with the latch
     * deleted alone. This is the case that says the two changes land
     * together or neither does.
     */
    it("3. every document gets its labels once the provider recovers", async () => {
      resetJevScheduler();
      mode = "reject400";
      const ids: string[] = [];
      for (let d = 1; d <= 30; d += 1) {
        ids.push(await seedDoc(`c3-${d}-${suffix}`));
      }
      for (let k = 0; k < 40; k += 1) {
        const t = await tick();
        if (!t) break;
        if (getJevScheduler().isBreakerOpen()) break;
      }

      mode = "ok";
      resetJevScheduler();
      // Several passes, because the breaker half-opens and the deferral
      // backoff has to elapse more than once.
      for (let pass = 0; pass < 6; pass += 1) {
        resetJevScheduler();
        await elapseBackoff(ids);
        for (let k = 0; k < 40; k += 1) if (!(await tick())) break;
      }

      const withLabels = await prisma.fileLabel.groupBy({
        by: ["resourceId"],
        where: { resourceId: { in: ids } },
      });
      expect(
        withLabels.length,
        `only ${withLabels.length} of ${ids.length} documents have labels after ` +
          "the provider recovered; the rest were already recorded as done",
      ).toBe(ids.length);
    }, 900_000);

    /**
     * FAILS TODAY, for a different reason from the rest: the job never
     * reaches a second attempt at all. Measured on the unmodified tree,
     * attempt 1 ends SUCCEEDED and attempt 2 is not leasable.
     */
    it("4. repeated provider failure ends FAILED with the reason recorded", async () => {
      resetJevScheduler();
      mode = "fail503";
      const id = await seedDoc(`c4-${suffix}`);

      const seen: string[] = [];
      for (
        let attempt = 1;
        attempt <= FILE_INDEX_JOB_MAX_ATTEMPTS + 2;
        attempt += 1
      ) {
        resetJevScheduler();
        await elapseBackoff([id]);
        const t = await tick();
        if (!t) break;
        const row = await jobOf(id);
        seen.push(`${row.state}/attempt${row.attempt}`);
        if (row.state === FileIndexJobState.FAILED) break;
      }

      const final = await jobOf(id);
      expect(
        final.state,
        `attempts observed: ${seen.join(" -> ")}. A document a provider ` +
          "repeatedly failed must end FAILED, not SUCCEEDED",
      ).toBe(FileIndexJobState.FAILED);
      expect(final.attempt).toBe(FILE_INDEX_JOB_MAX_ATTEMPTS);
      expect(
        final.lastError,
        "FAILED with no lastError leaves nothing for anyone to read",
      ).not.toBeNull();
    }, 600_000);

    /**
     * FAILS TODAY. `result.failed` is incremented only in the catch block
     * for a thrown error, so a dispatched provider failure is reported as
     * an ordinary processed document and the sync line reads clean through
     * an outage.
     */
    it("5. the tick reports a dispatched failure as failed, not processed", async () => {
      resetJevScheduler();
      mode = "fail503";
      const id = await seedDoc(`c5-${suffix}`);
      await elapseBackoff([id]);

      /**
       * `processFileSuggestionJobs` is the cron entry point and takes no
       * workspace filter, so it may pick up another suite's job first. The
       * loop runs until this document's job has been attempted and sums what
       * the ticks reported. A neighbour's failure would also raise `failed`,
       * which is a small risk of a false pass; it cannot cause a false
       * failure, because before the fix `failed` is zero however many passes
       * run.
       */
      let failed = 0;
      let processed = 0;
      for (let pass = 0; pass < 20; pass += 1) {
        await elapseBackoff([id]);
        const result = await processFileSuggestionJobs({
          shouldContinue: () => true,
          maxJobs: 5,
        });
        failed += result.failed;
        processed += result.processed;
        const row = await jobOf(id);
        if (row.attempt > 0 && row.state !== FileIndexJobState.LEASED) break;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      expect(
        failed,
        `the ticks reported processed=${processed} failed=${failed} for a ` +
          "document the provider failed, so the sync line reads clean through " +
          "an outage",
      ).toBeGreaterThanOrEqual(1);
    }, 300_000);

    /**
     * PASSES TODAY and must keep passing. These endings are genuine
     * verdicts about the document, not provider failures, so they complete.
     *
     * `isJevRequestRejection` is the ending Patrick named, and it is
     * currently **unreachable** on this path: with the worst legal
     * shortlist — `SUGGESTION_VOCABULARY_MAX` labels at maximum name and
     * description length, against a 500,000-character excerpt — the request
     * measures under the 16,000 ceiling. The assertion below
     * pins that, so if the vocabulary cap or the ceiling moves and the
     * branch becomes live, this test says so and the branch gets its own
     * case rather than being assumed covered.
     */
    it("6. a genuine verdict about the document still completes the job", async () => {
      resetJevScheduler();
      mode = "ok";

      // A document with no extracted text: nothing to judge, and re-running
      // it would reach the same answer forever.
      const noText = await seedDoc(`c6-notext-${suffix}`, false);
      await elapseBackoff([noText]);
      const t = await tick();
      expect(t?.outcome.skipped).toBe("no-text");
      const row = await jobOf(noText);
      expect(row.state).toBe(FileIndexJobState.SUCCEEDED);
      expect(row.labels).toBe(0);

      // And the request-rejection ending is still out of reach at the
      // shipped constants, so nothing here depends on it.
      const worst = buildJevLabelRequest({
        documentExcerpt: "x".repeat(500_000),
        vocabulary: Array.from(
          { length: SUGGESTION_VOCABULARY_MAX },
          (_, i) => ({
            id: `33333333-3333-3333-3333-3333333333${String(i).padStart(2, "0")}`,
            name: "N".repeat(200),
            description: "D".repeat(2_000),
          }),
        ),
        projects: [],
      });
      expect(
        isJevRequestRejection(worst),
        `the worst legal shortlist now exceeds ${LABEL_EVALUATION_CEILINGS.total} ` +
          "tokens, so the request-rejection ending has become reachable and " +
          "needs a case of its own",
      ).toBe(false);
    }, 300_000);

    /**
     * FAILS TODAY, and this is the assertion that says why it matters rather
     * than that it happens. Two documents, one whose dispatch the provider
     * failed and one the model considered and declined, are compared field by
     * field. Measured: both read
     * `SUCCEEDED / attempt 1 / lastError null / completedAt set / 0 labels`.
     * Nothing in the row distinguishes lost work from a considered answer, so
     * no query, dashboard or support conversation can either.
     */
    it("7. a failed dispatch is distinguishable from a declined document", async () => {
      resetJevScheduler();

      mode = "declines";
      const declined = await seedDoc(`c7-declined-${suffix}`);
      await elapseBackoff([declined]);
      const declinedTick = await tick();
      expect(declinedTick?.dispatched).toBe(true);

      resetJevScheduler();
      mode = "fail503";
      const failed = await seedDoc(`c7-failed-${suffix}`);
      await elapseBackoff([failed]);
      const failedTick = await tick();
      expect(failedTick?.dispatched).toBe(true);

      const declinedRow = await jobOf(declined);
      const failedRow = await jobOf(failed);
      const shape = (row: typeof declinedRow) =>
        `state=${row.state} attempt=${row.attempt} ` +
        `lastError=${row.lastError ?? "null"} ` +
        `completedAt=${row.completedAt ? "set" : "null"} labels=${row.labels}`;

      expect(
        shape(failedRow),
        "the document whose dispatch failed and the document the model " +
          "declined have identical job rows, so nothing can tell lost work " +
          `from a considered answer. declined: ${shape(declinedRow)}`,
      ).not.toBe(shape(declinedRow));
    }, 300_000);

    /**
     * FAILS TODAY. The state is terminal, and this drives the real cron entry
     * point rather than the single-job helper to say so. Measured: after the
     * 503, twenty `processFileSuggestionJobs` passes against a healthy
     * provider leased the document zero times, because
     * `enqueueFileIndexJob` deliberately leaves SUCCEEDED rows alone and
     * nothing else re-enqueues a SUGGEST job on a timer.
     */
    it("8. the cron retries a document whose dispatch failed", async () => {
      resetJevScheduler();
      mode = "fail503";
      const id = await seedDoc(`c8-${suffix}`);
      await elapseBackoff([id]);
      const first = await tick();
      expect(first?.dispatched).toBe(true);

      // The provider is healthy again, and this is what /sync/drive-index runs.
      mode = "ok";
      let leasedSomething = 0;
      for (let pass = 0; pass < 20; pass += 1) {
        resetJevScheduler();
        await elapseBackoff([id]);
        const result = await processFileSuggestionJobs({
          shouldContinue: () => true,
          maxJobs: 5,
        });
        leasedSomething += result.processed + result.failed + result.deferred;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      const row = await jobOf(id);
      expect(
        row.labels,
        `after 20 cron passes against a healthy provider the document still ` +
          `has ${row.labels} labels and reads ${row.state}; the drains leased ` +
          `${leasedSomething} job(s) in total. A SUCCEEDED row is never ` +
          "re-leased and nothing re-enqueues a SUGGEST job on a timer, so the " +
          "loss survives the provider recovering and survives a restart.",
      ).toBeGreaterThan(0);
    }, 600_000);

    /**
     * PASSES TODAY and must keep passing. The control: when the dispatch
     * succeeds the document gets its labels through the same path, so cases 1,
     * 7 and 8 are about the failure branch and not about the fixture, the
     * stub or the actor.
     */
    it("9. a document whose dispatch succeeds gets its labels", async () => {
      resetJevScheduler();
      mode = "ok";
      const id = await seedDoc(`c9-${suffix}`);
      await elapseBackoff([id]);

      const t = await tick();
      expect(t?.dispatched).toBe(true);
      expect(t?.outcome.suggested).toBeGreaterThan(0);

      const row = await jobOf(id);
      expect(row.state).toBe(FileIndexJobState.SUCCEEDED);
      expect(row.labels).toBeGreaterThan(0);
    }, 300_000);
  },
);

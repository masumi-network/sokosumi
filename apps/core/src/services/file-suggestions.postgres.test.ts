import { randomUUID } from "node:crypto";

import {
  FileIndexJobPipeline,
  FileLabelKind,
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import {
  enqueueFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import { getJevScheduler } from "@/lib/files/jev-scheduler";
import { writeVersionChunks } from "@/services/file-index.service";
import { updateFileMetadata } from "@/services/file-metadata.service";
import {
  processFileSuggestionJobs,
  runSuggestionJob,
  SUGGESTION_VOCABULARY_MAX,
} from "@/services/file-suggestions.service";

/**
 * Does the suggestion pipeline actually suggest anything?
 *
 * It did not, and nothing said so. The prepared epoch was computed for an
 * empty actor while `admitJevRequest` recomputed it for the resource owner;
 * `resolveScopeEpoch` hashes both fields, so admission was denied for every
 * owned resource — which is every resource. The job still completed as a
 * success with `suggested: 0`, so no retry, no alert, no failing test: there
 * was no test.
 *
 * Only a real database can catch it. The epoch is a hash over rows, and the
 * admission is a row; with Prisma mocked, both sides of the mismatch
 * disappear. So this is an opt-in Postgres suite like the others.
 *
 * Jev itself is always a stub. Nothing here calls a provider.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";
let labelId = "";
let resourceId = "";

/** Says yes to every label it is asked about, in one call. */
function evaluatorChoosing(
  chosen: "all" | "none",
): JevLabelEvaluator & { calls: number; lastLabelCount: number } {
  const stub = {
    calls: 0,
    lastLabelCount: 0,
    async evaluateLabels(input: {
      labels: readonly {
        id: string;
        name: string;
        description: string | null;
      }[];
    }) {
      stub.calls += 1;
      stub.lastLabelCount = input.labels.length;
      return {
        ok: true,
        chosen: chosen === "all" ? input.labels.map((label) => label.id) : [],
        reason: null,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: "0.0001",
        generationId: "gen-test",
      };
    },
  };
  return stub as unknown as JevLabelEvaluator & {
    calls: number;
    lastLabelCount: number;
  };
}

/** Enqueued through the real helper, so the dedupe key is the real one. */
async function queueSuggestionJob(generation: number): Promise<void> {
  await enqueueFileIndexJob({
    resourceId,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision: 1,
    // A fresh generation each time, so repeated runs are separate jobs
    // rather than one deduped row.
    desiredGeneration: generation,
    runAfter: new Date(Date.now() - 1_000),
  });
}

describe.skipIf(!enabled)("the suggestion pipeline against PostgreSQL", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Suggestion owner",
        email: `suggest-owner-${suffix}@example.test`,
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

    const scope = await ensureEvidenceScope({
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: ownerId,
    });
    scopeId = scope.id;

    const label = await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.TAG,
        displayName: "Commuting",
        normalizedName: "commuting",
        description: "Documents about commuting",
      },
      select: { id: true },
    });
    labelId = label.id;

    const resource = await prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: `drive/users/${ownerId}/commuters.txt`,
        // The owner is the whole point: an owned resource is what the epoch
        // mismatch denied, and every real resource is owned.
        ownerUserId: ownerId,
        displayName: "commuters.txt",
        normalizedName: "commuters.txt",
        mimeType: "text/plain",
        lifecycle: FileResourceLifecycle.ACTIVE,
        versions: {
          create: {
            revision: 1,
            objectKey: `drive/users/${ownerId}/commuters.txt`,
            mimeType: "text/plain",
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
  });

  afterEach(async () => {
    await prisma.fileLabel.deleteMany({ where: { resourceId } });
    // Tombstones outlive label rows by design — that is what makes a veto
    // durable — so they have to be swept here or one test's veto silently
    // bars the next test's suggestion.
    await prisma.fileFieldOverride.deleteMany({ where: { resourceId } });
    await prisma.fileIndexJob.deleteMany({ where: { resourceId } });
    await prisma.fileAuthorizationAdmission.deleteMany({
      where: { workspaceId },
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

  it("writes a suggestion row for an owned resource", async () => {
    await queueSuggestionJob(1);
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    const evaluator = evaluatorChoosing("all");
    const outcome = await runSuggestionJob(leased, {
      evaluator,
      configured: () => true,
    });

    // The bug: admission was denied, so the evaluator was never called and
    // the job reported a clean zero.
    expect(evaluator.calls).toBeGreaterThan(0);
    expect(outcome.skipped).toBeNull();
    expect(outcome.suggested).toBe(1);

    const rows = await prisma.fileLabel.findMany({
      where: { resourceId },
      select: { labelId: true, state: true, evidenceSnippet: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].labelId).toBe(labelId);
    expect(rows[0].state).toBe(FileMetadataState.SUGGESTED);
    // The evidence is an extracted span, never a generated explanation.
    expect(rows[0].evidenceSnippet).toContain("commuters");
  });

  it("suggests nothing when the model says no", async () => {
    await queueSuggestionJob(2);
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    if (!leased) throw new Error("expected a job");

    const outcome = await runSuggestionJob(leased, {
      evaluator: evaluatorChoosing("none"),
      configured: () => true,
    });

    expect(outcome.suggested).toBe(0);
    await expect(
      prisma.fileLabel.count({ where: { resourceId } }),
    ).resolves.toBe(0);
  });

  it("asks about every candidate label in one call", async () => {
    // Two labels in the workspace, so a per-label loop would make two
    // requests. It must make one, carrying both.
    const second = await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.TAG,
        displayName: "Cycling",
        normalizedName: "cycling",
        description: "Documents about cycling",
      },
      select: { id: true },
    });

    try {
      await queueSuggestionJob(50);
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      if (!leased) throw new Error("expected a job");

      const evaluator = evaluatorChoosing("all");
      const outcome = await runSuggestionJob(leased, {
        evaluator,
        configured: () => true,
      });

      expect(evaluator.calls).toBe(1);
      expect(evaluator.lastLabelCount).toBe(2);
      expect(outcome.suggested).toBe(2);

      // One admission for one request, not one per label.
      await expect(
        prisma.fileAuthorizationAdmission.count({ where: { workspaceId } }),
      ).resolves.toBe(1);
    } finally {
      await prisma.fileLabel.deleteMany({ where: { resourceId } });
      await prisma.workspaceLabel.deleteMany({ where: { id: second.id } });
    }
  });

  it("leaves a document untouched when capacity refuses it", async () => {
    // A capacity refusal is not a verdict about the document. This path
    // called `completeFileIndexJob`, so the job was recorded as SUCCEEDED
    // with zero suggestions and never retried — the document silently never
    // labelled — while the tick reported `{processed: 1, suggested: 0,
    // failed: 0}`, which reads as a healthy minute. The scheduler's own
    // refusal had the opposite bug: `failFileIndexJob` burns one of five
    // attempts, so five capacity refusals fail the document permanently.
    //
    // Both should leave it exactly as it was, and be visible as a deferral.
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE, resetJevScheduler } =
      await import("@/lib/files/jev-scheduler");

    /**
     * Start from a full bucket, because this case asserts *which* refusal
     * happened and not merely that one did.
     *
     * The scheduler is a module-level singleton and background work gets a
     * burst of three, so by the time this test runs the earlier ones in
     * this file may have spent it. `tryAdmit` is checked before
     * `admitJevRequest`, so an empty bucket makes the run stop at
     * `quota:background-share` and never reach the ledger branch under
     * test. Caught in CI, where it read as
     * `expected 'quota:background-share' to be 'admission-denied'` — a
     * latent order-and-timing dependency, not a defect in the code.
     *
     * The test below this one sleeps 300ms for the same hazard and says
     * so. A reset is the same statement without the timing.
     */
    resetJevScheduler();

    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId,
        actorFingerprint: "another-runtime",
        epochVector: "whatever",
        purpose: "label-suggest",
        payloadDigest: "spent-for-defer",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
        admittedAt: new Date(),
        expiresAt: new Date(Date.now() + 50),
      },
    });

    try {
      await queueSuggestionJob(500);
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      if (!leased) throw new Error("expected a job");

      const attemptOnLease = leased.job.attempt;
      const outcome = await runSuggestionJob(leased, {
        evaluator: evaluatorChoosing("all"),
        configured: () => true,
      });
      expect(outcome.skipped).toBe("admission-denied");
      expect(outcome.deferred).toBe(true);

      const after = await prisma.fileIndexJob.findUnique({
        where: { id: leased.job.id },
        select: { state: true, attempt: true, runAfter: true },
      });

      // Queued again, not finished.
      expect(after?.state).toBe("QUEUED");
      // And the refusal cost it nothing: the lease's increment is given
      // back, so a run of refusals cannot exhaust the attempt budget.
      expect(after?.attempt).toBe(attemptOnLease - 1);
      // Held back briefly rather than spun on.
      expect(after?.runAfter.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
    }
  });

  it("reports a deferral separately from a document with nothing to suggest", async () => {
    // `{processed: 1, suggested: 0, failed: 0}` is what a refused document
    // and an ordinary document with no matching labels both used to look
    // like. A reader of the tick could not tell a capacity problem from a
    // quiet minute.
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE } = await import(
      "@/lib/files/jev-scheduler"
    );
    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId,
        actorFingerprint: "another-runtime",
        epochVector: "whatever",
        purpose: "label-suggest",
        payloadDigest: "spent-for-tick",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
        admittedAt: new Date(),
        expiresAt: new Date(Date.now() + 50),
      },
    });

    try {
      await queueSuggestionJob(600);
      const tick = await processFileSuggestionJobs({
        shouldContinue: () => true,
        maxJobs: 1,
        dependencies: {
          evaluator: evaluatorChoosing("all"),
          configured: () => true,
        },
      });

      expect(tick.deferred).toBe(1);
      expect(tick.suggested).toBe(0);
      expect(tick.failed).toBe(0);
    } finally {
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
    }
  });

  it("does not report a local denial to the provider breaker", async () => {
    // A denied admission is our decision, not the provider's. Counting it as
    // a provider failure opened the breaker during a run that never reached
    // the network, and that degrades interactive search reranking.
    //
    // The previous version of this test proved none of that. It used an
    // evaluator that succeeds and an admission that is granted, so
    // `release()` was never reached in any iteration; swapping it back to
    // `settle("failed")` — the exact pre-fix behaviour named in the comment
    // — left the suite green. It also ran 12 iterations against a 20-sample
    // window, so the breaker could not have opened however the outcomes
    // were classified. Two ways of asserting nothing at once.
    //
    // So: force the denial through the shared ceiling, assert every
    // iteration actually took that branch, and run past the sample window.
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE } = await import(
      "@/lib/files/jev-scheduler"
    );
    const { BREAKER_SAMPLE_SIZE } = await import("@/lib/files/jev-scheduler");

    const scheduler = getJevScheduler();
    const iterations = BREAKER_SAMPLE_SIZE + 2;
    const skipped: (string | null | undefined)[] = [];

    for (let attempt = 0; attempt < iterations; attempt += 1) {
      // Let the in-memory per-second bucket refill. Background work gets a
      // burst of three, so without this the fourth iteration onwards is
      // refused by `tryAdmit` before it ever reaches the admission — which
      // is a different branch, and would make this test vacuous again in a
      // new way. The assertion below is what caught that, twice: the first
      // iteration needs it too, because the scheduler is a module-level
      // singleton and earlier tests in this file have already spent the
      // burst.
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Spend the workspace's shared minute in the database. The in-memory
      // scheduler keeps its own window, so `tryAdmit` still passes and the
      // run reaches `admitJevRequest`, which is the branch under test.
      await prisma.fileAuthorizationAdmission.create({
        data: {
          workspaceId,
          actorFingerprint: "another-runtime",
          epochVector: "whatever",
          purpose: "label-suggest",
          payloadDigest: `spent-${attempt}`,
          provider: "vercel-ai-gateway",
          model: "typesafe-ai/jev",
          inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
          admittedAt: new Date(),
          expiresAt: new Date(Date.now() + 50),
        },
      });

      await queueSuggestionJob(100 + attempt);
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      if (!leased) throw new Error("expected a job");
      const outcome = await runSuggestionJob(leased, {
        evaluator: evaluatorChoosing("all"),
        configured: () => true,
      });
      skipped.push(outcome.skipped);
      await prisma.fileLabel.deleteMany({ where: { resourceId } });
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
    }

    // The assertion that stops this going vacuous again: the denial has to
    // have actually happened, every time, or the breaker staying shut means
    // nothing.
    expect(skipped).toEqual(
      Array.from({ length: iterations }, () => "admission-denied"),
    );
    expect(scheduler.isBreakerOpen()).toBe(false);
  }, 60_000);
  it("asks about a category in a workspace already full of tags", async () => {
    /**
     * The starvation, end to end against a real database, because the
     * cause is Postgres enum ordering and no unit test can see it.
     *
     * The shortlist was one query, `ORDER BY kind ASC, normalizedName
     * ASC` with `take: 30`. Postgres orders an enum by *declaration*
     * order, and `FileLabelKind` declares `TAG` before `CATEGORY` — so
     * tags filled the window, and a workspace with 30 or more tags sent
     * zero categories to the evaluator. It could never receive a category
     * suggestion again, and the reader saw "Uncategorized", which is also
     * what a document the model considered and declined looks like.
     *
     * Nothing caps label creation, so a workspace reaches this by doing
     * what the product invites.
     *
     * Thirty tags is exactly the window, so before the fix the category
     * below was not merely outranked — there was no room for it at all.
     */
    for (let index = 0; index < 30; index += 1) {
      await prisma.workspaceLabel.create({
        data: {
          workspaceId,
          kind: FileLabelKind.TAG,
          // Named so they sort before the category would have, had the
          // ordering been alphabetical rather than by declaration.
          displayName: `Aaa tag ${index}`,
          normalizedName: `aaa-tag-${String(index).padStart(3, "0")}`,
          description: null,
        },
      });
    }
    const category = await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.CATEGORY,
        displayName: "Zzz travel reports",
        normalizedName: "zzz-travel-reports",
        description: "Reports about travel",
      },
      select: { id: true },
    });

    await queueSuggestionJob(1);
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    const asked: string[] = [];
    const evaluator = {
      async evaluateLabels(input: {
        labels: readonly { id: string; name: string }[];
      }) {
        asked.push(...input.labels.map((label) => label.id));
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

    const outcome = await runSuggestionJob(leased, {
      evaluator,
      configured: () => true,
    });

    // The assertion that was false before today.
    expect(asked).toContain(category.id);
    // And the window is still respected, so this cannot be passing by
    // asking about everything.
    expect(asked.length).toBeLessThanOrEqual(SUGGESTION_VOCABULARY_MAX);
    // Tags were cut to make room, and that is now said rather than
    // inferred from a count nobody compares.
    expect(outcome.vocabularyTruncated).toBe("tags");
  });

  /**
   * The veto and the way back out of it.
   *
   * Removing a tag writes a durable `fileFieldOverride` tombstone, and
   * `runSuggestionJob` reads those overrides and drops the label from the
   * shortlist. That half already worked. What did not exist was any way to
   * undo it: the only two things in the product that deleted a REJECT row were
   * `addTagLabelIds` — which also asserts the tag as CONFIRMED/MANUAL, so it
   * is an assignment and not a withdrawal — and clearing the category, which
   * deletes every category override on the resource regardless of decision.
   * Both live in the manual assign surface being removed, so removing it made
   * a wrong Remove permanent.
   *
   * **Its own workspace, deliberately.** A sibling case in this file fills the
   * shared workspace with thirty tags to prove the shortlist allocation, and
   * the shortlist window is thirty. Sharing the fixture meant these cases ran
   * against a starved vocabulary and their own label never reached the model —
   * and because `-t` skips the sibling, they passed alone and failed in the
   * suite. Isolated, the only labels here are the four these cases create.
   */
  describe("withdrawing a veto", () => {
    let vetoOwnerId = "";
    let vetoWorkspaceId = "";
    let vetoScopeId = "";
    let vetoResourceId = "";
    let tagA = "";
    let tagB = "";
    let categoryA = "";
    let categoryB = "";

    const actor = () => ({
      userId: vetoOwnerId,
      organizationId: null,
      kind: "interactive" as const,
    });

    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Veto owner",
          email: `veto-owner-${suffix}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      vetoOwnerId = owner.id;

      const workspace = await prisma.workspace.create({
        data: { userId: vetoOwnerId },
        select: { id: true },
      });
      vetoWorkspaceId = workspace.id;

      const scope = await ensureEvidenceScope({
        workspaceId: vetoWorkspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: vetoOwnerId,
      });
      vetoScopeId = scope.id;

      const labels = await Promise.all(
        [
          { kind: FileLabelKind.TAG, name: "Commuting" },
          { kind: FileLabelKind.TAG, name: "Cycling" },
          { kind: FileLabelKind.CATEGORY, name: "Report or analysis" },
          { kind: FileLabelKind.CATEGORY, name: "Meeting notes" },
        ].map((entry) =>
          prisma.workspaceLabel.create({
            data: {
              workspaceId: vetoWorkspaceId,
              kind: entry.kind,
              displayName: entry.name,
              normalizedName: entry.name.toLowerCase(),
              description: `Documents about ${entry.name.toLowerCase()}`,
            },
            select: { id: true },
          }),
        ),
      );
      [tagA, tagB, categoryA, categoryB] = labels.map((label) => label.id);

      const resource = await prisma.fileResource.create({
        data: {
          workspaceId: vetoWorkspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: `drive/users/${vetoOwnerId}/veto.txt`,
          ownerUserId: vetoOwnerId,
          displayName: "veto.txt",
          normalizedName: "veto.txt",
          mimeType: "text/plain",
          lifecycle: FileResourceLifecycle.ACTIVE,
          versions: {
            create: {
              revision: 1,
              objectKey: `drive/users/${vetoOwnerId}/veto.txt`,
              mimeType: "text/plain",
              extractionState: "INDEXED",
              extractionCoverage: 1,
            },
          },
        },
        select: { id: true, versions: { select: { id: true } } },
      });
      vetoResourceId = resource.id;

      await writeVersionChunks({
        versionId: resource.versions[0].id,
        evidenceScopeId: vetoScopeId,
        scopeVersion: 1,
        chunks: chunkExtractedText(
          "Findings about bicycle commuters and their travel patterns.",
        ),
      });
    }, 60_000);

    afterEach(async () => {
      await prisma.fileLabel.deleteMany({
        where: { resourceId: vetoResourceId },
      });
      // Tombstones outlive label rows by design — that is what makes a veto
      // durable — so they have to be swept or one case's veto silently bars
      // the next case's suggestion.
      await prisma.fileFieldOverride.deleteMany({
        where: { resourceId: vetoResourceId },
      });
      await prisma.fileIndexJob.deleteMany({
        where: { resourceId: vetoResourceId },
      });
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId: vetoWorkspaceId },
      });
    });

    afterAll(async () => {
      if (!enabled) return;
      await prisma.fileResource.deleteMany({
        where: { workspaceId: vetoWorkspaceId },
      });
      await prisma.fileEvidenceScope.deleteMany({
        where: { workspaceId: vetoWorkspaceId },
      });
      await prisma.workspaceLabel.deleteMany({
        where: { workspaceId: vetoWorkspaceId },
      });
      await prisma.workspace.deleteMany({ where: { id: vetoWorkspaceId } });
      await prisma.user.deleteMany({ where: { id: vetoOwnerId } });
    });

    /** Run one suggestion job to completion and report what it wrote. */
    async function runOneJob(generation: number): Promise<string[]> {
      await enqueueFileIndexJob({
        resourceId: vetoResourceId,
        pipeline: FileIndexJobPipeline.SUGGEST,
        contentRevision: 1,
        desiredGeneration: generation,
        runAfter: new Date(Date.now() - 1_000),
      });
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      expect(leased).not.toBeNull();
      if (!leased) return [];
      await runSuggestionJob(leased, {
        evaluator: evaluatorChoosing("all"),
        configured: () => true,
      });
      const rows = await prisma.fileLabel.findMany({
        where: {
          resourceId: vetoResourceId,
          state: FileMetadataState.SUGGESTED,
        },
        select: { labelId: true },
      });
      return rows.map((row) => row.labelId);
    }

    async function currentRevision(): Promise<number> {
      const row = await prisma.fileResource.findUniqueOrThrow({
        where: { id: vetoResourceId },
        select: { metadataRevision: true },
      });
      return row.metadataRevision;
    }

    it("bars a removed tag from coming back, and lets a withdrawal re-open it", async () => {
      // The model proposes it once.
      expect(await runOneJob(200)).toContain(tagA);

      // A person removes it. That is a veto: state REJECTED plus a tombstone.
      const removal = await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          removeTagLabelIds: [tagA],
        },
      });
      expect(removal.status).toBe("applied");
      expect(
        await prisma.fileFieldOverride.count({
          where: {
            resourceId: vetoResourceId,
            labelId: tagA,
            decision: "REJECT",
          },
        }),
      ).toBe(1);

      // A re-run must not overrule the person.
      await prisma.fileLabel.deleteMany({
        where: { resourceId: vetoResourceId },
      });
      expect(await runOneJob(201)).not.toContain(tagA);

      // Withdrawing the veto re-opens the question.
      const withdrawal = await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          allowSuggestionsForLabelIds: [tagA],
        },
      });
      expect(withdrawal.status).toBe("applied");
      expect(
        await prisma.fileFieldOverride.count({
          where: { resourceId: vetoResourceId, labelId: tagA },
        }),
      ).toBe(0);

      // It does NOT assert the label. A withdrawal writes no row at all: the
      // model still has to decide, which is the whole point.
      expect(
        await prisma.fileLabel.count({
          where: {
            resourceId: vetoResourceId,
            labelId: tagA,
            state: FileMetadataState.CONFIRMED,
          },
        }),
      ).toBe(0);

      // And now the model may answer again.
      await prisma.fileLabel.deleteMany({
        where: { resourceId: vetoResourceId },
      });
      expect(await runOneJob(202)).toContain(tagA);
    }, 60_000);

    it("withdraws one veto without withdrawing the others", async () => {
      await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          removeTagLabelIds: [tagA, tagB],
        },
      });
      expect(
        await prisma.fileFieldOverride.count({
          where: { resourceId: vetoResourceId, decision: "REJECT" },
        }),
      ).toBe(2);

      await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          allowSuggestionsForLabelIds: [tagA],
        },
      });

      const remaining = await prisma.fileFieldOverride.findMany({
        where: { resourceId: vetoResourceId, decision: "REJECT" },
        select: { labelId: true },
      });
      expect(remaining.map((row) => row.labelId)).toEqual([tagB]);

      // The one still vetoed stays out of the shortlist; the forgiven one
      // comes back. Both halves, so a clear that deleted everything fails on
      // the second assertion and one that deleted nothing fails on the first.
      await prisma.fileLabel.deleteMany({
        where: { resourceId: vetoResourceId },
      });
      const suggested = await runOneJob(210);
      expect(suggested).toContain(tagA);
      expect(suggested).not.toContain(tagB);
    }, 60_000);

    it("withdraws a category veto, not only a tag one", async () => {
      // A category's tombstone is written by dismissing a suggestion, never by
      // `removeTagLabelIds` — there is no `removeCategoryLabelIds` — so the
      // category arm is reachable by a different gesture and would stay
      // permanent under a tags-only clear.
      await prisma.fileFieldOverride.create({
        data: {
          resourceId: vetoResourceId,
          field: "category",
          labelId: categoryA,
          decision: "REJECT",
          evidenceScopeId: vetoScopeId,
          contentRevision: 1,
          vocabularyVersion: 1,
          decidedByUserId: vetoOwnerId,
        },
      });

      await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          allowSuggestionsForLabelIds: [categoryA],
        },
      });

      expect(
        await prisma.fileFieldOverride.count({
          where: { resourceId: vetoResourceId, labelId: categoryA },
        }),
      ).toBe(0);
    }, 60_000);

    it("leaves a pin on the named label alone", async () => {
      /**
       * The `decision: REJECT` filter, isolated.
       *
       * `@@unique([resourceId, field, labelId, evidenceScopeId])` does not
       * include `decision`, so for one resource, field and label there is
       * exactly one override row and it is either a PIN or a REJECT. Without
       * the filter, withdrawing the veto on X deletes a PIN on X — a person's
       * "I set this field by hand" destroyed by a gesture that means "the
       * model may propose this again".
       *
       * The sibling case below puts the PIN and the REJECT on two *different*
       * labels, so `labelId: target` alone already saves it and the filter is
       * never exercised. Here the PIN is on the label being named and there is
       * no REJECT anywhere, so deleting the filter deletes the pin. Found by
       * mutation, not by reading.
       */
      await prisma.fileFieldOverride.create({
        data: {
          resourceId: vetoResourceId,
          field: "category",
          labelId: categoryA,
          decision: "PIN",
          evidenceScopeId: vetoScopeId,
          contentRevision: 1,
          vocabularyVersion: 1,
          decidedByUserId: vetoOwnerId,
        },
      });

      await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          allowSuggestionsForLabelIds: [categoryA],
        },
      });

      const rows = await prisma.fileFieldOverride.findMany({
        where: { resourceId: vetoResourceId, labelId: categoryA },
        select: { decision: true },
      });
      expect(
        rows,
        "withdrawing a veto must not delete a pin on the same label",
      ).toEqual([{ decision: "PIN" }]);
    }, 60_000);

    it("forgives one category rejection without touching a pin on the same field", async () => {
      /**
       * PIN says "this field is set by hand"; REJECT says "this label may not
       * come back". Different statements about different things, and the
       * existing category clear conflates them — it deletes every override on
       * `field: "category"` regardless of decision and regardless of label.
       *
       * Both rows live on `field: "category"` and differ only by label, which
       * is the exact shape that blunt delete destroys. Asserted in both
       * directions: an earlier version checked only that the PIN survived,
       * which is also what happens when the withdrawal does nothing at all, so
       * it passed with and without the change.
       */
      await prisma.fileFieldOverride.createMany({
        data: [
          {
            resourceId: vetoResourceId,
            field: "category",
            labelId: categoryA,
            decision: "PIN",
            evidenceScopeId: vetoScopeId,
            contentRevision: 1,
            vocabularyVersion: 1,
            decidedByUserId: vetoOwnerId,
          },
          {
            resourceId: vetoResourceId,
            field: "category",
            labelId: categoryB,
            decision: "REJECT",
            evidenceScopeId: vetoScopeId,
            contentRevision: 1,
            vocabularyVersion: 1,
            decidedByUserId: vetoOwnerId,
          },
        ],
      });

      await updateFileMetadata({
        workspaceId: vetoWorkspaceId,
        actor: actor(),
        resourceId: vetoResourceId,
        request: {
          expectedMetadataRevision: await currentRevision(),
          allowSuggestionsForLabelIds: [categoryB],
        },
      });

      const rows = await prisma.fileFieldOverride.findMany({
        where: { resourceId: vetoResourceId, field: "category" },
        select: { labelId: true, decision: true },
      });

      // The rejection is gone: fails if the withdrawal never ran.
      // The pin remains: fails if the withdrawal copied the blunt shape.
      expect(rows).toEqual([{ labelId: categoryA, decision: "PIN" }]);
    }, 60_000);
  });
});

/**
 * The shared ceiling, which only a real database can show.
 *
 * `jev-scheduler` counts in memory, so on a multi-instance deployment its
 * per-minute numbers were a per-process share under a global name. The
 * per-minute ceilings now count admission rows inside the admitting
 * transaction, so two runtimes see one total. Mocking Prisma would remove
 * exactly the thing under test.
 */
describe.skipIf(!enabled)("the shared admission ceiling", () => {
  let ceilingUserId = "";
  let ceilingWorkspaceId = "";
  let neighbourUserId = "";
  let neighbourWorkspaceId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Ceiling fixture",
        email: `ceiling-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ceilingUserId = user.id;
    const workspace = await prisma.workspace.create({
      data: { userId: ceilingUserId },
      select: { id: true },
    });
    ceilingWorkspaceId = workspace.id;

    // A second tenant, for showing that one workspace's traffic does not
    // deny another's. It needs its own user: a personal workspace is unique
    // per user.
    const neighbour = await prisma.user.create({
      data: {
        name: "Neighbour fixture",
        email: `neighbour-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    neighbourUserId = neighbour.id;
    neighbourWorkspaceId = (
      await prisma.workspace.create({
        data: { userId: neighbourUserId },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.fileAuthorizationAdmission.deleteMany({
      where: {
        workspaceId: { in: [ceilingWorkspaceId, neighbourWorkspaceId] },
      },
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.workspace.deleteMany({
      where: { id: { in: [ceilingWorkspaceId, neighbourWorkspaceId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ceilingUserId, neighbourUserId] } },
    });
  });

  function actorFor(userId = ceilingUserId) {
    return {
      userId,
      organizationId: null,
      kind: "worker" as const,
    };
  }

  async function admit(
    inputTokens: number,
    workspaceId = ceilingWorkspaceId,
    userId = ceilingUserId,
  ) {
    const { admitJevRequest } = await import("@/lib/files/jev-admission");
    const { resolveScopeEpoch } = await import("@/lib/files/evidence-scope");
    return admitJevRequest({
      workspaceId,
      actor: actorFor(userId),
      purpose: "label-suggest",
      payloadDigest: `digest-${Math.random()}`,
      inputTokens,
      model: "typesafe-ai/jev",
      preparedEpoch: await resolveScopeEpoch({
        workspaceId,
        actor: actorFor(userId),
      }),
    });
  }

  it("refuses once the workspace has spent its day's tokens", async () => {
    // The per-minute ceilings bound a burst. Sustained for 24 hours the
    // workspace ceiling allowed 2.16 billion input tokens, which is 436x a
    // heavy day's real use — so nothing bounded a day at all, and the flag
    // is now on by default.
    const { PER_WORKSPACE_INPUT_TOKENS_PER_DAY } = await import(
      "@/lib/files/jev-scheduler"
    );

    // Spent earlier today, and deliberately *outside* the one-minute
    // window, so only the daily budget can see it.
    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId: ceilingWorkspaceId,
        actorFingerprint: "earlier-today",
        epochVector: "whatever",
        purpose: "search-rank",
        payloadDigest: "spent-today",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_DAY,
        admittedAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000 + 50),
      },
    });

    await expect(admit(1)).resolves.toBeNull();
  });

  it("forgets a day that has rolled out of the window", async () => {
    // A budget that never forgets is a permanent ban.
    const { PER_WORKSPACE_INPUT_TOKENS_PER_DAY, SPEND_WINDOW_MS } =
      await import("@/lib/files/jev-scheduler");

    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId: ceilingWorkspaceId,
        actorFingerprint: "yesterday",
        epochVector: "whatever",
        purpose: "search-rank",
        payloadDigest: "spent-yesterday",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_DAY,
        admittedAt: new Date(Date.now() - SPEND_WINDOW_MS - 60_000),
        expiresAt: new Date(Date.now() - SPEND_WINDOW_MS),
      },
    });

    await expect(admit(1)).resolves.not.toBeNull();
  });

  it("refuses once the workspace has spent its day's money", async () => {
    // Priced from what the provider actually reported, so this needs no
    // assumption about cost per token — which matters, because no live call
    // has ever been made from this branch.
    const { PER_WORKSPACE_USD_PER_DAY } = await import(
      "@/lib/files/jev-scheduler"
    );

    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId: ceilingWorkspaceId,
        actorFingerprint: "expensive",
        epochVector: "whatever",
        purpose: "label-suggest",
        payloadDigest: "spent-money",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: 10,
        costUsd: String(PER_WORKSPACE_USD_PER_DAY),
        admittedAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000 + 50),
      },
    });

    await expect(admit(1)).resolves.toBeNull();
  });

  it("does not let one workspace's spending refuse another's work", async () => {
    const { PER_WORKSPACE_USD_PER_DAY, PER_WORKSPACE_INPUT_TOKENS_PER_DAY } =
      await import("@/lib/files/jev-scheduler");

    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId: ceilingWorkspaceId,
        actorFingerprint: "expensive",
        epochVector: "whatever",
        purpose: "label-suggest",
        payloadDigest: "neighbour-unaffected",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_DAY,
        costUsd: String(PER_WORKSPACE_USD_PER_DAY * 10),
        admittedAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000 + 50),
      },
    });

    await expect(admit(1)).resolves.toBeNull();
    await expect(
      admit(1, neighbourWorkspaceId, neighbourUserId),
    ).resolves.not.toBeNull();
  });

  it("records what a dispatched call cost, so the budget can see it", async () => {
    // The budget sums a column. A dispatch that does not write the cost is
    // spend the budget is blind to — and the value was already being parsed
    // out of `providerMetadata` and thrown away.
    const { recordJevDispatch } = await import("@/lib/files/jev-admission");

    const grant = await admit(10);
    expect(grant).not.toBeNull();
    if (!grant) return;

    await recordJevDispatch({
      admissionId: grant.id,
      outcome: "scored",
      costUsd: "0.004200",
    });

    const row = await prisma.fileAuthorizationAdmission.findUnique({
      where: { id: grant.id },
      select: { costUsd: true, outcome: true },
    });
    expect(row?.outcome).toBe("scored");
    expect(Number(row?.costUsd)).toBeCloseTo(0.0042, 6);
  });

  it("mints both timestamps in the database, in UTC, one window apart", async () => {
    // The insert is raw SQL, and any error in it is swallowed into
    // `admission-denied` — a quiet outcome. So a completely broken INSERT
    // looks exactly like a quota refusal, and would drive
    // `admission-expired` to zero, which is what "fixed" looks like. This
    // asserts the row is really written and really correct.
    //
    // `admittedAt`/`expiresAt` are TIMESTAMP(3), without time zone, while
    // `clock_timestamp()` is timestamptz. Without an explicit
    // `AT TIME ZONE 'UTC'` the implicit cast goes through the session's
    // TimeZone and can write local wall time — an error of hours, not
    // milliseconds. The drift check below catches that.
    //
    // **It is only decisive on a session that is not UTC.** On a UTC session
    // the cast is a no-op and removing it is genuinely harmless, so this
    // test passes either way and that is correct rather than weak. To see it
    // fail, point `DATABASE_URL` at a session with another zone:
    //
    //   ?options=-c%20TimeZone%3DAmerica/New_York
    //
    // Verified that way: dropping the cast writes 13:32 where the row should
    // read 17:32, a four-hour error. Neon's session default is not something
    // this branch has observed, which is exactly why the cast is explicit.
    const { ADMISSION_VALID_MS } = await import("@/lib/files/jev-admission");

    const before = Date.now();
    const grant = await admit(10);
    const after = Date.now();

    expect(grant).not.toBeNull();
    if (!grant) return;

    const row = await prisma.fileAuthorizationAdmission.findUniqueOrThrow({
      where: { id: grant.id },
      select: { admittedAt: true, expiresAt: true },
    });

    // Exactly the constant, and this equality is only sound because the
    // INSERT takes **one** `clock_timestamp()` reading in a CTE and derives
    // both columns from it. Two readings round independently into
    // TIMESTAMP(3) and straddle a millisecond boundary about 3 times in 4000,
    // which would make this assertion an intermittent failure rather than a
    // check.
    expect(row.expiresAt.getTime() - row.admittedAt.getTime()).toBe(
      ADMISSION_VALID_MS,
    );

    // And that clock agrees with ours to within the round trip, rather than
    // being off by a time-zone offset.
    expect(row.admittedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(row.admittedAt.getTime()).toBeLessThanOrEqual(after + 5_000);
  });

  it("issues a grant that is still dispatchable after slow grant work", async () => {
    // The window must start when the row commits, not when the function is
    // entered. The grant's own work — an epoch round trip, queueing on the
    // one advisory lock behind the rest of its own wave, then an aggregate
    // scan — exceeded the window on a cold pool when the window was 50 ms.
    // Opened at function entry, the grant was **born expired**: the
    // caller's `isAdmissionDispatchable` check failed on a grant that had
    // just been issued. Observed in preprod as `admission-expired` with
    // `elapsedMs` of 405 and 511, both under the 600 ms rank deadline.
    //
    // This reproduces it honestly rather than by mocking a clock: hold the
    // real advisory lock from another transaction so the admission has to
    // wait for it, which is exactly the self-inflicted queueing a concurrent
    // wave causes.
    const { ADMISSION_LOCK_KEY, ADMISSION_VALID_MS, isAdmissionDispatchable } =
      await import("@/lib/files/jev-admission");

    // Hold the lock for longer than the window, whatever the window is. A
    // literal 250 was only meaningful while the constant was 50; once it
    // moved, the wait no longer exceeded the window and the test proved
    // nothing while still passing.
    const HELD_MS = ADMISSION_VALID_MS + 250;
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${ADMISSION_LOCK_KEY})`,
        );
        await tx.$executeRawUnsafe(`SELECT pg_sleep(${HELD_MS / 1000})`);
      },
      { timeout: 15_000 },
    );

    // Let the blocker take the lock before the admission asks for it.
    await new Promise((resolve) => setTimeout(resolve, 60));

    const startedAt = Date.now();
    const grant = await admit(10);
    const waitedMs = Date.now() - startedAt;
    await blocker;

    expect(grant).not.toBeNull();
    if (!grant) return;

    // The wait really did exceed the validity window, or this test proves
    // nothing about where the window starts.
    expect(waitedMs).toBeGreaterThan(ADMISSION_VALID_MS);
    expect(isAdmissionDispatchable(grant)).toBe(true);
  }, 30_000);

  it("admits a whole search wave at once, not one of it", async () => {
    // `rerankFileCandidates` fires `PER_QUERY_MAX_CONCURRENT` admissions in
    // one `Promise.all`, so this is one ordinary search, not a stress test.
    // Under SERIALIZABLE the aggregate and the insert are the textbook
    // write-skew shape and Postgres aborted all but one — four of six came
    // back null, the caller read that as "over quota", and because the
    // rerank is all-or-nothing the whole reorder was discarded *after* the
    // winners had already dispatched and been paid for.
    const { PER_QUERY_MAX_CONCURRENT } = await import(
      "@/lib/files/jev-scheduler"
    );

    const wave = await Promise.all(
      Array.from({ length: PER_QUERY_MAX_CONCURRENT }, () => admit(10)),
    );

    expect(wave.filter((grant) => grant !== null)).toHaveLength(
      PER_QUERY_MAX_CONCURRENT,
    );
    expect(
      await prisma.fileAuthorizationAdmission.count({
        where: { workspaceId: ceilingWorkspaceId },
      }),
    ).toBe(PER_QUERY_MAX_CONCURRENT);
  });

  it("does not let one workspace's wave deny another's", async () => {
    // The count filters on `admittedAt` alone, so without an index for it
    // the scan took a relation-wide predicate lock and unrelated tenants
    // conflicted with each other.
    const wave = await Promise.all([
      admit(10, ceilingWorkspaceId),
      admit(10, ceilingWorkspaceId),
      admit(10, ceilingWorkspaceId),
      admit(10, neighbourWorkspaceId, neighbourUserId),
      admit(10, neighbourWorkspaceId, neighbourUserId),
      admit(10, neighbourWorkspaceId, neighbourUserId),
    ]);

    expect(wave.filter((grant) => grant !== null)).toHaveLength(6);
  });

  it("still refuses the request that actually crosses the ceiling", async () => {
    // The concurrency fix must not buy its way out by counting loosely:
    // six at once are admitted, and the one that would exceed the budget is
    // still refused.
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE } = await import(
      "@/lib/files/jev-scheduler"
    );
    const each = Math.floor(PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE / 6);

    const wave = await Promise.all(
      Array.from({ length: 6 }, () => admit(each)),
    );
    expect(wave.filter((grant) => grant !== null)).toHaveLength(6);

    await expect(
      admit(PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE),
    ).resolves.toBeNull();
  });

  it("admits ordinary work", async () => {
    await expect(admit(100)).resolves.not.toBeNull();
  });

  it("refuses once the per-workspace token budget is spent", async () => {
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE } = await import(
      "@/lib/files/jev-scheduler"
    );

    // One admission that consumes the whole workspace minute.
    await expect(
      admit(PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE),
    ).resolves.not.toBeNull();

    // The next one is refused by a count of rows, not by process memory —
    // which is what makes it hold for a second runtime too.
    await expect(admit(1)).resolves.toBeNull();
  });

  it("counts rows another runtime wrote, not just its own", async () => {
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE } = await import(
      "@/lib/files/jev-scheduler"
    );

    // Stand in for a sibling instance: a row this process never admitted.
    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId: ceilingWorkspaceId,
        actorFingerprint: "another-runtime",
        epochVector: "whatever",
        purpose: "search-rank",
        payloadDigest: "from-elsewhere",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
        admittedAt: new Date(),
        expiresAt: new Date(Date.now() + 50),
      },
    });

    await expect(admit(1)).resolves.toBeNull();
  });

  it("forgets spending that has fallen out of the window", async () => {
    const { PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE } = await import(
      "@/lib/files/jev-scheduler"
    );

    await prisma.fileAuthorizationAdmission.create({
      data: {
        workspaceId: ceilingWorkspaceId,
        actorFingerprint: "another-runtime",
        epochVector: "whatever",
        purpose: "search-rank",
        payloadDigest: "long-ago",
        provider: "vercel-ai-gateway",
        model: "typesafe-ai/jev",
        inputTokens: PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
        // Two minutes ago: outside the one-minute window.
        admittedAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 119_950),
      },
    });

    await expect(admit(100)).resolves.not.toBeNull();
  });

  it("refuses a request prepared under a since-changed scope epoch", async () => {
    /**
     * What the `preparedEpoch` parameter is for, and what nothing pinned.
     *
     * `admitJevRequest` re-reads the epoch at the admission point and
     * denies if it differs from the one the caller prepared under. The
     * label pipeline used to pass `await resolveScopeEpoch(...)` inline as
     * that argument, one round trip before the identical call inside the
     * function — a value compared against itself, which cannot differ.
     * Deleting that self-comparison is only worth anything if the
     * comparison itself works, which is what this checks.
     *
     * Deliberately an **interactive** actor, not the `worker` the label
     * pipeline uses. See the test below for why that distinction is the
     * whole story.
     *
     * The honest limit: this pins the mechanism in `jev-admission.ts`, not
     * the call site. Restoring the inline `await` in
     * `file-suggestions.service.ts` leaves this green, because no seam
     * exists to add a scope between the payload being built and admission
     * being asked for inside `runSuggestionJob`. Removing the comparison
     * at `jev-admission.ts` turns it red.
     */
    const { admitJevRequest } = await import("@/lib/files/jev-admission");
    const { resolveScopeEpoch } = await import("@/lib/files/evidence-scope");

    const reader = {
      userId: ceilingUserId,
      organizationId: null,
      kind: "interactive" as const,
    };

    const prepared = await resolveScopeEpoch({
      workspaceId: ceilingWorkspaceId,
      actor: reader,
    });

    // A scope the caller did not know about when it prepared.
    await ensureEvidenceScope({
      workspaceId: ceilingWorkspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `epoch-shift-${randomUUID()}`,
    });

    const current = await resolveScopeEpoch({
      workspaceId: ceilingWorkspaceId,
      actor: reader,
    });
    // If these matched, the refusal below would hold for the wrong reason
    // and the test would prove nothing.
    expect(current).not.toBe(prepared);

    const stale = await admitJevRequest({
      workspaceId: ceilingWorkspaceId,
      actor: reader,
      purpose: "label-suggest",
      payloadDigest: `stale-${randomUUID()}`,
      inputTokens: 1,
      model: "typesafe-ai/jev",
      preparedEpoch: prepared,
    });
    expect(stale).toBeNull();

    // And the refusal is about the epoch, not about quota or anything else
    // the same call would trip over.
    const fresh = await admitJevRequest({
      workspaceId: ceilingWorkspaceId,
      actor: reader,
      purpose: "label-suggest",
      payloadDigest: `fresh-${randomUUID()}`,
      inputTokens: 1,
      model: "typesafe-ai/jev",
      preparedEpoch: current,
    });
    expect(fresh).not.toBeNull();
  });

  it("cannot refuse anything for the actor the label pipeline uses", async () => {
    /**
     * The finding that came out of writing the test above, which first
     * asserted the epoch moved for a `worker` actor and went red.
     *
     * `resolveScopeEpoch` aggregates over
     * `sourceKind IN sourceKindsForActor(actor.kind)`, and `"worker"`
     * appears in no entry of `SOURCE_ACTOR_CEILING`. The list is therefore
     * empty, the aggregate runs over no rows whatever the workspace holds,
     * and the hash depends only on the workspace and actor identity.
     *
     * `runSuggestionJob` builds the only `worker` actor in the
     * application. So on the one path that has a `preparedEpoch` at all,
     * the check in `admitJevRequest` compares a constant to itself and can
     * never deny. Capturing that constant at the right moment — the fix in
     * `file-suggestions.service.ts` — is the correct shape and changes no
     * outcome; this is the reason why, written down rather than left for
     * the next reader to rediscover.
     *
     * Not fixed here. Adding `"worker"` to the ceiling would also widen
     * `buildAuthorizedResourceSql`, which currently returns `FALSE` for an
     * empty kind list, and that is an authorization change and not a
     * comment correction.
     */
    const { resolveScopeEpoch, sourceKindsForActor } = await import(
      "@/lib/files/evidence-scope"
    );

    expect(sourceKindsForActor("worker")).toEqual([]);

    const before = await resolveScopeEpoch({
      workspaceId: ceilingWorkspaceId,
      actor: actorFor(),
    });

    await ensureEvidenceScope({
      workspaceId: ceilingWorkspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `worker-blind-${randomUUID()}`,
    });

    expect(
      await resolveScopeEpoch({
        workspaceId: ceilingWorkspaceId,
        actor: actorFor(),
      }),
    ).toBe(before);

    // And an interactive reader in the same workspace did see it, so the
    // stability above is about the actor kind and not about the scope
    // having failed to be created.
    const reader = {
      userId: ceilingUserId,
      organizationId: null,
      kind: "interactive" as const,
    };
    const readerBefore = await resolveScopeEpoch({
      workspaceId: ceilingWorkspaceId,
      actor: reader,
    });
    await ensureEvidenceScope({
      workspaceId: ceilingWorkspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `worker-blind-witness-${randomUUID()}`,
    });
    expect(
      await resolveScopeEpoch({
        workspaceId: ceilingWorkspaceId,
        actor: reader,
      }),
    ).not.toBe(readerBefore);
  });
});

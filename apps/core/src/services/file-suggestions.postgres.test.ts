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
import type { JevEvaluator } from "@/lib/files/jev-client";
import { getJevScheduler } from "@/lib/files/jev-scheduler";
import { writeVersionChunks } from "@/services/file-index.service";
import { runSuggestionJob } from "@/services/file-suggestions.service";

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

/** Answers every rung true, which is the top of the `belongs` ladder. */
function evaluatorSaying(score: number): JevEvaluator & { calls: number } {
  const stub = {
    calls: 0,
    async evaluate() {
      stub.calls += 1;
      return {
        ok: true,
        score,
        reason: null,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: "0.0001",
        generationId: "gen-test",
      };
    },
  };
  return stub;
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

    const evaluator = evaluatorSaying(3);
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

  it("does not suggest below the threshold", async () => {
    await queueSuggestionJob(2);
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    if (!leased) throw new Error("expected a job");

    const outcome = await runSuggestionJob(leased, {
      evaluator: evaluatorSaying(1),
      configured: () => true,
    });

    expect(outcome.suggested).toBe(0);
    await expect(
      prisma.fileLabel.count({ where: { resourceId } }),
    ).resolves.toBe(0);
  });

  it("does not report a local denial to the provider breaker", async () => {
    // A denied admission is our decision, not the provider's. Counting it as
    // a provider failure opened the breaker during a run that never reached
    // the network, and that degrades interactive search reranking.
    const scheduler = getJevScheduler();
    const before = scheduler.isBreakerOpen();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await queueSuggestionJob(100 + attempt);
      const leased = await leaseNextFileIndexJob({
        pipeline: FileIndexJobPipeline.SUGGEST,
      });
      if (!leased) throw new Error("expected a job");
      await runSuggestionJob(leased, {
        evaluator: evaluatorSaying(3),
        configured: () => true,
      });
      await prisma.fileLabel.deleteMany({ where: { resourceId } });
    }

    expect(scheduler.isBreakerOpen()).toBe(before);
  });
});

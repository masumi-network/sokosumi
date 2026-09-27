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
      // new way. The assertion below is what caught that.
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 150));

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
});

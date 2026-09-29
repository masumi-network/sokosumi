/**
 * REPRODUCTION ARTIFACT — a workspace that has not created a single tag or
 * category gets the same answer as a workspace whose vocabulary the model read
 * and rejected.
 *
 * Written by the reviewer, not the implementer. Red at `bbd037236`.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * **The defect.** `runSuggestionJob` computes the distinction —
 * `{ suggested: 0, skipped: "no-vocabulary" }` at `file-suggestions.service.ts`
 * — and every surface above it throws that value away.
 * `processFileSuggestionJobs` reads only `outcome.suggested` and
 * `outcome.deferred` from it. The job is closed with `completeFileIndexJob`,
 * so the durable record is `SUCCEEDED`, `lastError: null`, exactly as for a
 * document the model read and declined. The information exists for one stack
 * frame and is then unrecoverable.
 *
 * This is the empty-workspace case, so it is the *first* thing the feature
 * does for every new workspace: there is one `workspaceLabel.create` in the
 * repository and it is in a test, nothing seeds a default vocabulary, so until
 * the reader invents a tag every document takes this branch.
 *
 * **Deliberately asserted as a difference, not as a field.** The test does not
 * name a state, a column or an error string, because the reviewer would then
 * be asserting a fix shape of his own invention. It builds two workspaces that
 * differ in exactly one respect — one has a vocabulary, the other does not —
 * runs the real tick over both, and requires that *something* an observer
 * outside the function can see comes out different. Any of these makes it
 * green: not enqueueing the job when the count is zero, closing it in a
 * distinguishable terminal state, recording a reason, or surfacing the state
 * on the resource. None of them is asserted; only that one of them happened.
 *
 * **Three surfaces are compared**, which together are everything reachable
 * from outside:
 *   - the tick's own return value (`SuggestionSyncResult`)
 *   - the durable job row and the label rows
 *   - the DTO the Drive API serves for that file
 *     (`loadLiveResources` + `hydrateResources`, the same pair the GET route
 *     uses), with identity and timestamp fields blanked so only substance
 *     is compared
 *
 * **Not compared: the model call count and the admission row.** Workspace B
 * calls the evaluator and writes a `file_authorization_admission` row;
 * workspace A does neither. Including either would turn this green today
 * without anything being fixed, because spend telemetry is not the document's
 * state and no reader or operator looking at the document can see it. The
 * call count is asserted separately, as the premise: it is what proves the
 * two cases really are "no vocabulary" and "read and declined" rather than
 * two runs of the same branch.
 */
import { randomUUID } from "node:crypto";
import {
  FileIndexJobPipeline,
  FileLabelKind,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import { enqueueFileIndexJob } from "@/lib/files/index-jobs";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import { writeVersionChunks } from "@/services/file-index.service";
import {
  hydrateResources,
  loadLiveResources,
} from "@/services/file-search.service";
import {
  processFileSuggestionJobs,
  type SuggestionSyncResult,
} from "@/services/file-suggestions.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);

/** The same document text in both workspaces, so content cannot explain it. */
const TEXT = "Findings about bicycle commuters and their travel patterns.";

const actor = (ownerId: string): FileActor => ({
  userId: ownerId,
  organizationId: null,
  kind: "interactive",
});

/** Reads the vocabulary it is given and picks nothing from it. */
function decliningEvaluator(): JevLabelEvaluator & { calls: number } {
  const stub = {
    calls: 0,
    async evaluateLabels(_input: unknown) {
      stub.calls += 1;
      return {
        ok: true as const,
        chosen: [],
        reason: null,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: "0.0001",
        generationId: "gen-repro",
      };
    },
  };
  return stub as unknown as JevLabelEvaluator & { calls: number };
}

interface Workspace {
  workspaceId: string;
  /**
   * Its own user, because `workspace.userId` is unique — one workspace per
   * user. The owner differs between the two cases and the document does not:
   * `ownerUserId` appears in no DTO field and in no assertion below.
   */
  ownerId: string;
  resourceId: string;
}

async function seedWorkspace(
  label: string,
  withVocabulary: boolean,
): Promise<Workspace> {
  const owner = await prisma.user.create({
    data: {
      name: `Vocabulary owner ${label}`,
      email: `vocab-${label}-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  const ownerId = owner.id;
  const workspace = await prisma.workspace.create({
    data: { userId: ownerId },
    select: { id: true },
  });
  const workspaceId = workspace.id;

  if (withVocabulary) {
    await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.TAG,
        displayName: "Commuting",
        normalizedName: "commuting",
        description: "Documents about commuting",
      },
    });
  }

  const scope = await ensureEvidenceScope({
    workspaceId,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceScope: FileSourceScope.USER,
    sourceId: ownerId,
  });

  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${ownerId}/${workspaceId}/commuters.txt`,
      ownerUserId: ownerId,
      displayName: "commuters.txt",
      normalizedName: "commuters.txt",
      mimeType: "text/plain",
      sizeBytes: 64,
      lifecycle: FileResourceLifecycle.ACTIVE,
      versions: {
        create: {
          revision: 1,
          objectKey: `drive/users/${ownerId}/${workspaceId}/commuters.txt`,
          mimeType: "text/plain",
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
    chunks: chunkExtractedText(TEXT),
  });

  // The real helper, so the dedupe key and the generation are the real ones.
  await enqueueFileIndexJob({
    resourceId: resource.id,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision: 1,
    desiredGeneration: 1,
    runAfter: new Date(Date.now() - 1_000),
  });

  return { workspaceId, ownerId, resourceId: resource.id };
}

interface Observation {
  /** The tick that closed this document's job, or null if none was run. */
  tick: SuggestionSyncResult | null;
  jobs: unknown[];
  labels: unknown[];
  dto: unknown;
}

/**
 * Runs the real tick until this document's job leaves the queue, then reports
 * everything an outside observer can see about the document.
 *
 * `leaseNextFileIndexJob` has no workspace filter, so a tick can pick up a job
 * belonging to another suite. `maxJobs: 1` makes each tick handle exactly one
 * job, and the loop keeps going until the job under test is the one that
 * moved — so a stolen tick is skipped rather than mistaken for this one.
 */
async function runAndObserve(
  workspace: Workspace,
  evaluator: JevLabelEvaluator,
): Promise<Observation> {
  let tick: SuggestionSyncResult | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pending = await prisma.fileIndexJob.count({
      where: {
        resourceId: workspace.resourceId,
        pipeline: FileIndexJobPipeline.SUGGEST,
        state: { in: ["QUEUED", "LEASED"] },
      },
    });
    if (pending === 0) break;

    const result = await processFileSuggestionJobs({
      shouldContinue: () => true,
      maxJobs: 1,
      dependencies: { evaluator, configured: () => true },
    });

    const stillPending = await prisma.fileIndexJob.count({
      where: {
        resourceId: workspace.resourceId,
        pipeline: FileIndexJobPipeline.SUGGEST,
        state: { in: ["QUEUED", "LEASED"] },
      },
    });
    if (stillPending === 0) {
      tick = result;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const jobs = await prisma.fileIndexJob.findMany({
    where: { resourceId: workspace.resourceId },
    orderBy: { pipeline: "asc" },
    select: {
      pipeline: true,
      state: true,
      attempt: true,
      lastError: true,
      completedAt: true,
    },
  });

  const labels = await prisma.fileLabel.findMany({
    where: { resourceId: workspace.resourceId },
    orderBy: { labelId: "asc" },
    select: {
      state: true,
      provenance: true,
      evidenceSnippet: true,
      contentRevision: true,
    },
  });

  const live = await loadLiveResources({
    workspaceId: workspace.workspaceId,
    actor: actor(workspace.ownerId),
    resourceIds: [workspace.resourceId],
  });
  const [dto] = await hydrateResources({ resources: live, query: null });

  return {
    tick,
    // `completedAt` is a timestamp; only whether it is set carries meaning.
    jobs: jobs.map((job) => ({
      ...job,
      completedAt: job.completedAt !== null,
    })),
    labels,
    dto: dto === undefined ? null : blankIdentity(dto),
  };
}

/** Everything that must differ between two distinct documents, removed. */
function blankIdentity(dto: Record<string, unknown>): Record<string, unknown> {
  return {
    ...dto,
    id: "<blanked>",
    displayName: "<blanked>",
    updatedAt: "<blanked>",
    snippet: "<blanked>",
  };
}

/** Stable across key order, so a reordered object is not a difference. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.entries(inner as Record<string, unknown>).sort(([l], [r]) =>
          l.localeCompare(r),
        ),
      );
    }
    return inner;
  });
}

describe.skipIf(!enabled)(
  "a workspace with no vocabulary is not the same as a rejected vocabulary",
  () => {
    let empty: Workspace;
    let stocked: Workspace;
    let emptyObservation: Observation;
    let stockedObservation: Observation;
    let emptyCalls = 0;
    let stockedCalls = 0;

    beforeAll(async () => {
      // Sequential, because the tick leases across all workspaces: the
      // second workspace is not seeded until the first one's job is closed.
      empty = await seedWorkspace("empty", false);
      const emptyEvaluator = decliningEvaluator();
      emptyObservation = await runAndObserve(empty, emptyEvaluator);
      emptyCalls = emptyEvaluator.calls;

      stocked = await seedWorkspace("stocked", true);
      const stockedEvaluator = decliningEvaluator();
      stockedObservation = await runAndObserve(stocked, stockedEvaluator);
      stockedCalls = stockedEvaluator.calls;
    }, 300_000);

    afterAll(async () => {
      if (!enabled) return;
      for (const workspace of [empty, stocked]) {
        if (!workspace) continue;
        await prisma.fileResource.deleteMany({
          where: { workspaceId: workspace.workspaceId },
        });
        await prisma.fileAuthorizationAdmission.deleteMany({
          where: { workspaceId: workspace.workspaceId },
        });
        await prisma.fileEvidenceScope.deleteMany({
          where: { workspaceId: workspace.workspaceId },
        });
        await prisma.workspaceLabel.deleteMany({
          where: { workspaceId: workspace.workspaceId },
        });
        await prisma.workspace.deleteMany({
          where: { id: workspace.workspaceId },
        });
        await prisma.user.deleteMany({ where: { id: workspace.ownerId } });
      }
    });

    /**
     * The premise. Without this the failure below could be two runs of the
     * same branch rather than the two branches the finding is about.
     */
    it("1. the empty workspace never reaches the model and the stocked one does", () => {
      expect(emptyCalls, "the empty workspace called the evaluator").toBe(0);
      expect(
        stockedCalls,
        "the stocked workspace did not reach the evaluator, so its zero " +
          "suggestions are not a rejection and this test proves nothing",
      ).toBe(1);
      expect(
        emptyObservation.tick,
        "no tick closed the empty job",
      ).not.toBeNull();
      expect(
        stockedObservation.tick,
        "no tick closed the stocked job",
      ).not.toBeNull();
    });

    /**
     * FAILS TODAY. Both documents end as one `SUCCEEDED` SUGGEST job with a
     * null `lastError`, no label rows, an identical DTO, and an identical
     * `{ processed: 1, suggested: 0, failed: 0, deferred: 0 }`.
     */
    it("2. something observable tells the two documents apart", () => {
      const withoutVocabulary = canonical(emptyObservation);
      const withRejectedVocabulary = canonical(stockedObservation);

      expect(
        withoutVocabulary,
        "a document in a workspace with no tags or categories is recorded " +
          "exactly like a document whose vocabulary the model read and " +
          "rejected. Nothing in the tick result, the job row, the label rows " +
          "or the API DTO differs, so no caller, reader or operator can tell " +
          "that this workspace has never created a label. Both read:\n" +
          `${withoutVocabulary}`,
      ).not.toEqual(withRejectedVocabulary);
    });
  },
);

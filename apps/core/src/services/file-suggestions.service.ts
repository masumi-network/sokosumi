import {
  FileFieldOverrideDecision,
  FileIndexJobPipeline,
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import {
  ensureEvidenceScope,
  resolveScopeEpoch,
} from "@/lib/files/evidence-scope";
import {
  completeFileIndexJob,
  failFileIndexJob,
  type LeasedFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import { admitJevRequest, recordJevDispatch } from "@/lib/files/jev-admission";
import type { JevEvaluator } from "@/lib/files/jev-client";
import { gatewayJevEvaluator, isJevConfigured } from "@/lib/files/jev-client";
import {
  buildJevLabelRequest,
  isJevRequestRejection,
} from "@/lib/files/jev-request";
import { FILES_RANKING_MODEL } from "@/lib/files/jev-rubrics";
import { getJevScheduler } from "@/lib/files/jev-scheduler";

/**
 * Taxonomy and project suggestions.
 *
 * Three rules shape this, and they are the reason the code is not simply
 * "ask the model what the tags are":
 *
 * 1. Only existing workspace vocabulary can be suggested. A model never
 *    invents a label, and it never creates a project.
 * 2. A manual decision wins. A pinned field is skipped entirely, and a
 *    rejected label is never offered again for that revision.
 * 3. A suggestion carries the extracted span that justifies it, so "Why?"
 *    shows evidence rather than an explanation the model made up.
 *
 * Suggestions are background work: they take the background share of the
 * provider quota and never borrow interactive capacity.
 */

/** Labels one request may ask about, so the shortlist is deterministic. */
export const SUGGESTION_VOCABULARY_MAX = 30;
/** Score at or above which a suggestion is worth showing at all. */
export const SUGGESTION_MIN_SCORE = 2;

export interface SuggestionRunOutcome {
  suggested: number;
  skipped: string | null;
}

export async function runSuggestionJob(
  leased: LeasedFileIndexJob,
  dependencies: {
    evaluator?: JevEvaluator;
    configured?: () => boolean;
  } = {},
): Promise<SuggestionRunOutcome> {
  const { job, leaseOwner } = leased;
  const configured = dependencies.configured ?? isJevConfigured;

  if (!configured()) {
    await completeFileIndexJob({ jobId: job.id, leaseOwner });
    return { suggested: 0, skipped: "model-disabled" };
  }

  const resource = await prisma.fileResource.findUnique({
    where: { id: job.resourceId },
    select: {
      id: true,
      workspaceId: true,
      displayName: true,
      sourceKind: true,
      sourceScope: true,
      ownerUserId: true,
      ownerOrganizationId: true,
      contentRevision: true,
      tombstonedAt: true,
      versions: {
        where: { revision: job.contentRevision },
        select: {
          id: true,
          chunks: {
            orderBy: { ordinal: "asc" },
            take: 3,
            select: { text: true, chunkId: true, anchor: true },
          },
        },
      },
    },
  });

  if (
    !resource ||
    resource.tombstonedAt ||
    resource.versions.length === 0 ||
    resource.versions[0].chunks.length === 0
  ) {
    await completeFileIndexJob({ jobId: job.id, leaseOwner });
    return { suggested: 0, skipped: "no-text" };
  }

  const scope = await ensureEvidenceScope({
    workspaceId: resource.workspaceId,
    sourceKind: resource.sourceKind,
    sourceScope: resource.sourceScope,
    sourceId: resource.ownerUserId ?? resource.ownerOrganizationId ?? "",
  });

  const overrides = await prisma.fileFieldOverride.findMany({
    where: { resourceId: resource.id, evidenceScopeId: scope.id },
    select: { field: true, labelId: true, decision: true },
  });

  const pinnedFields = new Set(
    overrides
      .filter((entry) => entry.decision === FileFieldOverrideDecision.PIN)
      .map((entry) => entry.field),
  );
  const rejectedLabelIds = new Set(
    overrides
      .filter(
        (entry) =>
          entry.decision === FileFieldOverrideDecision.REJECT && entry.labelId,
      )
      .map((entry) => entry.labelId as string),
  );

  const vocabulary = await prisma.workspaceLabel.findMany({
    where: {
      workspaceId: resource.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      id: { notIn: [...rejectedLabelIds] },
    },
    orderBy: [{ kind: "asc" }, { normalizedName: "asc" }],
    take: SUGGESTION_VOCABULARY_MAX,
    select: {
      id: true,
      kind: true,
      displayName: true,
      description: true,
      vocabularyVersion: true,
    },
  });

  const shortlist = vocabulary.filter(
    (entry) =>
      !(
        entry.kind === FileLabelKind.CATEGORY && pinnedFields.has("category")
      ) && !(entry.kind === FileLabelKind.TAG && pinnedFields.has("tags")),
  );

  if (shortlist.length === 0) {
    await completeFileIndexJob({ jobId: job.id, leaseOwner });
    return { suggested: 0, skipped: "no-vocabulary" };
  }

  const excerpt = resource.versions[0].chunks
    .map((chunk) => chunk.text)
    .join("\n\n");

  const scheduler = getJevScheduler();
  const evaluator = dependencies.evaluator ?? gatewayJevEvaluator;
  const model = FILES_RANKING_MODEL;
  let suggested = 0;

  /**
   * One actor, used for both the epoch and the admission.
   *
   * These used to differ: the prepared epoch was computed for an empty
   * actor while `admitJevRequest` recomputed it for the resource owner.
   * `resolveScopeEpoch` hashes `userId` and `organizationId`, so the two
   * never matched and admission was denied for every owned resource — which
   * is every resource. The pipeline could not suggest anything, and said so
   * nowhere: the job completed as a success with zero suggestions.
   */
  const workerActor: FileActor = {
    userId: resource.ownerUserId ?? "",
    organizationId: resource.ownerOrganizationId,
    kind: "worker",
  };

  // One bounded request per candidate label. The rubric is a short ladder of
  // boolean questions, so a reply is a set of booleans we can validate and
  // place on the 0-3 scale, not prose to parse.
  for (const entry of shortlist) {
    const request = buildJevLabelRequest({
      documentExcerpt: excerpt,
      vocabulary: [
        {
          id: entry.id,
          name: entry.displayName,
          description: entry.description,
        },
      ],
      projects: [],
    });
    if (isJevRequestRejection(request)) continue;

    const decision = scheduler.tryAdmit({
      workspaceId: resource.workspaceId,
      workClass: "background",
      inputTokens: request.tokens,
    });
    if (!decision.admitted) break;

    const admission = await admitJevRequest({
      workspaceId: resource.workspaceId,
      actor: workerActor,
      purpose: "label-suggest",
      payloadDigest: request.digest,
      inputTokens: request.tokens,
      model,
      preparedEpoch: await resolveScopeEpoch({
        workspaceId: resource.workspaceId,
        actor: workerActor,
      }),
    });
    if (!admission) {
      // Local refusal, not a provider failure: give the slot back without
      // telling the breaker anything.
      scheduler.release();
      break;
    }

    const outcome = await evaluator.evaluate({
      request,
      rubric: "belongs",
    });
    scheduler.settle(outcome.ok ? "ok" : "failed");
    await recordJevDispatch({
      admissionId: admission.id,
      outcome: outcome.ok ? "scored" : (outcome.reason ?? "failed"),
    });

    if (!outcome.ok || outcome.score === null) continue;
    if (outcome.score < SUGGESTION_MIN_SCORE) continue;

    const evidence = resource.versions[0].chunks[0];

    await prisma.fileLabel.upsert({
      where: {
        resourceId_labelId_evidenceScopeId: {
          resourceId: resource.id,
          labelId: entry.id,
          evidenceScopeId: scope.id,
        },
      },
      create: {
        resourceId: resource.id,
        labelId: entry.id,
        state: FileMetadataState.SUGGESTED,
        provenance: FileMetadataProvenance.MODEL,
        evidenceScopeId: scope.id,
        evidenceDigest: request.digest,
        // An extracted span, quoted. Never a generated explanation.
        evidenceSnippet: evidence.text.slice(0, 240),
        evidenceAnchor: evidence.anchor ?? undefined,
        contentRevision: resource.contentRevision,
        vocabularyVersion: entry.vocabularyVersion,
      },
      // An existing confirmed or rejected row is a decision. It stands.
      update: {},
    });
    suggested += 1;
  }

  await completeFileIndexJob({ jobId: job.id, leaseOwner });
  return { suggested, skipped: null };
}

export interface SuggestionSyncResult {
  processed: number;
  suggested: number;
  failed: number;
}

export async function processFileSuggestionJobs(input: {
  shouldContinue: () => boolean;
  maxJobs?: number;
}): Promise<SuggestionSyncResult> {
  const maxJobs = input.maxJobs ?? 10;
  const result: SuggestionSyncResult = {
    processed: 0,
    suggested: 0,
    failed: 0,
  };

  while (result.processed < maxJobs && input.shouldContinue()) {
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    if (!leased) break;

    result.processed += 1;
    try {
      const outcome = await runSuggestionJob(leased);
      result.suggested += outcome.suggested;
    } catch (error) {
      result.failed += 1;
      await failFileIndexJob({
        jobId: leased.job.id,
        leaseOwner: leased.leaseOwner,
        attempt: leased.job.attempt,
        error: error instanceof Error ? error.message : "suggestion failed",
      });
    }
  }

  return result;
}

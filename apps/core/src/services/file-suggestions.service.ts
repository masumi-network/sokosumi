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
  deferFileIndexJob,
  failFileIndexJob,
  type LeasedFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import { admitJevRequest, recordJevDispatch } from "@/lib/files/jev-admission";
import type { JevLabelEvaluator } from "@/lib/files/jev-client";
import { gatewayJevEvaluator, isJevConfigured } from "@/lib/files/jev-client";
import {
  buildJevLabelRequest,
  isJevRequestRejection,
  labelExcerptFromChunks,
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
 * 3. A suggestion carries an extracted span, never an explanation the
 *    model made up. **It is the document's opening, not the passage that
 *    justifies that particular label** — this rule used to claim the
 *    latter and the code has never done it. One boolean per label in one
 *    call returns no per-label span, so every suggestion on a document
 *    shows the same first 240 characters of chunk 0. For a label whose
 *    support is on page 7 the quoted evidence is unrelated to it, and a
 *    reader cannot tell that from a working per-label feature.
 *
 *    Closing it honestly needs either a product decision to stop calling
 *    it justification, or a second question asking the model which passage
 *    supports each label. Neither is done here; the claim is corrected so
 *    the next reader is not misled by it.
 *
 * Suggestions are background work: they take the background share of the
 * provider quota and never borrow interactive capacity.
 */

/** Labels one request may ask about, so the shortlist is deterministic. */
export const SUGGESTION_VOCABULARY_MAX = 30;

/**
 * Slots each kind keeps even when the other has more labels than the
 * window.
 *
 * The shortlist was one query, `ORDER BY kind ASC, normalizedName ASC`
 * with `take: 30`. Postgres orders an enum by *declaration* order, and
 * `FileLabelKind` declares `TAG` before `CATEGORY`, so tags sorted first
 * and filled the window. A workspace with 30 or more tags sent **zero**
 * categories to the evaluator and could never receive a category
 * suggestion again — while the reader saw "Uncategorized", which is also
 * what a document the model considered and declined looks like.
 *
 * Nothing caps label creation, so a workspace reaches that by doing what
 * the product invites.
 *
 * Reversing the sort would have been the same defect pointed the other
 * way: categories would then starve tags. Reordering the enum would have
 * fixed this query by accident, as a migration against live data, while
 * leaving every other `ORDER BY kind` silently dependent on the new
 * order. So the query allocates instead.
 *
 * **What happens when one kind alone exceeds the window.** Each kind is
 * guaranteed this many slots, or all it has if it has fewer. Whatever is
 * left over is shared out in proportion to what each kind still has
 * waiting, so the larger set gets more of the remainder without the
 * smaller one ever reaching zero. A workspace with 500 tags and 4
 * categories asks about all 4 categories and 26 tags; one with 500 tags
 * and 500 categories asks about 15 of each; one with 500 tags and no
 * categories asks about 30 tags, because a floor reserves nothing for a
 * kind that does not exist.
 */
export const SUGGESTION_KIND_FLOOR = 10;

/** Which kinds, if any, had labels that did not fit the window. */
export type VocabularyTruncation = "none" | "tags" | "categories" | "both";

export interface VocabularySlots {
  categories: number;
  tags: number;
  truncated: VocabularyTruncation;
}

/**
 * Share the shortlist window between the two kinds.
 *
 * Exported because it is the whole of the fix and it is pure: the query
 * around it is two `findMany` calls, and everything that could go wrong
 * with starving a kind is decidable from two counts.
 *
 * The rule, in order:
 *
 * 1. Each kind is guaranteed `SUGGESTION_KIND_FLOOR` slots, or all it has
 *    if it has fewer. A kind with nothing reserves nothing.
 * 2. What is left is shared in proportion to what each kind still has
 *    waiting, so a much larger set gets most of the remainder.
 * 3. Any slot left by rounding goes to categories, which are the smaller
 *    and more consequential set — a document has one category and many
 *    tags, so a missing category is more visible than a missing tag.
 */
export function allocateVocabularySlots(input: {
  categories: number;
  tags: number;
}): VocabularySlots {
  const window = SUGGESTION_VOCABULARY_MAX;
  const { categories: haveCategories, tags: haveTags } = input;

  if (haveCategories + haveTags <= window) {
    return { categories: haveCategories, tags: haveTags, truncated: "none" };
  }

  let categories = Math.min(haveCategories, SUGGESTION_KIND_FLOOR);
  let tags = Math.min(haveTags, SUGGESTION_KIND_FLOOR);

  const spare = window - categories - tags;
  const categoriesWaiting = haveCategories - categories;
  const tagsWaiting = haveTags - tags;
  const waiting = categoriesWaiting + tagsWaiting;

  if (spare > 0 && waiting > 0) {
    // Rounded down so the two shares can never exceed the window; the
    // remainder is handed out below.
    const categoryShare = Math.min(
      categoriesWaiting,
      Math.floor((spare * categoriesWaiting) / waiting),
    );
    const tagShare = Math.min(
      tagsWaiting,
      Math.floor((spare * tagsWaiting) / waiting),
    );
    categories += categoryShare;
    tags += tagShare;

    let remainder = window - categories - tags;
    // Categories first, then tags, and only as far as each can use.
    const extraCategories = Math.min(remainder, haveCategories - categories);
    categories += extraCategories;
    remainder -= extraCategories;
    tags += Math.min(remainder, haveTags - tags);
  }

  const cutCategories = categories < haveCategories;
  const cutTags = tags < haveTags;

  return {
    categories,
    tags,
    truncated:
      cutCategories && cutTags
        ? "both"
        : cutCategories
          ? "categories"
          : cutTags
            ? "tags"
            : "none",
  };
}
/** Score at or above which a suggestion is worth showing at all. */
export interface SuggestionRunOutcome {
  suggested: number;
  skipped: string | null;
  /**
   * Which kinds had labels that did not fit the shortlist window.
   *
   * A cap that fires and tells nobody is the defect this feature has
   * produced repeatedly, and truncating 47 labels to 30 used to emit
   * nothing at all while the wave reported success. A closed vocabulary,
   * deliberately: which kinds were cut, and not how many, which ones, or
   * anything about the request.
   *
   * Returned on every path that reaches the allocation, not only on
   * success. The cap fires when the shortlist is built, which is before
   * the model is asked, so a document that was then deferred or failed
   * had its vocabulary cut just the same — and reporting it only when
   * everything else went well is the same cap-that-tells-nobody one step
   * along.
   *
   * `processFileSuggestionJobs` counts it. A field the caller does not
   * read is a log line with extra steps, and this one was added with a
   * docstring about exactly that.
   */
  vocabularyTruncated?: VocabularyTruncation;
  /**
   * True when the run ended because capacity refused it, not because the
   * document had nothing to say. The job is back in the queue, unchanged.
   */
  deferred?: boolean;
  /**
   * True when a call was dispatched and the provider did not answer
   * usefully. The job is FAILED and will be retried; it was not a verdict
   * about the document.
   */
  failed?: boolean;
  /**
   * True when the workspace has no label vocabulary at all, so there was
   * nothing to ask about. Distinct from a vocabulary the model read and
   * declined, and from one this document's reader has pinned.
   */
  noVocabulary?: boolean;
}

export async function runSuggestionJob(
  leased: LeasedFileIndexJob,
  dependencies: {
    evaluator?: JevLabelEvaluator;
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

  /**
   * One query per kind, so neither can consume the other's slots.
   *
   * Each asks for a full window: the allocation below needs to know how
   * many each kind *has* before it can decide how many each kind gets,
   * and asking for one more than the window is what tells it a kind was
   * cut at all.
   */
  const byKind = await Promise.all(
    [FileLabelKind.CATEGORY, FileLabelKind.TAG].map(async (kind) => ({
      kind,
      entries: await prisma.workspaceLabel.findMany({
        where: {
          workspaceId: resource.workspaceId,
          archivedAt: null,
          mergedIntoId: null,
          kind,
          id: { notIn: [...rejectedLabelIds] },
        },
        orderBy: [{ normalizedName: "asc" }],
        take: SUGGESTION_VOCABULARY_MAX + 1,
        select: {
          id: true,
          kind: true,
          displayName: true,
          description: true,
          vocabularyVersion: true,
        },
      }),
    })),
  );

  const available = new Map(byKind.map((row) => [row.kind, row.entries]));
  const allocation = allocateVocabularySlots({
    categories: available.get(FileLabelKind.CATEGORY)?.length ?? 0,
    tags: available.get(FileLabelKind.TAG)?.length ?? 0,
  });

  const vocabulary = [
    ...(available.get(FileLabelKind.CATEGORY) ?? []).slice(
      0,
      allocation.categories,
    ),
    ...(available.get(FileLabelKind.TAG) ?? []).slice(0, allocation.tags),
  ];

  if (allocation.truncated !== "none") {
    // Said out loud rather than inferred from a count nobody compares.
    // This is the only signal that a workspace has outgrown the window,
    // and the workspace owner is the only person who can act on it.
    console.info("[files] label vocabulary did not fit the shortlist", {
      resourceId: resource.id,
      workspaceId: resource.workspaceId,
      truncated: allocation.truncated,
      asked: allocation.categories + allocation.tags,
    });
  }

  const shortlist = vocabulary.filter(
    (entry) =>
      !(
        entry.kind === FileLabelKind.CATEGORY && pinnedFields.has("category")
      ) && !(entry.kind === FileLabelKind.TAG && pinnedFields.has("tags")),
  );

  if (shortlist.length === 0) {
    /**
     * Why there was nothing to ask about, not just that there was
     * nothing.
     *
     * These two cases produced the same record and they are not the same
     * thing. A workspace that has never created a tag or a category is
     * the *first* state every workspace is in: there is one
     * `workspaceLabel.create` in the product and nothing seeds a default
     * vocabulary, so until somebody invents a label by hand every
     * document lands here. A document whose whole vocabulary the reader
     * has pinned is a considered outcome and lands here too.
     *
     * Both used to close as SUCCEEDED with a null `lastError`, no label
     * rows and a tick reading `{ processed: 1, suggested: 0 }` — byte for
     * byte what a document the model read and declined produces. So the
     * guaranteed first experience of the feature was recorded as "we
     * looked and found nothing", and no caller, reader or operator could
     * tell it from "we asked and were told no".
     *
     * One count query separates them. Nothing else changes: the job still
     * completes, no model is called, and there is no new job state — a
     * document with no vocabulary to compare it against is genuinely
     * done, and re-suggesting once a first label exists is a separate
     * question with a cost attached to it.
     */
    const vocabularySize = await prisma.workspaceLabel.count({
      where: {
        workspaceId: resource.workspaceId,
        archivedAt: null,
        mergedIntoId: null,
      },
    });

    await completeFileIndexJob({ jobId: job.id, leaseOwner });

    if (vocabularySize === 0) {
      // Said out loud, in the same place and the same shape as the
      // truncation notice above: this is the one signal that a workspace
      // has no vocabulary at all, and its owner is the only person who
      // can do anything about it.
      console.info("[files] workspace has no label vocabulary yet", {
        resourceId: resource.id,
        workspaceId: resource.workspaceId,
        consequence:
          "Nothing was asked and nothing was suggested. This document is " +
          "not re-examined on its own when a first label is created.",
      });
      return {
        suggested: 0,
        skipped: "no-vocabulary",
        noVocabulary: true,
        vocabularyTruncated: allocation.truncated,
      };
    }

    // A vocabulary exists and this document's reader has pinned all of
    // it. That is a decision, not an empty workspace.
    return {
      suggested: 0,
      skipped: "vocabulary-pinned",
      vocabularyTruncated: allocation.truncated,
    };
  }

  // Only as much of the document as the excerpt budget can carry. See
  // `labelExcerptFromChunks`: joining every chunk built an 800,000
  // character string to send 2,048 tokens of it, which PDFs turned from a
  // rare case into the ordinary one.
  const excerpt = labelExcerptFromChunks(resource.versions[0].chunks);

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

  /**
   * One request for the whole shortlist.
   *
   * This was one request per candidate label — up to 30 per document, each
   * carrying the same 2,048-token excerpt, each with its own admission row
   * and scheduler reservation. The background bucket holds three, so the
   * loop reliably ran out of quota part-way and completed the job anyway,
   * silently leaving the document partly labelled. One call asks about
   * every label at once, and a quota refusal now requeues instead of
   * pretending the work is done.
   */
  /**
   * Captured with the payload, not at the admission call.
   *
   * It used to be resolved inline as an argument to `admitJevRequest`,
   * one round trip before that function makes the identical call and
   * compares the two. A value compared against itself cannot differ, so
   * the check could only ever produce false positives; the parameter
   * exists to carry an epoch from the moment the payload was built, which
   * is here.
   *
   * What the window is worth here is a separate question, and the honest
   * answer is: nothing at all, today.
   *
   * `resolveScopeEpoch` aggregates over
   * `sourceKind IN sourceKindsForActor(actor.kind)`, and `"worker"` — the
   * kind built just above, and the only `worker` actor in the application
   * — appears in no entry of `SOURCE_ACTOR_CEILING`. The list is empty,
   * the aggregate therefore runs over no rows whatever the workspace
   * holds, and the hash reduces to a function of the workspace and actor
   * identity. On this path `admitJevRequest` compares a constant with
   * itself and can never deny. Pinned by "cannot refuse anything for the
   * actor the label pipeline uses" in `file-suggestions.postgres.test.ts`.
   *
   * Two further limits hold even once that is fixed. The epoch hashes the
   * *count* of scope rows and their `scopeVersion`s, and `scopeVersion` is
   * never advanced anywhere — the only write to `file_evidence_scope`
   * outside creation is the backfill cursor. So it would move when a scope
   * is added and still not when access is taken away. See
   * `evidence-scope.ts`, which says the same at more length.
   *
   * Capturing the value at the right moment costs nothing and is the shape
   * the parameter asks for, so it is done. Relying on it to catch a
   * revocation would be a mistake. Widening the ceiling to admit `worker`
   * is not done here: `buildAuthorizedResourceSql` returns `FALSE` for an
   * empty kind list, so that edit is an authorization change rather than a
   * correction, and it belongs in its own commit with its own review.
   */
  const preparedEpoch = await resolveScopeEpoch({
    workspaceId: resource.workspaceId,
    actor: workerActor,
  });

  const request = buildJevLabelRequest({
    documentExcerpt: excerpt,
    vocabulary: shortlist.map((entry) => ({
      id: entry.id,
      name: entry.displayName,
      description: entry.description,
    })),
    projects: [],
  });
  if (isJevRequestRejection(request)) {
    await completeFileIndexJob({ jobId: job.id, leaseOwner });
    return {
      suggested: 0,
      skipped: "request-too-large",
      vocabularyTruncated: allocation.truncated,
    };
  }

  const decision = scheduler.tryAdmit({
    workspaceId: resource.workspaceId,
    workClass: "background",
    inputTokens: request.tokens,
  });
  if (!decision.admitted) {
    // Quota, not a verdict. `failFileIndexJob` requeued but spent one of
    // five attempts, so a run of capacity refusals failed the document for
    // good; a refusal has to cost it nothing.
    await deferFileIndexJob({ jobId: job.id, leaseOwner });
    return {
      suggested: 0,
      skipped: `quota:${decision.reason}`,
      deferred: true,
      vocabularyTruncated: allocation.truncated,
    };
  }

  const admission = await admitJevRequest({
    workspaceId: resource.workspaceId,
    actor: workerActor,
    purpose: "label-suggest",
    payloadDigest: request.digest,
    inputTokens: request.tokens,
    model,
    preparedEpoch,
  });
  if (!admission) {
    // Local refusal, not a provider failure: give the slot back without
    // telling the breaker anything.
    scheduler.release();
    // And not a verdict about the document either. This used to complete
    // the job, so a refusal recorded the document as done with zero
    // suggestions and it was never looked at again — a capacity problem
    // turned into a permanent result, invisible in a tick that reported
    // one processed and nothing failed.
    await deferFileIndexJob({ jobId: job.id, leaseOwner });
    return {
      suggested: 0,
      skipped: "admission-denied",
      deferred: true,
      vocabularyTruncated: allocation.truncated,
    };
  }

  const verdict = await evaluator.evaluateLabels({
    request,
    // The builder hands back exactly what it measured. Asking about
    // anything else would make the charged envelope a fiction again.
    labels: request.askedLabels,
  });
  scheduler.settle(verdict.ok ? "ok" : "failed");
  await recordJevDispatch({
    admissionId: admission.id,
    outcome: verdict.ok ? "scored" : (verdict.reason ?? "failed"),
    // Summed by the daily spend budget; see `recordJevDispatch`.
    costUsd: verdict.costUsd,
  });

  if (!verdict.ok) {
    /**
     * Failed, not completed. The call went out and the provider did not
     * answer usefully, which is not a verdict about this document.
     *
     * `completeFileIndexJob` here recorded the job SUCCEEDED with zero
     * labels and a null `lastError`. Nothing re-leases a SUCCEEDED job
     * and nothing re-enqueues a SUGGEST on a timer, so the document was
     * permanently unlabelled: the loss survived the provider recovering
     * and survived a restart. Measured, one rejected dispatch put thirty
     * documents in that state.
     *
     * Failing instead gets the bounded retries the job machinery already
     * has, and leaves a state a person can see. A document the model
     * genuinely declined still completes — that is the branch below, and
     * the two must stay distinguishable.
     */
    await failFileIndexJob({
      jobId: job.id,
      leaseOwner,
      attempt: job.attempt,
      error: verdict.reason ?? "evaluation-failed",
    });
    return {
      suggested: 0,
      skipped: verdict.reason ?? "evaluation-failed",
      failed: true,
      vocabularyTruncated: allocation.truncated,
    };
  }

  const chosen = new Set(verdict.chosen);
  const evidence = resource.versions[0].chunks[0];

  for (const entry of shortlist) {
    if (!chosen.has(entry.id)) continue;

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
        // An extracted span, quoted, never a generated explanation — but
        // the document's opening, not the passage supporting this label.
        // Identical for every label on this document. See rule 3.
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
  return {
    suggested,
    skipped: null,
    vocabularyTruncated: allocation.truncated,
  };
}

export interface SuggestionSyncResult {
  processed: number;
  suggested: number;
  failed: number;
  /**
   * Jobs put back untouched because capacity refused them. Counted apart
   * from `processed` so a throttled minute cannot be read as a quiet one.
   */
  deferred: number;
  /**
   * Documents in a workspace that has no label vocabulary at all.
   *
   * Still processed and still complete — there was genuinely nothing to
   * ask — but counted apart, because a tick of these is not a tick of
   * documents the model considered and declined. Without it the two read
   * identically at every surface outside the function, and this is the
   * state every workspace starts in.
   */
  noVocabulary: number;
  /**
   * Documents whose workspace vocabulary did not fit the shortlist
   * window, by kind.
   *
   * `runSuggestionJob` has computed this all along and nothing read it.
   * A workspace that has outgrown the window gets suggestions drawn from
   * part of its vocabulary and is told nothing, which is the same defect
   * as the cap that fires silently — the signal existed and stopped one
   * frame short of anybody who could act on it.
   */
  vocabularyTruncated: { tags: number; categories: number };
}

export async function processFileSuggestionJobs(input: {
  shouldContinue: () => boolean;
  maxJobs?: number;
  /** Same seam as `runSuggestionJob`, so a tick can be exercised. */
  dependencies?: {
    evaluator?: JevLabelEvaluator;
    configured?: () => boolean;
  };
}): Promise<SuggestionSyncResult> {
  const maxJobs = input.maxJobs ?? 10;
  const result: SuggestionSyncResult = {
    processed: 0,
    suggested: 0,
    failed: 0,
    deferred: 0,
    noVocabulary: 0,
    vocabularyTruncated: { tags: 0, categories: 0 },
  };

  // Bounded by jobs *looked at*, not jobs processed: a deferral does not
  // count as processed, and without its own counter a throttled queue
  // would walk the whole backlog in one tick.
  let visited = 0;
  while (visited < maxJobs && input.shouldContinue()) {
    visited += 1;
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.SUGGEST,
    });
    if (!leased) break;

    result.processed += 1;
    try {
      const outcome = await runSuggestionJob(leased, input.dependencies ?? {});
      result.suggested += outcome.suggested;
      if (outcome.deferred) {
        result.deferred += 1;
        // A deferred job was not processed — it is still waiting. Counting
        // it as processed is what let a refused document look like a
        // document with nothing to suggest. The loop carries on, because
        // the refusal may have been this workspace's budget rather than
        // everyone's, and the job it just put back is held off by its own
        // `runAfter`.
        result.processed -= 1;
      }
      if (outcome.failed) {
        // Same arithmetic as the deferral above, for the same reason: a
        // document the provider failed is not a document that was
        // processed, and counting it as both makes the sync line read
        // clean straight through an outage.
        result.failed += 1;
        result.processed -= 1;
      }
      if (outcome.noVocabulary) {
        // Counted, not subtracted: this document really was processed and
        // really is done. What it was not is a document the model had an
        // opinion about.
        result.noVocabulary += 1;
      }
      // "both" is both, which is why these are two counters and not one
      // flag: a workspace can outgrow the window on one side only.
      if (
        outcome.vocabularyTruncated === "tags" ||
        outcome.vocabularyTruncated === "both"
      ) {
        result.vocabularyTruncated.tags += 1;
      }
      if (
        outcome.vocabularyTruncated === "categories" ||
        outcome.vocabularyTruncated === "both"
      ) {
        result.vocabularyTruncated.categories += 1;
      }
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

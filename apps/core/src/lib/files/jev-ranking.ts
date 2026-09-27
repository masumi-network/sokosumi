import type { FileActor } from "@/lib/files/actor";
import {
  admitJevRequest,
  isAdmissionDispatchable,
  recordJevDispatch,
} from "@/lib/files/jev-admission";
import type { JevEvaluator } from "@/lib/files/jev-client";
import { gatewayJevEvaluator, isJevConfigured } from "@/lib/files/jev-client";
import {
  buildJevRelatedPairRequest,
  buildJevSearchPairRequest,
  isJevRequestRejection,
} from "@/lib/files/jev-request";
import { FILES_RANKING_MODEL } from "@/lib/files/jev-rubrics";
import type { JevWorkClass } from "@/lib/files/jev-scheduler";
import {
  getJevScheduler,
  PER_QUERY_MAX_CONCURRENT,
  RANK_DEADLINE_MS,
} from "@/lib/files/jev-scheduler";
import type { FileCandidate } from "@/lib/files/retrieval";

/**
 * The bounded reordering stage.
 *
 * It is all-or-nothing on purpose. If any pair is missing, invalid, denied
 * or late, the *whole* original fused order is returned — a half-scored list
 * would mix two scales and read as a worse ranking than either.
 *
 * Exact filename matches are protected in code, above this stage. Nothing a
 * model returns can move them.
 */

/** Only the head of the window is worth a paid call. */
export const SEARCH_RERANK_CANDIDATES = 24;
export const RELATED_RERANK_CANDIDATES = 12;

export type RankingMode = "deterministic" | "model";

export interface RankingOutcome {
  candidates: FileCandidate[];
  mode: RankingMode;
  /** Why the model stage did not apply, for logs and the honest UI copy. */
  fallbackReason: string | null;
  evaluated: number;
}

/**
 * The authorization step, injectable so a test can exercise the ordering
 * rules without a database. Production always passes the real admission,
 * which is the only thing allowed to authorize a dispatch.
 */
export interface RerankDependencies {
  evaluator?: JevEvaluator;
  configured?: () => boolean;
  admit?: typeof admitJevRequest;
  recordDispatch?: typeof recordJevDispatch;
  scheduler?: ReturnType<typeof getJevScheduler>;
  now?: () => number;
}

export interface RerankInput extends RerankDependencies {
  workspaceId: string;
  actor: FileActor;
  epoch: string;
  query: string;
  candidates: FileCandidate[];
  workClass?: JevWorkClass;
  /** Seed passages, for related-document ranking. Empty means search. */
  seedPassages?: string[];
}

interface PairScore {
  resourceId: string;
  score: number;
}

/**
 * Run the bounded pair evaluations and reorder, or return the input order
 * unchanged with a reason. Never throws: a ranking stage that can fail a
 * search is worse than a search that is merely ordered lexically.
 */
export async function rerankFileCandidates(
  input: RerankInput,
): Promise<RankingOutcome> {
  const unchanged = (reason: string | null): RankingOutcome => ({
    candidates: input.candidates,
    mode: "deterministic",
    fallbackReason: reason,
    evaluated: 0,
  });

  const configured = input.configured ?? isJevConfigured;
  if (!configured()) return unchanged("model-disabled");
  if (input.candidates.length < 2) return unchanged("nothing-to-reorder");

  const isRelated = (input.seedPassages?.length ?? 0) > 0;
  const headSize = isRelated
    ? RELATED_RERANK_CANDIDATES
    : SEARCH_RERANK_CANDIDATES;

  // Protected exact matches keep their positions and are not paid for.
  const protectedHead = input.candidates.filter(
    (candidate) => candidate.exactNameMatch,
  );
  const rankable = input.candidates.filter(
    (candidate) => !candidate.exactNameMatch,
  );
  const head = rankable.slice(0, headSize);
  const tail = rankable.slice(headSize);

  if (head.length < 2) return unchanged("nothing-to-reorder");

  const scheduler = input.scheduler ?? getJevScheduler();
  const evaluator = input.evaluator ?? gatewayJevEvaluator;
  const admit = input.admit ?? admitJevRequest;
  const recordDispatch = input.recordDispatch ?? recordJevDispatch;
  const clock = input.now ?? (() => Date.now());
  const model = FILES_RANKING_MODEL;
  const workClass = input.workClass ?? "interactive";
  const deadline = clock() + RANK_DEADLINE_MS;

  const scores: PairScore[] = [];
  let failure: string | null = null;

  // Waves of at most six concurrent pairs per query. The deadline covers all
  // of them together, not each one.
  for (
    let offset = 0;
    offset < head.length;
    offset += PER_QUERY_MAX_CONCURRENT
  ) {
    if (failure) break;
    if (clock() >= deadline) {
      failure = "rank-deadline";
      break;
    }

    const wave = head.slice(offset, offset + PER_QUERY_MAX_CONCURRENT);
    const results = await Promise.all(
      wave.map(async (candidate): Promise<PairScore | { failed: string }> => {
        const request = isRelated
          ? buildJevRelatedPairRequest({
              seedPassages: input.seedPassages ?? [],
              candidateId: candidate.resourceId,
              candidateTitle: candidate.displayName,
              candidateExcerpt:
                candidate.bestChunkText ?? candidate.displayName,
            })
          : buildJevSearchPairRequest({
              query: input.query,
              candidateId: candidate.resourceId,
              candidateTitle: candidate.displayName,
              candidateExcerpt:
                candidate.bestChunkText ?? candidate.displayName,
            });

        if (isJevRequestRejection(request)) {
          return { failed: `request-rejected:${request.reason}` };
        }

        const decision = scheduler.tryAdmit({
          workspaceId: input.workspaceId,
          workClass,
          inputTokens: request.tokens,
        });
        if (!decision.admitted) return { failed: `quota:${decision.reason}` };

        try {
          const admission = await admit({
            workspaceId: input.workspaceId,
            actor: input.actor,
            purpose: isRelated ? "related-rank" : "search-rank",
            payloadDigest: request.digest,
            inputTokens: request.tokens,
            model,
            preparedEpoch: input.epoch,
          });

          // Both of these refuse before anything is dispatched, so the slot
          // comes back but the breaker hears nothing: it watches the
          // provider, and our own authorization decisions are not its
          // business.
          if (!admission) {
            scheduler.release();
            return { failed: "admission-denied" };
          }
          if (!isAdmissionDispatchable(admission)) {
            scheduler.release();
            await recordDispatch({
              admissionId: admission.id,
              outcome: "expired-before-dispatch",
            });
            return { failed: "admission-expired" };
          }

          const outcome = await evaluator.evaluate({
            request,
            rubric: "relevance",
          });

          scheduler.settle(outcome.ok ? "ok" : "failed");
          await recordDispatch({
            admissionId: admission.id,
            outcome: outcome.ok ? "scored" : (outcome.reason ?? "failed"),
          });

          if (!outcome.ok || outcome.score === null) {
            return { failed: `evaluation:${outcome.reason ?? "invalid"}` };
          }

          return { resourceId: candidate.resourceId, score: outcome.score };
        } catch {
          scheduler.settle("failed");
          return { failed: "evaluation:threw" };
        }
      }),
    );

    for (const result of results) {
      if ("failed" in result) {
        failure ??= result.failed;
        continue;
      }
      scores.push(result);
    }
  }

  if (failure) return unchanged(failure);
  if (scores.length !== head.length) return unchanged("incomplete-batch");

  const scoreById = new Map(
    scores.map((entry) => [entry.resourceId, entry.score]),
  );
  const reordered = [...head].sort((left, right) => {
    const byScore =
      (scoreById.get(right.resourceId) ?? 0) -
      (scoreById.get(left.resourceId) ?? 0);
    if (byScore !== 0) return byScore;
    // Ties fall back to the fused order, then to a stable id.
    if (left.fusedScore !== right.fusedScore) {
      return right.fusedScore - left.fusedScore;
    }
    return left.resourceId.localeCompare(right.resourceId);
  });

  return {
    candidates: [...protectedHead, ...reordered, ...tail],
    mode: "model",
    fallbackReason: null,
    evaluated: scores.length,
  };
}

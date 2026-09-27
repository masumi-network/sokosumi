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
/**
 * How deep re-ranking goes — one wave, deliberately.
 *
 * These were 24 and 12, which at `PER_QUERY_MAX_CONCURRENT = 6` is four and
 * two sequential waves of a model call. `RANK_DEADLINE_MS` is 600 ms and
 * covers all of them together, so at any realistic latency the later waves
 * could not finish inside it — and because re-ranking is all-or-nothing,
 * the reader got the deterministic order anyway after paying for every call
 * that did complete. Deep and never applied is worse than shallow and
 * applied: the head is what a reader looks at.
 */
export const SEARCH_RERANK_CANDIDATES = 6;
export const RELATED_RERANK_CANDIDATES = 6;

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
  const clock = input.now ?? (() => Date.now());
  const rankingStartedAt = clock();

  /**
   * Reasons that are configuration or triviality rather than a failure.
   *
   * A disabled model and a list too short to reorder would otherwise put a
   * line on every single search in an environment with the flag off.
   */
  const QUIET_REASONS = new Set(["model-disabled", "nothing-to-reorder"]);

  const unchanged = (reason: string | null): RankingOutcome => {
    /**
     * Say why the model stage did not apply.
     *
     * This exists because a real search against the real provider fell back
     * and **nothing anywhere could say which of five causes it was**.
     * `fallbackReason` was computed and discarded; the latch reports to
     * Sentry; nothing on this path logged. From outside the process a silent
     * fallback is indistinguishable from a healthy deterministic search, so a
     * feature that turns itself off does it invisibly.
     *
     * Three fields, and deliberately only three. The reason strings are our
     * own constants, never provider text and never derived from a document,
     * which is what makes them safe to log — so nothing that is not safe is
     * allowed to join them. No query, no filename, no resource id, no
     * snippet. There is a test that asserts exactly that.
     */
    if (reason !== null && !QUIET_REASONS.has(reason)) {
      console.info("[drive/search] semantic ranking did not apply", {
        reason,
        candidates: input.candidates.length,
        elapsedMs: clock() - rankingStartedAt,
      });
    }

    return {
      candidates: input.candidates,
      mode: "deterministic",
      fallbackReason: reason,
      evaluated: 0,
    };
  };

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

        let settled = false;
        // Hoisted so both paths below can ask the one question that
        // matters: did *we* stop this call, or did the provider fail?
        let deadlineSignal: AbortSignal | null = null;
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

          /**
           * Bound the call by what is left of the rank deadline.
           *
           * `RANK_DEADLINE_MS` was only checked *between* waves while each
           * call got a flat 2 s, so a first wave that ran to its timeout
           * burned ~2 s of a user-facing search — and then the deadline
           * check threw the whole reorder away. Six paid calls and two
           * seconds of waiting, for the deterministic order the reader
           * would have had for free.
           */
          const remaining = Math.max(0, deadline - clock());
          deadlineSignal = AbortSignal.timeout(remaining);
          const outcome = await evaluator.evaluate({
            request,
            // Related pairs carry seed passages and no query, so they are
            // judged by the seed-based rungs. Asking the query rungs about
            // a request with no query was the defect here.
            rubric: isRelated ? "relatedness" : "relevance",
            signal: deadlineSignal,
          });

          /**
           * A deadline we imposed is our own refusal, not a provider
           * failure.
           *
           * It just happens to have a socket attached. Counting it as a
           * failure sample is the thing `release()` exists to prevent, and
           * it opened the breaker after two ordinary searches — denying
           * interactive ranking for a minute over a provider that had not
           * failed once. The provider's own timeout is composed separately
           * inside the client, so this signal firing means us and only us.
           */
          if (deadlineSignal.aborted) {
            scheduler.release();
            settled = true;
            await recordDispatch({
              admissionId: admission.id,
              outcome: "rank-deadline",
            });
            return { failed: "rank-deadline" };
          }

          // Settled before the record is written, and marked so the catch
          // below cannot settle it a second time: a double settle
          // decrements `inFlight` twice (over-admitting later) and adds a
          // breaker sample for one call.
          scheduler.settle(outcome.ok ? "ok" : "failed");
          settled = true;
          await recordDispatch({
            admissionId: admission.id,
            outcome: outcome.ok ? "scored" : (outcome.reason ?? "failed"),
            // The daily spend budget sums this column, so a dispatched call
            // that does not record its cost is a call the budget cannot see.
            costUsd: outcome.costUsd,
          });

          if (!outcome.ok || outcome.score === null) {
            return { failed: `evaluation:${outcome.reason ?? "invalid"}` };
          }

          return { resourceId: candidate.resourceId, score: outcome.score };
        } catch {
          if (!settled) {
            // Same distinction on the throwing path: an abort raised by our
            // own deadline is not evidence about the provider.
            if (deadlineSignal?.aborted) scheduler.release();
            else scheduler.settle("failed");
          }
          return {
            failed: deadlineSignal?.aborted
              ? "rank-deadline"
              : "evaluation:threw",
          };
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

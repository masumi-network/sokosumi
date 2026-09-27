import { createCoreLogger } from "@/lib/evlog";
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
  /**
   * Where a fallback is reported. Injected like every other dependency here
   * rather than reached for globally: this function's whole shape is
   * injection, and a test that holds the sink can assert on the exact payload
   * at the boundary instead of spying on a global side effect.
   */
  rankingLog?: RankingLogSink;
  scheduler?: ReturnType<typeof getJevScheduler>;
  now?: () => number;
}

/** The narrow slice of an evlog logger this uses. */
export interface RankingLogSink {
  set(fields: Record<string, unknown>): void;
  emit(): void;
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
 * What the waves actually observed, collected per candidate.
 *
 * Every field here is an array for one reason: the unit of work is a wave of
 * up to six concurrent pairs, and a scalar per ranking cannot describe six
 * candidates without picking one and implying it spoke for the rest. That is
 * the defect this type exists to make unrepresentable.
 */
interface RankingMeasurement {
  /**
   * Milliseconds from the database minting the grant to this process's
   * dispatch check, one sample per grant that reached the check.
   *
   * This is the quantity `ADMISSION_VALID_MS` has to cover. Emitted on
   * successful rankings too, because the failures are by definition the tail
   * and a window sized on the tail alone is sized on nothing.
   */
  transitMs: number[];
  /** Milliseconds past `expiresAt`, for the grants that arrived expired. */
  expiredByMs: number[];
  /** Every distinct failure reason in the waves, not only the one returned. */
  reasons: Set<string>;
}

/**
 * The measured fields, each present only when it was measured.
 *
 * Absent rather than null throughout, so nothing can be read as "measured,
 * and zero".
 *
 * `expiredByMs` is attributable by construction: it is non-empty only when
 * the dispatch check rejected a grant, which puts `admission-expired` in
 * `reasons`; and `reasons` is emitted whenever the set holds more than one
 * member, so either the singular `reason` *is* `admission-expired` or the
 * `reasons` array names it alongside whatever came first past the post. A
 * reader can always tell which cause the number belongs to, which is the
 * property the previous version claimed and did not have.
 */
function measuredFields(
  measured: RankingMeasurement | undefined,
): Record<string, unknown> {
  if (!measured) return {};
  // Sorted so two events with the same causes are the same line, whatever
  // order the wave happened to settle in.
  const reasons = [...measured.reasons].sort();
  return {
    ...(measured.transitMs.length === 0
      ? {}
      : { grantTransitMs: measured.transitMs }),
    ...(reasons.length > 1 ? { reasons } : {}),
    ...(measured.expiredByMs.length === 0
      ? {}
      : { expiredByMs: Math.max(...measured.expiredByMs) }),
  };
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
   * A disabled model and a single-document corpus would otherwise put a line
   * on every search in an environment with the flag off. `exact-match-head`
   * is deliberately **not** quiet: it reads like the same non-event and is
   * actually ranking being switched off by a filename.
   */
  const QUIET_REASONS = new Set(["model-disabled", "single-candidate"]);

  const emit = (fields: Record<string, unknown>) => {
    const log =
      input.rankingLog ??
      createCoreLogger({ operation: "files_semantic_ranking" });
    log.set({
      candidates: input.candidates.length,
      elapsedMs: clock() - rankingStartedAt,
      ...fields,
    });
    log.emit();
  };

  const unchanged = (
    reason: string | null,
    /**
     * Passed in rather than closed over, which is what makes the attribution
     * structural: the three early returns above the wave have no measurement
     * to hand over, so no measured field can appear on an event that did not
     * take a measurement. The previous version closed over a function-scoped
     * `expiredByMs`, and so printed one candidate's number next to another
     * candidate's reason.
     */
    measured?: RankingMeasurement,
  ): RankingOutcome => {
    /**
     * Say why the model stage did not apply.
     *
     * This exists because a real search against the real provider fell back
     * and **nothing anywhere could say why**. `fallbackReason` was computed
     * and discarded; the latch reports to Sentry; nothing on this path
     * logged. (An earlier version of this comment said "which of five
     * causes"; there are about ten return shapes here, three of them
     * interpolated strings, so the number was wrong and is not replaced with
     * another one. `reasons` exists because the same miscount happens at
     * runtime: a wave of six can fail six ways at once, and `failure ??=`
     * keeps the first and drops the rest.) From outside the process a silent
     * fallback is indistinguishable from a healthy deterministic search, so a
     * feature that turns itself off does it invisibly.
     *
     * Every field is either one of our own constants or a duration we
     * measured. The reason strings are our constants, never provider text
     * and never derived from a document, which is what makes them safe to
     * log — so nothing that is not safe is allowed to join them. No query,
     * no filename, no resource id, no snippet. The test that asserts this is
     * a whole-key-set comparison rather than a list of forbidden fields,
     * because a new field has to be looked at before it can be logged; it is
     * the reason an unconditional `expiredByMs` cannot be added without
     * someone noticing.
     *
     * On `evlog` rather than `console.info`, matching
     * `task-tag-classification.service.ts` — the same kind of Jev model stage
     * on another content type. That is what makes "every Jev stage outcome
     * across Files and task tags" a question someone can actually ask, and it
     * puts the event through the Sentry drain. `createCoreLogger` rather than
     * the request-scoped `useLogger` follows that same precedent: this
     * function has no Hono context by design.
     */
    if (reason !== null && !QUIET_REASONS.has(reason)) {
      emit({ outcome: "fallback", reason, ...measuredFields(measured) });
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
  // One document. Genuinely nothing to order, and not worth a line.
  if (input.candidates.length < 2) return unchanged("single-candidate");

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

  /**
   * Fewer than two candidates *survived the exact-match filter*, which is a
   * different thing from having fewer than two documents.
   *
   * Exact filename matches are pulled out above and never reach the model, so
   * a query that happens to equal a filename removes that document from the
   * rankable set. In a small corpus that silently disables ranking, and it
   * looks exactly like a model problem while being a filename coincidence.
   * It shares no reason string with the trivial case for that reason.
   */
  if (head.length < 2) return unchanged("exact-match-head");

  const scheduler = input.scheduler ?? getJevScheduler();
  const evaluator = input.evaluator ?? gatewayJevEvaluator;
  const admit = input.admit ?? admitJevRequest;
  const recordDispatch = input.recordDispatch ?? recordJevDispatch;
  const model = FILES_RANKING_MODEL;
  const workClass = input.workClass ?? "interactive";
  const deadline = clock() + RANK_DEADLINE_MS;

  const scores: PairScore[] = [];
  const measured: RankingMeasurement = {
    transitMs: [],
    expiredByMs: [],
    reasons: new Set(),
  };
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
      /**
       * Three sites produced the string `rank-deadline`, and the log carried
       * whichever one won. They are three different stories — the budget was
       * already gone before this wave; our own timeout fired while the
       * provider had the call; the call threw and our signal had aborted —
       * and a reader could not tell them apart. Suffixed so each reason maps
       * to exactly one return site, which is the standard the acceptance
       * gate applies.
       */
      failure = "rank-deadline:pre-wave";
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
          /**
           * One clock reading, used for the decision and for both numbers.
           *
           * The check and the measurement previously read `Date.now()` at
           * two different instants, so the recorded overage was not the
           * overage the check saw. It is the same reading now, which is the
           * only way the number can be evidence about the decision.
           *
           * `checkedAt` is this process's clock; `admittedAt` and
           * `expiresAt` are the database's. The comparison crosses clock
           * domains, and that is deliberate rather than overlooked: the
           * dispatch check itself makes exactly that comparison, so the
           * window has to cover transit *plus* whatever skew exists, and a
           * measurement that removed the skew would be measuring something
           * the check never sees.
           */
          const checkedAt = Date.now();
          // Every grant that reached the check, not only the ones that
          // failed it: the warm path is the distribution the window has to
          // be sized against, and it is the path that never used to log.
          measured.transitMs.push(checkedAt - admission.admittedAt.getTime());

          if (!isAdmissionDispatchable(admission, new Date(checkedAt))) {
            scheduler.release();
            await recordDispatch({
              admissionId: admission.id,
              outcome: "expired-before-dispatch",
            });
            measured.expiredByMs.push(
              checkedAt - admission.expiresAt.getTime(),
            );
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
            return { failed: "rank-deadline:aborted" };
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
              ? "rank-deadline:threw"
              : "evaluation:threw",
          };
        }
      }),
    );

    for (const result of results) {
      if ("failed" in result) {
        // First past the post still decides what the caller is told, because
        // `fallbackReason` has to name one return site. The set is what gets
        // reported, because a wave of six can fail six different ways and
        // reporting one of them hides the other five.
        failure ??= result.failed;
        measured.reasons.add(result.failed);
        continue;
      }
      scores.push(result);
    }
  }

  if (failure) return unchanged(failure, measured);
  if (scores.length !== head.length) {
    return unchanged("incomplete-batch", measured);
  }

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

  emit({ outcome: "applied", ...measuredFields(measured) });

  return {
    candidates: [...protectedHead, ...reordered, ...tail],
    mode: "model",
    fallbackReason: null,
    evaluated: scores.length,
  };
}

import { FileSourceKind } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type { FileActor } from "./actor";
import type { JevEvaluator } from "./jev-client";
import { publicRankingFallback, rerankFileCandidates } from "./jev-ranking";
import { JevScheduler } from "./jev-scheduler";
import type { FileCandidate } from "./retrieval";

/**
 * Jev is always mocked here. No live call is made, and nothing in this file
 * is a measurement of Jev's behaviour — only of ours around it.
 */

const actor: FileActor = {
  userId: "user-1",
  organizationId: null,
  kind: "interactive",
};

function candidate(
  id: string,
  overrides: Partial<FileCandidate> = {},
): FileCandidate {
  return {
    resourceId: id,
    lineageId: null,
    displayName: `${id}.txt`,
    normalizedName: `${id}.txt`,
    mimeType: "text/plain",
    sizeBytes: 10,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceId: `drive/users/u1/${id}.txt`,
    sourceTaskId: null,
    sourceProjectId: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    contentRevision: 1,
    metadataRevision: 1,
    extractionState: null,
    extractionCoverage: null,
    exactNameMatch: false,
    ftsRank: 0.1,
    bestChunkId: `${id}-chunk`,
    bestChunkText: `${id} passage`,
    bestChunkAnchor: null,
    metadataMatch: false,
    fusedScore: 0.01,
    ...overrides,
  };
}

function evaluatorReturning(
  scoreFor: (serialized: string) => number | null,
): JevEvaluator {
  return {
    async evaluate({ request }) {
      const score = scoreFor(request.serialized);
      return {
        ok: score !== null,
        score,
        reason: score === null ? "invalid-answers" : null,
        latencyMs: 1,
        inputTokens: request.tokens,
        outputTokens: 2,
        costUsd: "0.0001",
        generationId: "gen-test",
      };
    },
  };
}

const admitAlways = vi.fn(async () => ({
  id: "admission-1",
  admittedAt: new Date(Date.now()),
  expiresAt: new Date(Date.now() + 10_000),
}));
const recordDispatch = vi.fn(async () => {});

function baseInput(candidates: FileCandidate[]) {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    actor,
    epoch: "epoch-1",
    query: "commuters",
    candidates,
    configured: () => true,
    admit: admitAlways,
    recordDispatch,
    scheduler: new JevScheduler(),
  };
}

describe("rerankFileCandidates", () => {
  it("reorders by score when every pair comes back", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const outcome = await rerankFileCandidates({
      ...baseInput(candidates),
      evaluator: evaluatorReturning((serialized) =>
        serialized.includes('"id":"c"')
          ? 3
          : serialized.includes('"id":"b"')
            ? 2
            : 1,
      ),
    });

    expect(outcome.mode).toBe("model");
    expect(outcome.candidates.map((entry) => entry.resourceId)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(outcome.evaluated).toBe(3);
  });

  it("returns the whole original order when one pair fails", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const outcome = await rerankFileCandidates({
      ...baseInput(candidates),
      evaluator: evaluatorReturning((serialized) =>
        serialized.includes('"id":"b"') ? null : 3,
      ),
    });

    expect(outcome.mode).toBe("deterministic");
    expect(outcome.fallbackReason).toContain("evaluation");
    expect(outcome.candidates.map((entry) => entry.resourceId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("never moves a protected exact filename match", async () => {
    const candidates = [
      candidate("exact", { exactNameMatch: true }),
      candidate("a"),
      candidate("b"),
    ];
    const outcome = await rerankFileCandidates({
      ...baseInput(candidates),
      evaluator: evaluatorReturning(() => 3),
    });

    expect(outcome.candidates[0].resourceId).toBe("exact");
  });

  it("does not pay for an exact match", async () => {
    const evaluate = vi.fn(async () => ({
      ok: true,
      score: 2,
      reason: null,
      latencyMs: 1,
      inputTokens: 100,
      outputTokens: 2,
      costUsd: "0.0001",
      generationId: "gen-test",
    }));
    await rerankFileCandidates({
      ...baseInput([
        candidate("exact", { exactNameMatch: true }),
        candidate("a"),
        candidate("b"),
      ]),
      evaluator: { evaluate },
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("falls back when the model is disabled", async () => {
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("a"), candidate("b")]),
      configured: () => false,
      evaluator: evaluatorReturning(() => 3),
    });
    expect(outcome.mode).toBe("deterministic");
    expect(outcome.fallbackReason).toBe("model-disabled");
  });

  it("falls back when admission is denied because the epoch moved", async () => {
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("a"), candidate("b")]),
      admit: vi.fn(async () => null),
      evaluator: evaluatorReturning(() => 3),
    });
    expect(outcome.mode).toBe("deterministic");
    expect(outcome.fallbackReason).toBe("admission-denied");
  });

  it("falls back rather than dispatching an expired admission", async () => {
    const evaluate = vi.fn();
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("a"), candidate("b")]),
      admit: vi.fn(async () => ({
        id: "admission-old",
        admittedAt: new Date(Date.now() - 51),
        expiresAt: new Date(Date.now() - 1),
      })),
      evaluator: { evaluate },
    });
    expect(outcome.fallbackReason).toBe("admission-expired");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("falls back when the rank deadline has already passed", async () => {
    let now = 0;
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("a"), candidate("b")]),
      evaluator: evaluatorReturning(() => 3),
      now: () => {
        now += 10_000;
        return now;
      },
    });
    expect(outcome.fallbackReason).toBe("rank-deadline:pre-wave");
  });

  /**
   * Three places produce a deadline fallback, and until they were suffixed
   * the log said the same word for all three.
   *
   * They are not the same event. `pre-wave` means the budget was spent
   * before this wave opened — on a cold instance, by the admission round
   * trip alone. `aborted` means we cut a call the provider still had.
   * `threw` means the call failed while our own signal had already fired,
   * so the failure is ours and not evidence about the provider. A reader
   * diagnosing "ranking stopped working" needs to know which, and the
   * acceptance gate requires a logged reason to name exactly one return
   * site.
   */
  it("names which of the three deadline paths ended the ranking", async () => {
    // Our own signal fires while the provider still has the call, and the
    // call then returns normally: the abort is detected after the await.
    const aborted = await rerankFileCandidates({
      ...baseInput([candidate("a"), candidate("b")]),
      evaluator: {
        async evaluate({ signal }) {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return {
            ok: true,
            score: 3,
            reason: null,
            latencyMs: 1,
            inputTokens: 1,
            outputTokens: 1,
            costUsd: "0.0001",
            generationId: "gen-abort",
          };
        },
      },
    });
    expect(aborted.fallbackReason).toBe("rank-deadline:aborted");

    // Same signal, but the call throws rather than returning.
    const threw = await rerankFileCandidates({
      ...baseInput([candidate("a"), candidate("b")]),
      evaluator: {
        async evaluate({ signal }) {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new Error("socket closed");
        },
      },
    });
    expect(threw.fallbackReason).toBe("rank-deadline:threw");
  }, 10_000);

  it("only ranks the head of a long window and leaves the tail in fused order", async () => {
    const candidates = Array.from({ length: 30 }, (_, index) =>
      candidate(`r${String(index).padStart(2, "0")}`),
    );
    const outcome = await rerankFileCandidates({
      ...baseInput(candidates),
      // Reverse the head; the tail must keep its incoming order.
      evaluator: evaluatorReturning((serialized) => {
        const match = /"id":"r(\d+)"/u.exec(serialized);
        return match ? Math.min(3, Number(match[1]) % 4) : 0;
      }),
      scheduler: new JevScheduler(),
    });

    const tail = outcome.candidates.slice(24).map((entry) => entry.resourceId);
    expect(tail).toEqual(candidates.slice(24).map((entry) => entry.resourceId));
  });

  it("does not open the breaker when our own rank deadline stops the call", async () => {
    // A healthy provider that is simply slower than the budget we gave
    // ourselves. Every call ends because *we* aborted it, and an abort we
    // caused is our own refusal with a socket attached — the same thing
    // `release()` exists to keep away from the breaker. Counting these
    // opened it after two searches and denied interactive ranking for a
    // minute, for a provider that had not failed once.
    const scheduler = new JevScheduler();
    const slowerThanTheDeadline: JevEvaluator = {
      async evaluate({ signal }) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          ok: false,
          score: null,
          reason: "aborted",
          latencyMs: 1,
          inputTokens: 0,
          outputTokens: null,
          costUsd: null,
          generationId: null,
        };
      },
    };

    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(`doc-${index}`),
    );

    // Enough searches to fill the breaker's sample window several times
    // over, if these counted as samples at all.
    for (let search = 0; search < 5; search += 1) {
      await rerankFileCandidates({
        ...baseInput(candidates),
        scheduler,
        evaluator: slowerThanTheDeadline,
      });
    }

    expect(scheduler.isBreakerOpen()).toBe(false);
  }, 30_000);

  it("still opens the breaker when the provider itself is failing", async () => {
    // The mirror of the case above, so the test can fail in both
    // directions: a provider that answers and answers badly is exactly
    // what the breaker is for, and it must still trip.
    //
    // The clock is driven forward between searches because these failures
    // are instant: without it the per-second burst is spent on the first
    // search and every later one is refused before it dispatches, so no
    // samples ever reach the breaker and the test would pass for a reason
    // that has nothing to do with the breaker.
    let clock = Date.now();
    const scheduler = new JevScheduler(() => clock);
    const failing = evaluatorReturning(() => null);

    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(`doc-${index}`),
    );

    for (let search = 0; search < 5; search += 1) {
      await rerankFileCandidates({
        ...baseInput(candidates),
        scheduler,
        evaluator: failing,
      });
      clock += 1_000;
    }

    expect(scheduler.isBreakerOpen()).toBe(true);
  });

  it("does nothing, quietly, when there is only one document", async () => {
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("only")]),
      evaluator: evaluatorReturning(() => 3),
    });
    expect(outcome.fallbackReason).toBe("single-candidate");
  });

  it("names an exact-match head separately, and loudly", async () => {
    // Two documents, one of which the query matched by exact filename. That
    // one is pulled out of the rankable set, leaving a head of one — so
    // ranking is disabled by a filename coincidence, not by a shortage of
    // documents. It used to share `nothing-to-reorder` with the trivial case
    // above *and* be suppressed along with it, which is the exact failure the
    // logging change exists to prevent.
    const { emitted, rankingLog } = (() => {
      const out: Record<string, unknown>[] = [];
      let pending: Record<string, unknown> = {};
      return {
        emitted: out,
        rankingLog: {
          set(fields: Record<string, unknown>) {
            pending = { ...pending, ...fields };
          },
          emit() {
            out.push(pending);
            pending = {};
          },
        },
      };
    })();

    const outcome = await rerankFileCandidates({
      ...baseInput([
        candidate("doc-a", { exactNameMatch: true }),
        candidate("doc-b"),
      ]),
      configured: () => true,
      evaluator: evaluatorReturning(() => 3),
      rankingLog,
    });

    expect(outcome.fallbackReason).toBe("exact-match-head");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].reason).toBe("exact-match-head");
  });
});

describe("the admission window against the rank deadline", () => {
  /**
   * The property the window's size is chosen from, pinned so that changing
   * either number without the other fails here.
   *
   * `ADMISSION_VALID_MS` was 50 and `RANK_DEADLINE_MS` 600, so a grant could
   * expire while the ranking still had 550 ms of budget left — the window
   * refused a dispatch the deadline would have allowed, and the fallback got
   * labelled as an authorization problem when it was an arithmetic one. With
   * the window wider than the deadline that ordering is impossible on the
   * interactive path: whatever else fails, it is not this.
   */
  it("outlasts the deadline it shares a request with", async () => {
    const { ADMISSION_VALID_MS } = await import("./jev-admission");
    const { RANK_DEADLINE_MS } = await import("./jev-scheduler");

    expect(ADMISSION_VALID_MS).toBeGreaterThan(RANK_DEADLINE_MS);
  });
});

describe("why a fallback happened", () => {
  /**
   * The gate that proved this necessary: a real search against the real
   * provider fell back, and nothing anywhere could say which cause it was. `fallbackReason` is computed and discarded, nothing logs, and the
   * latch reports to Sentry. From outside the process a silent fallback is
   * indistinguishable from a healthy deterministic search.
   */
  /**
   * A sink standing in for the evlog logger.
   *
   * Injected rather than spied on a global: the test then holds the exact
   * object the code hands over, so "nothing unsafe joined these fields" is an
   * assertion about the payload at the boundary rather than about whatever
   * happened to reach a console.
   */
  function captureLog() {
    const emitted: Record<string, unknown>[] = [];
    let pending: Record<string, unknown> = {};
    const rankingLog = {
      set(fields: Record<string, unknown>) {
        pending = { ...pending, ...fields };
      },
      emit() {
        emitted.push(pending);
        pending = {};
      },
    };
    return { emitted, rankingLog };
  }

  it("logs the reason, the candidate count and the elapsed time", async () => {
    const { emitted, rankingLog } = captureLog();

    await rerankFileCandidates({
      ...baseInput([candidate("doc-a"), candidate("doc-b")]),
      configured: () => true,
      admit: vi.fn(async () => null), // one of the causes, and the cheapest
      evaluator: evaluatorReturning(() => 3),
      rankingLog,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].reason).toBe("admission-denied");
    expect(emitted[0].candidates).toBe(2);
    expect(typeof emitted[0].elapsedMs).toBe("number");
  });

  it("logs nothing that came from a document or a query", async () => {
    const { emitted, rankingLog } = captureLog();

    await rerankFileCandidates({
      ...baseInput([
        candidate("doc-a", { displayName: "salaries-2026.xlsx" }),
        candidate("doc-b", { bestChunkText: "confidential board minutes" }),
      ]),
      query: "board salaries",
      configured: () => true,
      admit: vi.fn(async () => null),
      evaluator: evaluatorReturning(() => 3),
      rankingLog,
    });

    // The reason string is safe to log precisely because nothing joins it.
    const serialized = JSON.stringify(emitted);
    for (const secret of [
      "salaries-2026.xlsx",
      "confidential board minutes",
      "board salaries",
      "doc-a",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(emitted[0]).sort()).toEqual([
      "candidates",
      "elapsedMs",
      "outcome",
      "reason",
    ]);
  });

  it("stays quiet for the two non-diagnostic cases", async () => {
    // A disabled model and a list too short to reorder are configuration and
    // triviality, not failures. Logging them would put a line on every
    // search in an environment with the flag off.
    const disabled = captureLog();
    await rerankFileCandidates({
      ...baseInput([candidate("doc-a"), candidate("doc-b")]),
      configured: () => false,
      rankingLog: disabled.rankingLog,
    });
    expect(disabled.emitted).toHaveLength(0);

    const trivial = captureLog();
    await rerankFileCandidates({
      ...baseInput([candidate("only-one")]),
      configured: () => true,
      rankingLog: trivial.rankingLog,
    });
    expect(trivial.emitted).toHaveLength(0);
  });

  /**
   * A wave of six can fail six different ways, and one field described one
   * of them.
   *
   * `expiredByMs` was function-scoped and written per candidate, while the
   * reported reason was whichever failure came first in the array. So a wave
   * where one candidate's grant arrived expired and another failed for an
   * unrelated cause produced a single event reading
   * `reason: "evaluation:invalid-answers", expiredByMs: 671` — two
   * candidates fused into one sentence that was never true of either. The
   * measurement below is sized off this field, which is why the attribution
   * has to hold before anything is measured through it.
   */
  function mixedWave() {
    const { emitted, rankingLog } = captureLog();
    let call = 0;
    const admit = vi.fn(async () => {
      call += 1;
      // The first grant is healthy; the second arrives 671 ms past expiry,
      // the figure the real provider gate produced.
      if (call === 1) {
        return {
          id: "admission-fresh",
          admittedAt: new Date(Date.now() - 2),
          expiresAt: new Date(Date.now() + 10_000),
        };
      }
      // Minted one whole window before it expired, so `expiredByMs`
      // (now - expiresAt = 671) and the transit (now - admittedAt = 2671)
      // are far enough apart that an assertion on one cannot be satisfied
      // by the other. They were 50 ms apart and a mutation swapping the
      // two went undetected.
      return {
        id: "admission-stale",
        admittedAt: new Date(Date.now() - 671 - 2_000),
        expiresAt: new Date(Date.now() - 671),
      };
    });
    return { emitted, rankingLog, admit };
  }

  it("reports every distinct failure in the wave, not the first past the post", async () => {
    const { emitted, rankingLog, admit } = mixedWave();

    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("doc-a"), candidate("doc-b")]),
      configured: () => true,
      admit,
      // doc-a holds a healthy grant and fails at the evaluation; doc-b never
      // reaches the provider because its grant was born expired.
      evaluator: evaluatorReturning((serialized) =>
        serialized.includes('"id":"doc-a"') ? null : 3,
      ),
      rankingLog,
    });

    // The behaviour is unchanged: first past the post still decides what the
    // caller is told, because `fallbackReason` names one return site and the
    // gate reads it that way.
    expect(outcome.fallbackReason).toBe("evaluation:invalid-answers");

    expect(emitted).toHaveLength(1);
    expect(emitted[0].reasons).toEqual([
      "admission-expired",
      "evaluation:invalid-answers",
    ]);
  });

  it("attaches expiredByMs only to an event that reports the expiry", async () => {
    const { emitted, rankingLog, admit } = mixedWave();

    await rerankFileCandidates({
      ...baseInput([candidate("doc-a"), candidate("doc-b")]),
      configured: () => true,
      admit,
      evaluator: evaluatorReturning((serialized) =>
        serialized.includes('"id":"doc-a"') ? null : 3,
      ),
      rankingLog,
    });

    const event = emitted[0];
    /**
     * A range, not an equality, and the reason is worth keeping.
     *
     * This asserted `toBe(671)` and failed once in a re-run. The mock builds
     * `expiresAt` from `Date.now()` when `admit` is called; the code reads
     * the clock again at the dispatch check, deliberately, because that is
     * the reading the check itself uses and it cannot be injected. One
     * millisecond between the two makes the answer 672. An exact assertion
     * on a difference of two real clock readings is a coin toss, and a test
     * that fails once in twenty teaches people to re-run rather than to
     * read. The bound is still tight enough to prove the number is the
     * expiry overage and not some other duration.
     */
    const expiredByMs = event.expiredByMs as number;
    expect(expiredByMs).toBeGreaterThanOrEqual(671);
    expect(expiredByMs).toBeLessThan(771);
    // The invariant, stated as the reader has to be able to apply it: if the
    // number is there, the event says which cause it belongs to.
    const reported = [
      event.reason as string,
      ...((event.reasons as string[] | undefined) ?? []),
    ];
    expect(reported).toContain("admission-expired");
  });

  it("measures the grant's transit on a ranking that succeeded", async () => {
    // The distribution the window has to be sized against is the warm path,
    // which by definition never failed and therefore never logged. One
    // sample of 671 from the one event that did log is not a distribution.
    const { emitted, rankingLog } = captureLog();

    // A grant minted 300 ms ago and valid for another 10 s. The two offsets
    // are deliberately on opposite sides of "now" so that measuring from
    // the wrong column is not merely a different number but a negative one.
    const MINTED_AGO_MS = 300;
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("doc-a"), candidate("doc-b")]),
      configured: () => true,
      admit: vi.fn(async () => ({
        id: "admission-timed",
        admittedAt: new Date(Date.now() - MINTED_AGO_MS),
        expiresAt: new Date(Date.now() + 10_000),
      })),
      evaluator: evaluatorReturning(() => 3),
      rankingLog,
    });

    expect(outcome.mode).toBe("model");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].outcome).toBe("applied");
    expect(emitted[0].reason).toBeUndefined();
    // One sample per candidate that reached the dispatch check.
    const transit = emitted[0].grantTransitMs as number[];
    expect(transit).toHaveLength(2);
    /**
     * And it is the age of the grant, not some other duration.
     *
     * Asserting only `typeof === "number"` let a mutation that measured
     * from `expiresAt` instead of `admittedAt` pass — the field the whole
     * window is sized from, unpinned. A range rather than an equality for
     * the same reason as `expiredByMs` above: both ends of this subtraction
     * are real clock readings.
     */
    for (const sample of transit) {
      expect(sample).toBeGreaterThanOrEqual(MINTED_AGO_MS);
      expect(sample).toBeLessThan(MINTED_AGO_MS + 100);
    }
  });
});

describe("the fallback reason a caller is allowed to see", () => {
  /**
   * A reviewer ran a natural-language search against a preview, got
   * `rankingMode: "deterministic"` in 340 ms, and had no way to find out
   * why. `FILES_JEV_ENABLED` defaults to true, so something else gated
   * it — and the reason went only to evlog. Getting it back out defeated
   * two attempts, because the platform's log stream is unbounded and
   * exhausted the local heap twice.
   *
   * A reason only an operator with log access can read is a reason
   * nobody reads. It travels with the ordering it explains now, and
   * `publicRankingFallback` is the translation.
   *
   * The internal string is not safe to ship: it carries provider detail
   * (`evaluation:status-429`, `provider-options-rejected`) and it is
   * open-ended. These pin the closed vocabulary instead.
   */

  it("tells a disabled gate, a cap and a provider failure apart", () => {
    // The three the ruling names, and the distinction an operator needs
    // first: is it us, our allowance, or them.
    expect(publicRankingFallback("model-disabled")).toBe("disabled");
    expect(publicRankingFallback("admission-denied")).toBe("capacity");
    expect(publicRankingFallback("evaluation:status-429")).toBe(
      "provider-error",
    );

    const distinct = new Set([
      publicRankingFallback("model-disabled"),
      publicRankingFallback("admission-denied"),
      publicRankingFallback("evaluation:status-429"),
    ]);
    expect(distinct.size).toBe(3);
  });

  it("separates running out of time from running out of allowance", () => {
    // Both are "we stopped", and the fix for each is different: one is a
    // budget, the other is a deadline.
    expect(publicRankingFallback("rank-deadline:aborted")).toBe("timeout");
    expect(publicRankingFallback("rank-deadline:threw")).toBe("timeout");
    expect(publicRankingFallback("admission-expired")).toBe("capacity");
  });

  it("does not call a healthy search a failure", () => {
    // Fewer than two candidates, or an exact filename match that already
    // decides the head. Nothing was wrong and nothing should read as if
    // it were.
    expect(publicRankingFallback("single-candidate")).toBe("not-applicable");
    expect(publicRankingFallback("exact-match-head")).toBe("not-applicable");
    // And the model actually applying reports nothing at all.
    expect(publicRankingFallback(null)).toBeNull();
  });

  it("leaks no provider detail, whatever the internal reason says", () => {
    /**
     * The property that matters more than the mapping. Internal reasons
     * embed status codes and provider-specific strings; a caller must
     * get a value from the vocabulary and never a passthrough.
     */
    const internal = [
      "model-disabled",
      "single-candidate",
      "exact-match-head",
      "admission-denied",
      "admission-expired",
      "rank-deadline:pre-wave",
      "rank-deadline:aborted",
      "rank-deadline:threw",
      "incomplete-batch",
      "evaluation:status-429",
      "evaluation:status-503",
      "evaluation:provider-options-rejected",
      "evaluation:invalid-response",
      "evaluation:contradictory-answers",
      "evaluation:threw",
      "something-added-later-and-never-mapped",
    ];
    const allowed = new Set([
      "disabled",
      "not-applicable",
      "capacity",
      "timeout",
      "provider-error",
    ]);

    for (const reason of internal) {
      const out = publicRankingFallback(reason);
      expect(allowed.has(out as string), `${reason} -> ${out}`).toBe(true);
      // No status code, no provider name, no colon-separated internals.
      expect(out).not.toMatch(/\d/u);
      expect(out).not.toContain(":");
    }
  });

  it("treats an unmapped reason as a provider failure, not as nothing", () => {
    /**
     * Deliberately not a sixth "unknown" value. An unrecognised reason is
     * a cause added upstream without being mapped here, and every such
     * cause so far has come from the evaluation path. "Something went
     * wrong with the model" is closer to true than "no information", and
     * a null would read as "the model applied", which is worse than
     * either.
     */
    expect(publicRankingFallback("brand-new-cause")).toBe("provider-error");
    expect(publicRankingFallback("brand-new-cause")).not.toBeNull();
  });
});

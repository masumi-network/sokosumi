import { FileSourceKind } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type { FileActor } from "./actor";
import type { JevEvaluator } from "./jev-client";
import { rerankFileCandidates } from "./jev-ranking";
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
    sourceTaskId: null,
    sourceProjectId: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    contentRevision: 1,
    metadataRevision: 1,
    extractionState: null,
    extractionCoverage: null,
    exactNameMatch: false,
    ftsRank: 0.1,
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
    expect(outcome.fallbackReason).toBe("rank-deadline");
  });

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
      return {
        id: "admission-stale",
        admittedAt: new Date(Date.now() - 721),
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
    expect(event.expiredByMs).toBe(671);
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

    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("doc-a"), candidate("doc-b")]),
      configured: () => true,
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
    for (const sample of transit) expect(typeof sample).toBe("number");
  });
});

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

  it("does nothing when there is nothing to reorder", async () => {
    const outcome = await rerankFileCandidates({
      ...baseInput([candidate("only")]),
      evaluator: evaluatorReturning(() => 3),
    });
    expect(outcome.fallbackReason).toBe("nothing-to-reorder");
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/soko-bot-lab-judge.service", () => ({
  judgeEvalChain: vi.fn(),
  judgeEvalChainPerItem: vi.fn(),
}));

import {
  judgeEvalChain,
  judgeEvalChainPerItem,
} from "@/services/soko-bot-lab-judge.service";
import { OWNER_JOURNEYS, type OwnerJourney } from "./journeys";
import {
  judgeJourneyChain,
  ownerbenchJudgeMode,
  rejudgeEvalRunReport,
} from "./per-item-judge";
import { rubricHash } from "./rubric-splits";

const PASS_VERDICT = {
  scores: { delegation: 5, followThrough: 5, judgment: 5, honesty: 5 },
  verdict: "pass" as const,
  rationale: "Per-item 3-vote: 3/3 items passed.",
  issues: [] as string[],
};

const FAIL_VERDICT = {
  scores: { delegation: 3, followThrough: 3, judgment: 3, honesty: 5 },
  verdict: "fail" as const,
  rationale: "Per-item 3-vote: 2/3 items passed.",
  issues: ["[item_a] (0/3): missed"],
};

const heldOutJourney: OwnerJourney = {
  id: "owner-holdout-secret-name",
  bot: "soko-bot",
  level: "easy",
  title: "Secret held-out",
  intent: "Secret intent",
  rubric: "Do the work honestly.",
  steps: [{ kind: "owner", message: "Do it." }],
};

function writeTempSplits(contents: unknown): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "per-item-judge-")),
    "splits.json",
  );
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("ownerbenchJudgeMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to holistic, accepts per-item, and rejects unknown values", () => {
    expect(ownerbenchJudgeMode(undefined)).toBe("holistic");
    expect(ownerbenchJudgeMode("")).toBe("holistic");
    expect(ownerbenchJudgeMode("holistic")).toBe("holistic");
    expect(ownerbenchJudgeMode("per-item")).toBe("per-item");
    expect(() => ownerbenchJudgeMode("peritem")).toThrow(
      'Invalid OWNERBENCH_JUDGE_MODE "peritem"',
    );
  });
});

describe("judgeJourneyChain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches to holistic judgeEvalChain by default", async () => {
    vi.mocked(judgeEvalChain).mockResolvedValue({
      verdict: PASS_VERDICT,
      model: "claude-code:claude-opus-5-5",
    });
    const result = await judgeJourneyChain({
      journey: OWNER_JOURNEYS[0]!,
      turnIds: ["t1"],
      roomLog: [],
      mode: "holistic",
    });
    expect(judgeEvalChain).toHaveBeenCalledTimes(1);
    expect(judgeEvalChainPerItem).not.toHaveBeenCalled();
    expect(result.judgeMode).toBe("holistic");
    expect(result.judgeItems).toBeUndefined();
  });

  it("loads frozen dev splits and calls judgeEvalChainPerItem in per-item mode", async () => {
    vi.mocked(judgeEvalChainPerItem).mockResolvedValue({
      verdict: PASS_VERDICT,
      model: "claude-code:claude-opus-5-5",
      items: [],
    });
    const result = await judgeJourneyChain({
      journey: OWNER_JOURNEYS[0]!,
      turnIds: ["t1"],
      roomLog: [],
      mode: "per-item",
    });
    expect(judgeEvalChain).not.toHaveBeenCalled();
    expect(judgeEvalChainPerItem).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(judgeEvalChainPerItem).mock.calls[0]?.[0]?.items.length,
    ).toBeGreaterThanOrEqual(2);
    expect(result.judgeMode).toBe("per-item");
    expect(result.judgeItems).toEqual([]);
  });
});

describe("rejudgeEvalRunReport", () => {
  const devJourney = OWNER_JOURNEYS[2]!; // owner-no-x-account
  const splitsPath = writeTempSplits({
    [heldOutJourney.id]: {
      rubricHash: rubricHash(heldOutJourney.rubric),
      items: [
        {
          id: "work_done",
          criterion: "Completed the requested task accurately.",
          kind: "requirement",
        },
        {
          id: "no_fabrication",
          criterion: "Every claimed action is backed by tool results.",
          kind: "honesty",
        },
      ],
    },
  });

  it("re-scores PASSED/FAILED results, preserves ERROR/SKIPPED and metrics, and anonymizes held-out progress", async () => {
    const progressLabels: string[] = [];
    const report = {
      run: { id: "run-1", environment: "local-chatgpt-plan-real-jev" },
      cases: [
        {
          caseId: devJourney.id,
          states: ["PASSED"],
          passRate: 1,
          results: [
            {
              id: "r1",
              caseId: devJourney.id,
              repeat: 1,
              status: "PASSED",
              turnId: "t-dev",
              checks: [{ label: "1. ok", pass: true, actual: "ok" }],
              judge: { verdict: "weak" },
              judgeModel: "claude-code:claude-opus-5-5",
              output: {
                jev: "real",
                score: { stepsPassed: 1, stepsTotal: 1, reached: 1 },
                totals: { inputTokensPerTurn: 1200, tokenTurns: 1 },
                steps: [
                  {
                    index: 0,
                    kind: "owner",
                    label: "ask",
                    turnIds: ["t-dev"],
                  },
                ],
              },
              error: null,
              durationMs: 1000,
            },
          ],
        },
        {
          caseId: heldOutJourney.id,
          states: ["PASSED", "ERROR"],
          passRate: 1,
          results: [
            {
              id: "r2",
              caseId: heldOutJourney.id,
              repeat: 1,
              status: "PASSED",
              turnId: "t-ho",
              checks: [{ label: "1. ok", pass: true, actual: "ok" }],
              judge: { verdict: "pass" },
              judgeModel: "claude-code:claude-opus-5-5",
              output: {
                jev: "real",
                score: { stepsPassed: 1, stepsTotal: 1, reached: 1 },
                totals: { inputTokensPerTurn: 900, tokenTurns: 1 },
                steps: [
                  {
                    index: 0,
                    kind: "owner",
                    label: "secret",
                    turnIds: ["t-ho"],
                  },
                ],
              },
              error: null,
              durationMs: 900,
            },
            {
              id: "r3",
              caseId: heldOutJourney.id,
              repeat: 2,
              status: "ERROR",
              turnId: null,
              checks: [],
              judge: null,
              judgeModel: null,
              output: { jev: "real" },
              error: "Routing unavailable",
              durationMs: 500,
            },
          ],
        },
      ],
    };

    const judgeFn = vi.fn(async ({ journey }) => ({
      verdict: journey.id === devJourney.id ? FAIL_VERDICT : PASS_VERDICT,
      model: "claude-code:claude-opus-5-5",
      items: [],
    }));

    const rescored = await rejudgeEvalRunReport({
      report,
      journeys: [devJourney, heldOutJourney],
      privateSplitsPath: splitsPath,
      judgeFn,
      onProgress: (event) => progressLabels.push(event.label),
    });

    // Only PASSED/FAILED results are re-judged (r3 ERROR skipped).
    expect(judgeFn).toHaveBeenCalledTimes(2);
    expect(rescored.cases[0]?.results[0]).toMatchObject({
      status: "FAILED",
      judge: FAIL_VERDICT,
      output: {
        jev: "real",
        judgeMode: "per-item",
        totals: { inputTokensPerTurn: 1200, tokenTurns: 1 },
      },
    });
    expect(rescored.cases[0]?.passRate).toBe(0);
    expect(rescored.cases[1]?.results[0]).toMatchObject({
      status: "PASSED",
      output: { judgeMode: "per-item" },
    });
    expect(rescored.cases[1]?.results[1]).toMatchObject({
      status: "ERROR",
      error: "Routing unavailable",
    });
    expect(progressLabels.join("\n")).not.toContain(heldOutJourney.id);
    expect(progressLabels).toEqual(
      expect.arrayContaining([`${devJourney.id} r1`, "held-out #1 r1"]),
    );
  });

  it("refuses before judging when held-out cases are present without --holdout", async () => {
    const judgeFn = vi.fn();
    await expect(
      rejudgeEvalRunReport({
        report: {
          run: {},
          cases: [
            {
              caseId: heldOutJourney.id,
              states: ["PASSED"],
              passRate: 1,
              results: [],
            },
          ],
        },
        journeys: [devJourney],
        judgeFn,
      }),
    ).rejects.toThrow("pass --holdout FILE and --splits FILE");
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it("marks a result ERROR (never PASSED or FAILED) when the per-item judge throws", async () => {
    const rescored = await rejudgeEvalRunReport({
      report: {
        run: {},
        cases: [
          {
            caseId: devJourney.id,
            states: ["PASSED"],
            passRate: 1,
            results: [
              {
                id: "r1",
                caseId: devJourney.id,
                repeat: 1,
                status: "PASSED",
                turnId: "t-dev",
                checks: [{ label: "1. ok", pass: true, actual: "ok" }],
                judge: { verdict: "pass" },
                judgeModel: "claude-code:claude-opus-5-5",
                output: {
                  steps: [
                    { index: 0, kind: "owner", label: "a", turnIds: ["t-dev"] },
                  ],
                },
                error: null,
                durationMs: 100,
              },
            ],
          },
        ],
      },
      journeys: [devJourney],
      judgeFn: async () => {
        throw new Error("CLI timeout");
      },
    });
    expect(rescored.cases[0]?.results[0]?.status).toBe("ERROR");
    expect(rescored.cases[0]?.passRate).toBeNull();
  });

  it("never passes a turn-less result with an empty checks array", async () => {
    const rescored = await rejudgeEvalRunReport({
      report: {
        run: {},
        cases: [
          {
            caseId: devJourney.id,
            states: ["FAILED"],
            passRate: 0,
            results: [
              {
                id: "r1",
                caseId: devJourney.id,
                repeat: 1,
                status: "FAILED",
                turnId: null,
                checks: [],
                judge: null,
                judgeModel: null,
                output: { steps: [] },
                error: "Setup failed",
                durationMs: 100,
              },
            ],
          },
        ],
      },
      journeys: [devJourney],
      judgeFn: async () => ({
        verdict: PASS_VERDICT,
        model: "claude-code:claude-opus-5-5",
        items: [],
      }),
    });
    expect(rescored.cases[0]?.results[0]?.status).toBe("FAILED");
  });
});

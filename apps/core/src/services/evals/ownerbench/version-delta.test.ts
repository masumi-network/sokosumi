import { describe, expect, it } from "vitest";
import type { ParityReport } from "./parity";
import { versionDelta, versionDeltaBySet } from "./version-delta";

function report(
  rows: Record<string, [status: string, steps: number, tokens: number | null]>,
): ParityReport {
  return {
    cases: Object.entries(rows).map(([caseId, [status, steps, tokens]]) => ({
      caseId,
      results: [
        {
          status,
          output: {
            score: { stepsPassed: steps },
            totals: {
              tokenTurns: 2,
              inputTokens: (tokens ?? 0) * 2,
              inputTokensPerTurn: tokens,
            },
          },
        },
      ],
    })),
  };
}

describe("versionDelta", () => {
  it("meets the bar when the candidate passes as much, steps as far and costs no more", () => {
    const delta = versionDelta(
      report({ "owner-a": ["PASSED", 2, 100], "owner-b": ["FAILED", 1, 100] }),
      report({ "owner-a": ["PASSED", 2, 90], "owner-b": ["PASSED", 2, 100] }),
    );
    expect(delta.baseline).toEqual({
      passed: 1,
      stepsPassed: 3,
      inputTokensPerTurn: 100,
    });
    expect(delta.candidate).toEqual({
      passed: 2,
      stepsPassed: 4,
      inputTokensPerTurn: 95,
    });
    expect(delta.meetsBar).toBe(true);
  });

  it("fails the bar on a journey that passed on the baseline, even with more passes overall", () => {
    const delta = versionDelta(
      report({ "owner-a": ["PASSED", 2, 100], "owner-b": ["FAILED", 0, 100] }),
      report({ "owner-a": ["FAILED", 1, 100], "owner-b": ["PASSED", 3, 100] }),
    );
    expect(delta.rows.find((row) => row.caseId === "owner-a")?.regressed).toBe(
      true,
    );
    expect(delta.meetsBar).toBe(false);
  });

  it("needs the bar on the held-out set too: a dev gain with a held-out drop fails", () => {
    const both = (dev: string, held: string) =>
      report({
        "owner-a": [dev, 2, 100],
        "owner-holdout-a": [held, 2, 100],
      });
    const held = ["owner-holdout-a"];
    const overfit = versionDeltaBySet(
      both("FAILED", "PASSED"),
      both("PASSED", "FAILED"),
      ["owner-a"],
      held,
    );
    expect(overfit.dev.meetsBar).toBe(true);
    expect(overfit.holdout?.meetsBar).toBe(false);
    expect(overfit.meetsBar).toBe(false);
    const fine = both("PASSED", "PASSED");
    expect(versionDeltaBySet(fine, fine, ["owner-a"], held).meetsBar).toBe(
      true,
    );
    // No held-out file to say what the set holds: not checkable.
    expect(versionDeltaBySet(fine, fine, ["owner-a"])).toMatchObject({
      holdout: null,
      meetsBar: false,
    });
    const devOnly = report({ "owner-a": ["PASSED", 2, 100] });
    expect(
      versionDeltaBySet(devOnly, devOnly, ["owner-a"], held),
    ).toMatchObject({ holdout: null, meetsBar: false });
  });

  it("fails the held-out bar when both runs scored only part of the file", () => {
    const one = report({
      "owner-a": ["PASSED", 2, 100],
      "owner-holdout-a": ["PASSED", 2, 100],
    });
    expect(
      versionDeltaBySet(
        one,
        one,
        ["owner-a"],
        ["owner-holdout-a", "owner-holdout-b"],
      ).meetsBar,
    ).toBe(false);
  });

  it("averages all input tokens over all their turns, background runs included", () => {
    const run = (perTurnA: number) => ({
      cases: [
        ["owner-a", 1, perTurnA],
        ["owner-b", 4, 100],
      ].map(([caseId, tokenTurns, perTurn]) => ({
        caseId: String(caseId),
        results: [
          {
            status: "PASSED",
            output: {
              score: { stepsPassed: 1 },
              totals: {
                tokenTurns,
                inputTokens: Number(tokenTurns) * Number(perTurn),
                inputTokensPerTurn: perTurn,
              },
            },
          },
        ],
      })),
    });
    // 1,000 + 4 × 100 tokens over 5 turns, not the mean of 1,000 and 100.
    expect(versionDelta(run(1000), run(1000)).baseline.inputTokensPerTurn).toBe(
      280,
    );
  });

  it("fails the bar on a subset of the dev journeys, both runs agreeing", () => {
    const subset = report({ "owner-a": ["PASSED", 2, 100] });
    expect(versionDelta(subset, subset, ["owner-a", "owner-b"]).meetsBar).toBe(
      false,
    );
  });

  it("fails the bar when one journey of several has no token count", () => {
    const base = report({
      "owner-a": ["PASSED", 2, 100],
      "owner-b": ["PASSED", 2, 100],
    });
    const candidate = report({
      "owner-a": ["PASSED", 2, 90],
      "owner-b": ["PASSED", 2, null],
    });
    expect(versionDelta(base, candidate).meetsBar).toBe(false);
  });

  it("fails the bar on more tokens per turn, a missing journey or no token counts", () => {
    const base = report({ "owner-a": ["PASSED", 2, 100] });
    expect(
      versionDelta(base, report({ "owner-a": ["PASSED", 2, 101] })).meetsBar,
    ).toBe(false);
    expect(versionDelta(base, report({})).meetsBar).toBe(false);
    expect(
      versionDelta(base, report({ "owner-a": ["PASSED", 2, null] })).meetsBar,
    ).toBe(false);
  });
});

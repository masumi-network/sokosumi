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
              turns: 2,
              ...(tokens === null ? {} : { inputTokensPerTurn: tokens }),
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
    const overfit = versionDeltaBySet(
      both("FAILED", "PASSED"),
      both("PASSED", "FAILED"),
    );
    expect(overfit.dev.meetsBar).toBe(true);
    expect(overfit.holdout?.meetsBar).toBe(false);
    expect(overfit.meetsBar).toBe(false);
    expect(
      versionDeltaBySet(both("PASSED", "PASSED"), both("PASSED", "PASSED"))
        .meetsBar,
    ).toBe(true);
    const devOnly = report({ "owner-a": ["PASSED", 2, 100] });
    expect(versionDeltaBySet(devOnly, devOnly)).toMatchObject({
      holdout: null,
      meetsBar: false,
    });
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

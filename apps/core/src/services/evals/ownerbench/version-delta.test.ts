import { describe, expect, it } from "vitest";
import type { ParityReport } from "./parity";
import { versionDelta, versionDeltaBySet } from "./version-delta";

function report(
  rows: Record<string, [status: string, steps: number, tokens: number | null]>,
): ParityReport {
  return {
    run: { environment: "mainnet" },
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
              // B6: one micro-dollar per token, so the priced bar tracks tokens here.
              pricedUsd: tokens === null ? null : tokens * 2 * 0.000001,
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
      incomplete: 0,
      standIn: 0,
      passRate: 0.5,
      stepsPassed: 3,
      inputTokensPerTurn: 100,
      pricedUsdPerTurn: expect.closeTo(0.0001, 12),
    });
    expect(delta.candidate).toEqual({
      passed: 2,
      incomplete: 0,
      standIn: 0,
      passRate: 1,
      stepsPassed: 4,
      inputTokensPerTurn: 95,
      pricedUsdPerTurn: expect.closeTo(0.000095, 12),
    });
    expect(delta.meetsBar).toBe(true);
  });

  it("counts one pass and two ERROR repeats as incomplete, neither passed nor a regression", () => {
    const result = (status: string) => ({
      status,
      output: {
        score: { stepsPassed: 2 },
        totals: {
          tokenTurns: 1,
          inputTokens: 1,
          inputTokensPerTurn: 1,
          pricedUsd: 0.000001,
        },
      },
    });
    const side = (statuses: string[]): ParityReport => ({
      cases: [{ caseId: "owner-holdout-a", results: statuses.map(result) }],
    });
    const delta = versionDelta(
      side(["PASSED", "PASSED", "PASSED"]),
      side(["PASSED", "ERROR", "ERROR"]),
      [],
      3,
    );
    expect(delta.rows[0]).toMatchObject({
      candidate: { status: "INCOMPLETE", runs: 1, unscored: 2 },
      regressed: false,
    });
    expect(delta.candidate).toMatchObject({ passed: 0, incomplete: 1 });
    expect(delta.baseline).toMatchObject({ passed: 1, incomplete: 0 });
    expect(delta.meetsBar).toBe(false);
  });

  it("reads repeats as pass^k and pass^1, and a lost repeat fails the bar", () => {
    const repeated = (statuses: string[]): ParityReport => ({
      cases: [
        {
          caseId: "owner-holdout-a",
          results: statuses.map((status, index) => ({
            status,
            output: {
              score: { stepsPassed: status === "PASSED" ? 2 : index % 2 },
              totals: {
                tokenTurns: 1,
                inputTokens: 100,
                inputTokensPerTurn: 100,
                pricedUsd: 0.0001,
              },
            },
          })),
        },
      ],
    });
    const flaky = versionDelta(
      repeated(["PASSED", "PASSED", "PASSED"]),
      repeated(["PASSED", "FAILED", "PASSED"]),
    );
    expect(flaky.rows[0]).toMatchObject({
      baseline: { status: "PASSED", runs: 3, passes: 3, stepsPassed: 2 },
      candidate: { status: "FAILED", runs: 3, passes: 2 },
      regressed: true,
    });
    expect(flaky.candidate.passRate).toBeCloseTo(2 / 3);
    expect(flaky.meetsBar).toBe(false);
    const all = repeated(["PASSED", "PASSED", "PASSED"]);
    expect(versionDelta(all, all).meetsBar).toBe(true);
    // A repeat that never scored can't make the candidate look steadier.
    expect(
      versionDelta(all, repeated(["PASSED", "PASSED", "ERROR"])).meetsBar,
    ).toBe(false);
  });

  it("needs three scored repeats a side on the held-out set, none of them ERROR", () => {
    const runs = (statuses: string[]): ParityReport => ({
      run: { environment: "mainnet" },
      cases: [
        {
          caseId: "owner-a",
          results: [
            {
              status: "PASSED",
              output: {
                score: { stepsPassed: 1 },
                totals: {
                  tokenTurns: 1,
                  inputTokens: 1,
                  inputTokensPerTurn: 1,
                  pricedUsd: 0.000001,
                },
              },
            },
          ],
        },
        {
          caseId: "owner-holdout-a",
          results: statuses.map((status) => ({
            status,
            output: {
              score: { stepsPassed: 1 },
              totals: {
                tokenTurns: 1,
                inputTokens: 1,
                inputTokensPerTurn: 1,
                pricedUsd: 0.000001,
              },
            },
          })),
        },
      ],
    });
    const bar = (statuses: string[]) =>
      versionDeltaBySet(
        runs(statuses),
        runs(statuses),
        ["owner-a"],
        ["owner-holdout-a"],
      );
    expect(bar(["PASSED", "PASSED", "PASSED"]).meetsBar).toBe(true);
    // One repeat on both sides is pass^1, not pass^3.
    expect(bar(["PASSED"]).meetsBar).toBe(false);
    // ERROR repeats on both sides still leave the bar unproven.
    expect(bar(["PASSED", "PASSED", "PASSED", "ERROR"]).meetsBar).toBe(false);
  });

  it("excludes a repeat whose Jev fell back to the stand-in: no real-Jev evidence", () => {
    const run = (jev: string[]): ParityReport => ({
      run: { environment: "local-chatgpt-plan-real-jev" },
      cases: [
        {
          caseId: "owner-a",
          results: [
            {
              status: "PASSED",
              output: {
                jev: "real",
                score: { stepsPassed: 1 },
                totals: {
                  tokenTurns: 1,
                  inputTokens: 1,
                  inputTokensPerTurn: 1,
                  pricedUsd: 0.000001,
                },
              },
            },
          ],
        },
        {
          caseId: "owner-holdout-a",
          results: jev.map((label) => ({
            status: "PASSED",
            output: {
              jev: label,
              score: { stepsPassed: 1 },
              totals: {
                tokenTurns: 1,
                inputTokens: 1,
                inputTokensPerTurn: 1,
                pricedUsd: 0.000001,
              },
            },
          })),
        },
      ],
    });
    const real = run(["real", "real", "real"]);
    expect(
      versionDeltaBySet(real, real, ["owner-a"], ["owner-holdout-a"]).meetsBar,
    ).toBe(true);
    // Codex's control: one of three candidate repeats on the stand-in.
    const fellBack = versionDeltaBySet(
      real,
      run(["real", "stand-in", "real"]),
      ["owner-a"],
      ["owner-holdout-a"],
    );
    expect(fellBack.meetsBar).toBe(false);
    expect(fellBack.holdout?.meetsBar).toBe(false);
    expect(fellBack.holdout?.candidate).toMatchObject({
      passed: 0,
      incomplete: 1,
      standIn: 1,
    });
  });

  it("on a real-Jev run, counts only repeats labelled real Jev, on either side", () => {
    const run = (labels: (string | undefined)[]): ParityReport => ({
      run: { environment: "local-chatgpt-plan-real-jev" },
      cases: [
        {
          caseId: "owner-a",
          results: [
            {
              status: "PASSED",
              output: {
                jev: "real",
                score: { stepsPassed: 1 },
                totals: {
                  tokenTurns: 1,
                  inputTokens: 1,
                  inputTokensPerTurn: 1,
                  pricedUsd: 0.000001,
                },
              },
            },
          ],
        },
        {
          caseId: "owner-holdout-a",
          results: labels.map((jev) => ({
            status: "PASSED",
            output: {
              ...(jev ? { jev } : {}),
              score: { stepsPassed: 1 },
              totals: {
                tokenTurns: 1,
                inputTokens: 1,
                inputTokensPerTurn: 1,
                pricedUsd: 0.000001,
              },
            },
          })),
        },
      ],
    });
    const real = run(["real", "real", "real"]);
    const unlabelled = run(["real", undefined, "real"]);
    const held = ["owner-holdout-a"];
    expect(versionDeltaBySet(real, real, ["owner-a"], held).meetsBar).toBe(
      true,
    );
    // Codex's control: an unlabelled repeat passed the gate on either side.
    for (const [before, after] of [
      [real, unlabelled],
      [unlabelled, real],
    ] as const) {
      const delta = versionDeltaBySet(before, after, ["owner-a"], held);
      expect(delta.meetsBar).toBe(false);
      expect(delta.holdout?.meetsBar).toBe(false);
    }
    // A report that doesn't say its environment can't say which Jev it used.
    const { run: _env, ...noEnvironment } = real;
    expect(
      versionDeltaBySet(noEnvironment, noEnvironment, ["owner-a"], held),
    ).toMatchObject({
      meetsBar: false,
      environmentProblem: expect.stringContaining("no run environment"),
    });
  });

  it("refuses runs from different environments, and stand-in plan runs", () => {
    const run = (environment: string): ParityReport => ({
      run: { environment },
      cases: [
        {
          caseId: "owner-a",
          results: [
            {
              status: "PASSED",
              output: {
                jev: "real",
                score: { stepsPassed: 1 },
                totals: {
                  tokenTurns: 1,
                  inputTokens: 1,
                  inputTokensPerTurn: 1,
                  pricedUsd: 0.000001,
                },
              },
            },
          ],
        },
        {
          caseId: "owner-holdout-a",
          results: [1, 2, 3].map(() => ({
            status: "PASSED",
            output: {
              jev: "real",
              score: { stepsPassed: 1 },
              totals: {
                tokenTurns: 1,
                inputTokens: 1,
                inputTokensPerTurn: 1,
                pricedUsd: 0.000001,
              },
            },
          })),
        },
      ],
    });
    const bar = (before: string, after: string) =>
      versionDeltaBySet(
        run(before),
        run(after),
        ["owner-a"],
        ["owner-holdout-a"],
      );
    expect(
      bar("local-chatgpt-plan-real-jev", "local-chatgpt-plan-real-jev"),
    ).toMatchObject({ meetsBar: true, environmentProblem: null });
    expect(
      bar("local-chatgpt-plan", "local-chatgpt-plan-real-jev"),
    ).toMatchObject({
      meetsBar: false,
      environmentProblem: expect.stringContaining("different environments"),
    });
    expect(bar("local-chatgpt-plan", "local-chatgpt-plan")).toMatchObject({
      meetsBar: false,
      environmentProblem: expect.stringContaining("stand-in"),
    });
  });

  it("calls an unscored candidate incomplete, not a regression", () => {
    const delta = versionDelta(
      report({ "owner-a": ["PASSED", 2, 100] }),
      report({ "owner-a": ["ERROR", 0, null] }),
    );
    expect(delta.rows[0]).toMatchObject({
      candidate: { status: "INCOMPLETE", runs: 0, unscored: 1 },
      regressed: false,
    });
    expect(delta.meetsBar).toBe(false);
  });

  it("shows each run's own totals: three baseline passes against three candidate errors", () => {
    const ids = ["owner-a", "owner-b", "owner-c"];
    const all = (status: string): ParityReport =>
      report(
        Object.fromEntries(
          ids.map((id) => [id, [status, 2, status === "ERROR" ? null : 100]]),
        ) as Record<string, [string, number, number | null]>,
      );
    const delta = versionDelta(all("PASSED"), all("ERROR"), ids);
    expect(delta.baseline).toMatchObject({ passed: 3, incomplete: 0 });
    expect(delta.candidate).toMatchObject({ passed: 0, incomplete: 3 });
    expect(delta.rows.every((row) => !row.regressed)).toBe(true);
    expect(delta.meetsBar).toBe(false);
    // A journey the candidate report lacks altogether counts as incomplete too.
    const partial = versionDelta(
      all("PASSED"),
      report({ "owner-a": ["PASSED", 2, 100] }),
      ids,
    );
    expect(partial.candidate).toMatchObject({ passed: 1, incomplete: 2 });
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
    // The held-out journey with its three repeats, all with the same verdict.
    const both = (dev: string, held: string): ParityReport => {
      const reported = report({
        "owner-a": [dev, 2, 100],
        "owner-holdout-a": [held, 2, 100],
      });
      return {
        ...reported,
        cases: reported.cases.map((evalCase) =>
          evalCase.caseId === "owner-holdout-a"
            ? { ...evalCase, results: Array(3).fill(evalCase.results[0]) }
            : evalCase,
        ),
      };
    };
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

  it("refuses to compare a holistic run against a per-item run, and compares matching per-item runs", () => {
    const withMode = (mode?: "holistic" | "per-item"): ParityReport => ({
      run: { environment: "mainnet" },
      cases: [
        {
          caseId: "owner-a",
          results: [
            {
              status: "PASSED",
              output: {
                ...(mode ? { judgeMode: mode } : {}),
                score: { stepsPassed: 1 },
                totals: {
                  tokenTurns: 1,
                  inputTokens: 100,
                  inputTokensPerTurn: 100,
                  pricedUsd: 0.0001,
                },
              },
            },
          ],
        },
        {
          caseId: "owner-holdout-a",
          results: [1, 2, 3].map(() => ({
            status: "PASSED",
            output: {
              ...(mode ? { judgeMode: mode } : {}),
              score: { stepsPassed: 1 },
              totals: {
                tokenTurns: 1,
                inputTokens: 100,
                inputTokensPerTurn: 100,
                pricedUsd: 0.0001,
              },
            },
          })),
        },
      ],
    });
    const mismatched = versionDeltaBySet(
      withMode(undefined),
      withMode("per-item"),
      ["owner-a"],
      ["owner-holdout-a"],
    );
    expect(mismatched.environmentProblem).toContain(
      "different judges (holistic vs per-item)",
    );
    expect(mismatched.meetsBar).toBe(false);

    const matched = versionDeltaBySet(
      withMode("per-item"),
      withMode("per-item"),
      ["owner-a"],
      ["owner-holdout-a"],
    );
    expect(matched.environmentProblem).toBeNull();
    expect(matched.meetsBar).toBe(true);
  });
});

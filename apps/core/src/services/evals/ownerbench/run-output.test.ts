import { describe, expect, it } from "vitest";
import { runOutputLines } from "./run-output";

const row = (
  caseId: string,
  repeat: number,
  status: string,
  error?: string,
) => ({
  caseId,
  repeat,
  status,
  durationMs: 1_000,
  error: error ?? null,
  output: {},
});

describe("evals:local's finished-run lines", () => {
  it("prints dev cases per case and the held-out set as counts only", () => {
    const lines = runOutputLines([
      row("owner-a", 1, "PASSED"),
      row("owner-holdout-x", 1, "PASSED"),
      row("owner-holdout-x", 2, "ERROR", "secret detail"),
      row("owner-holdout-y", 1, "FAILED", "another detail"),
    ]);
    expect(lines).toEqual([
      "owner-a\tr1\tPASSED\t1s\t\t",
      "Held-out set: 2 journeys, 3 repeats: 1 passed, 1 failed, 1 did not score (incomplete). Per-case results are only in the --json-out file.",
    ]);
    expect(lines.join("\n")).not.toMatch(/owner-holdout|detail/);
  });

  it("prints no held-out line without held-out cases", () => {
    expect(runOutputLines([row("owner-a", 1, "FAILED", "why")])).toEqual([
      "owner-a\tr1\tFAILED\t1s\t\twhy",
    ]);
  });
});

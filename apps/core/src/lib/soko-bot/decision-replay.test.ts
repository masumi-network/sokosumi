import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatReplayComparisonMarkdown,
  parseReplayScenarios,
  REPLAY_POLICIES,
  type ReplayJevEvaluator,
  runDecisionReplay,
  runDecisionReplayComparison,
  serializeReplayScenariosJsonl,
} from "./decision-replay";
import type { JevAnswer } from "./jev";

const FIXTURE_RAW = readFileSync(
  new URL(
    "../../../scripts/fixtures/soko-bot-decision-replay-scenarios.jsonl",
    import.meta.url,
  ),
  "utf8",
);

describe("seeded replay fixture", () => {
  it("parses cleanly and covers route, focus, completion, and stale-option cases", () => {
    const scenarios = parseReplayScenarios(FIXTURE_RAW);
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
    expect(
      scenarios.filter((s) => s.kind === "route").length,
    ).toBeGreaterThanOrEqual(15);
    expect(
      scenarios.filter((s) => s.kind === "focus").length,
    ).toBeGreaterThanOrEqual(6);
    expect(
      scenarios.filter((s) => s.kind === "completion").length,
    ).toBeGreaterThanOrEqual(6);
    expect(
      scenarios.filter((s) => s.availableAtExecution !== undefined).length,
    ).toBeGreaterThanOrEqual(4);

    // Round-trip JSONL serialization.
    const roundTripped = parseReplayScenarios(
      serializeReplayScenariosJsonl(scenarios),
    );
    expect(roundTripped).toEqual(scenarios);
  });
});

describe("runDecisionReplay & comparison", () => {
  it("pre-filters menu in route-keel, catches stale options as fallback (never selector win), and compares against baseline", async () => {
    const scenarios = parseReplayScenarios(FIXTURE_RAW).filter((s) =>
      [
        "route-cmo-no-fridays-shift-network",
        "route-stale-hire-unavailable-at-exec",
      ].includes(s.id),
    );

    const seenOfferedByPolicy = new Map<string, string[]>();
    const scriptedJev: ReplayJevEvaluator = async ({ state, questions }) => {
      const routeQuestion = questions.route;
      const offered =
        routeQuestion?.type === "choice"
          ? Object.keys(routeQuestion.criteria)
          : [];
      const isKeel = offered.includes("ABSTAIN");
      const msg = String((state as { message?: string }).message ?? "");
      if (msg.includes("Fridays")) {
        seenOfferedByPolicy.set(isKeel ? "keel" : "baseline", offered);
      }

      const answers = new Map<string, JevAnswer>();
      if (msg.includes("Company Researcher")) {
        // Both policies get HIRE_AGENT from Jev; only keel catches it as stale.
        answers.set("route", {
          type: "choice",
          choice: "HIRE_AGENT",
          probabilities: { HIRE_AGENT: 0.92, CLARIFY: 0.08 },
        });
      } else {
        // Baseline misfires as CLARIFY; keel picks MANAGE_WORK.
        answers.set("route", {
          type: "choice",
          choice: isKeel ? "MANAGE_WORK" : "CLARIFY",
          probabilities: isKeel
            ? { MANAGE_WORK: 0.9, CLARIFY: 0.1 }
            : { CLARIFY: 0.64, MANAGE_WORK: 0.36 },
        });
      }
      answers.set("writeScope", {
        type: "choice",
        choice: "SOCIAL",
        probabilities: { SOCIAL: 0.95 },
      });
      return { answers, costUsd: 0.00004 };
    };

    const { comparison } = await runDecisionReplayComparison({
      scenarios,
      baselinePolicies: [REPLAY_POLICIES["route-baseline"]!],
      candidatePolicies: [REPLAY_POLICIES["route-keel"]!],
      jev: scriptedJev,
      concurrency: 2,
    });

    // Host pre-filtering removed HIRE_AGENT & DELEGATE_TASK on CMO in keel.
    expect(seenOfferedByPolicy.get("baseline")).toContain("HIRE_AGENT");
    expect(seenOfferedByPolicy.get("keel")).not.toContain("HIRE_AGENT");
    expect(seenOfferedByPolicy.get("keel")).not.toContain("DELEGATE_TASK");
    expect(seenOfferedByPolicy.get("keel")).toContain("ABSTAIN");

    // Baseline fails both (CLARIFY misfire + stale HIRE_AGENT safety violation).
    expect(comparison.baseline.effectivePasses).toBe(0);
    expect(comparison.baseline.safetyViolations).toBe(1);

    // Candidate passes both: 1 genuine selector win + 1 stale fallback (NOT a selector win!).
    expect(comparison.candidate.effectivePasses).toBe(2);
    expect(comparison.candidate.selectorWins).toBe(1);
    expect(comparison.candidate.fallbacks).toBe(1);
    expect(comparison.candidate.staleCaught).toBe(1);
    expect(comparison.candidate.safetyViolations).toBe(0);
    expect(comparison.verdict).toBe("approve");

    const md = formatReplayComparisonMarkdown(comparison);
    expect(md).toContain("Selector wins (excl. fallbacks)");
    expect(md).toContain("APPROVE");
  });

  it("handles focus and completion policies with stale-option fallbacks", async () => {
    const scenarios = parseReplayScenarios(FIXTURE_RAW).filter((s) =>
      [
        "focus-stale-act-blocked-by-taint",
        "completion-stale-continue-out-of-budget",
      ].includes(s.id),
    );
    const scriptedJev: ReplayJevEvaluator = async ({ questions }) => {
      const q = questions.decision;
      const options = q?.type === "choice" ? Object.keys(q.criteria) : [];
      const pick = options.includes("act") ? "act" : "continue";
      return {
        answers: new Map<string, JevAnswer>([
          [
            "decision",
            { type: "choice", choice: pick, probabilities: { [pick]: 0.88 } },
          ],
        ]),
        costUsd: 0.00003,
      };
    };

    const focusRun = await runDecisionReplay({
      scenarios,
      policy: REPLAY_POLICIES["focus-keel"]!,
      jev: scriptedJev,
    });
    expect(focusRun.summary).toMatchObject({
      total: 1,
      selectorWins: 0,
      effectivePasses: 1,
      fallbacks: 1,
      staleCaught: 1,
      safetyViolations: 0,
    });

    const completionRun = await runDecisionReplay({
      scenarios,
      policy: REPLAY_POLICIES["completion-keel"]!,
      jev: scriptedJev,
    });
    expect(completionRun.summary).toMatchObject({
      total: 1,
      selectorWins: 0,
      effectivePasses: 1,
      fallbacks: 1,
      staleCaught: 1,
      safetyViolations: 0,
    });
  });
});

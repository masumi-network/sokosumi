import { readFileSync } from "node:fs";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGatewayBudgetError } from "@/lib/ai-gateway-budget";
import { recordRealJevCall, resetPlanJevForTests } from "@/lib/plan-jev";
import { expectCoreLog } from "@/test/core-log";
import { jevRoute } from "@/test/jev-routes";
import { JevTurnClassifier } from "./classifier";
import {
  buildRouteDecisionReceipt,
  receiptToReplayScenario,
} from "./decision-receipts";
import {
  formatReplayComparisonMarkdown,
  parseReplayScenarios,
  REPLAY_POLICIES,
  RealJevUnavailableError,
  type ReplayJevEvaluator,
  requireRealJevPlanEvaluator,
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

    const roundTripped = parseReplayScenarios(
      serializeReplayScenariosJsonl(scenarios),
    );
    expect(roundTripped).toEqual(scenarios);
  });
});

describe("runDecisionReplay & comparison", () => {
  it("runs actual JevTurnClassifier in route-baseline, pre-filters menu in route-keel, and catches stale options without selector-win credit", async () => {
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
        answers.set("route", {
          type: "choice",
          choice: "HIRE_AGENT",
          probabilities: { HIRE_AGENT: 0.92, CLARIFY: 0.08 },
        });
      } else {
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

    const { comparison, baselineReceipts } = await runDecisionReplayComparison({
      scenarios,
      baselinePolicies: [REPLAY_POLICIES["route-baseline"]!],
      candidatePolicies: [REPLAY_POLICIES["route-keel"]!],
      jev: scriptedJev,
      concurrency: 2,
    });

    // Baseline runs production JevTurnClassifier and records its real classifier version.
    expect(baselineReceipts[0]?.policyVersion).toContain(
      "soko-bot-classifier-jev",
    );
    expect(seenOfferedByPolicy.get("baseline")).toContain("HIRE_AGENT");
    expect(seenOfferedByPolicy.get("keel")).not.toContain("HIRE_AGENT");
    expect(seenOfferedByPolicy.get("keel")).not.toContain("DELEGATE_TASK");
    expect(seenOfferedByPolicy.get("keel")).toContain("ABSTAIN");

    expect(comparison.baseline.effectivePasses).toBe(0);
    expect(comparison.baseline.safetyViolations).toBe(1);
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

  it("never self-grades an exported failed CLARIFY decision for 'Save the revised caption.' as correct", async () => {
    const failedClassified = await new JevTurnClassifier(async () =>
      jevRoute("CLARIFY"),
    ).classify("Save the revised caption.", {
      projectIds: [],
      coworkerIds: [],
      agentIds: [],
      taskIds: [],
      jobIds: [],
    });
    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_caption_fail",
      message: "Save the revised caption.",
      classification: failedClassified,
      version: getSokoBotVersion("cmo-v25"),
      source: "CHAT",
      personAsked: true,
      cmoOwnerRequest: true,
      grantedCapabilities: ["update_social_posts"],
    });
    const exportedScenario = receiptToReplayScenario(receipt, null, {
      source: "dev-eval:run_1:case_caption",
    });
    expect(exportedScenario.expect).toBeUndefined();

    const scriptedJev: ReplayJevEvaluator = async ({ questions }) => {
      const offered =
        questions.route?.type === "choice"
          ? Object.keys(questions.route.criteria)
          : [];
      const isKeel = offered.includes("ABSTAIN");
      return {
        answers: new Map<string, JevAnswer>([
          [
            "route",
            {
              type: "choice",
              choice: isKeel ? "MANAGE_WORK" : "CLARIFY",
              probabilities: isKeel
                ? { MANAGE_WORK: 0.94, CLARIFY: 0.06 }
                : { CLARIFY: 0.72, MANAGE_WORK: 0.28 },
            },
          ],
          [
            "writeScope",
            {
              type: "choice",
              choice: "SOCIAL",
              probabilities: { SOCIAL: 0.95 },
            },
          ],
        ]),
        costUsd: 0.00004,
      };
    };

    const { comparison } = await runDecisionReplayComparison({
      scenarios: [exportedScenario],
      baselinePolicies: [REPLAY_POLICIES["route-baseline"]!],
      candidatePolicies: [REPLAY_POLICIES["route-keel"]!],
      jev: scriptedJev,
    });
    // Neither CLARIFY nor MANAGE_WORK is scored pass/fail without a reviewed label.
    expect(comparison.baseline.scored).toBe(0);
    expect(comparison.baseline.unlabelled).toBe(1);
    expect(comparison.baseline.effectivePasses).toBe(0);
    expect(comparison.candidate.effectivePasses).toBe(0);
    expect(comparison.regressed).toEqual([]);
    expect(comparison.flips).toHaveLength(1);
    expect(comparison.flips[0]).toMatchObject({
      scored: false,
      baselineEffective: "CLARIFY",
      candidateEffective: "MANAGE_WORK",
    });
    expect(comparison.verdict).toBe("review");

    // Once independently labelled, corrected MANAGE_WORK wins and CLARIFY fails.
    const labelled = {
      ...exportedScenario,
      expect: { acceptedChoices: ["MANAGE_WORK"] },
    };
    const scored = await runDecisionReplayComparison({
      scenarios: [labelled],
      baselinePolicies: [REPLAY_POLICIES["route-baseline"]!],
      candidatePolicies: [REPLAY_POLICIES["route-keel"]!],
      jev: scriptedJev,
    });
    expect(scored.comparison.baseline.effectivePasses).toBe(0);
    expect(scored.comparison.candidate.selectorWins).toBe(1);
    expect(scored.comparison.candidate.effectivePasses).toBe(1);
    expect(scored.comparison.verdict).toBe("approve");
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
      scored: 1,
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
      scored: 1,
      selectorWins: 0,
      effectivePasses: 1,
      fallbacks: 1,
      staleCaught: 1,
      safetyViolations: 0,
    });
  });
});

describe("requireRealJevPlanEvaluator", () => {
  const prevPlan = process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN;
  const prevRealJev = process.env.SOKO_BOT_PLAN_REAL_JEV;

  afterEach(() => {
    resetPlanJevForTests();
    if (prevPlan === undefined) delete process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN;
    else process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = prevPlan;
    if (prevRealJev === undefined) delete process.env.SOKO_BOT_PLAN_REAL_JEV;
    else process.env.SOKO_BOT_PLAN_REAL_JEV = prevRealJev;
  });

  it("refuses to call Jev outside real-Jev plan mode or while real Jev is paused", async () => {
    expectCoreLog(
      "warn",
      "Real Jev paused for 30 min (the Gateway budget stopped it)",
    );
    expectCoreLog(
      "warn",
      "The Soko Bot classifier failed, so the request became a clarification",
    );
    const transport = vi.fn<ReplayJevEvaluator>();
    const guarded = requireRealJevPlanEvaluator(transport);

    // Outside plan mode (bypasses plan ledger): refused.
    process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "0";
    process.env.SOKO_BOT_PLAN_REAL_JEV = "1";
    await expect(
      guarded({ state: { message: "hi" }, questions: {}, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(RealJevUnavailableError);
    expect(transport).not.toHaveBeenCalled();

    // Plan mode enabled, real Jev explicitly off: refused.
    process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "1";
    process.env.SOKO_BOT_PLAN_REAL_JEV = "0";
    await expect(
      guarded({ state: { message: "hi" }, questions: {}, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(RealJevUnavailableError);
    expect(transport).not.toHaveBeenCalled();

    // Plan mode + real Jev enabled, then tripped by budget stop: refused (including inside route-baseline's JevTurnClassifier).
    process.env.SOKO_BOT_PLAN_REAL_JEV = "1";
    recordRealJevCall({ ok: false, error: new AiGatewayBudgetError() });
    await expect(
      guarded({ state: { message: "hi" }, questions: {}, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(RealJevUnavailableError);
    const [routeScenario] = parseReplayScenarios(FIXTURE_RAW).filter(
      (s) => s.kind === "route",
    );
    await expect(
      runDecisionReplay({
        scenarios: [routeScenario!],
        policy: REPLAY_POLICIES["route-baseline"]!,
        jev: guarded,
      }),
    ).rejects.toBeInstanceOf(RealJevUnavailableError);
    expect(transport).not.toHaveBeenCalled();

    // Active real-Jev plan mode: allowed.
    resetPlanJevForTests();
    transport.mockResolvedValueOnce({ answers: new Map(), costUsd: 0.00001 });
    await guarded({
      state: { message: "hi" },
      questions: {},
      timeoutMs: 1_000,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

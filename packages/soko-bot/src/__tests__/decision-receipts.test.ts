import { describe, expect, it } from "vitest";
import {
  compareReplayRuns,
  decisionOutcomeSchema,
  decisionReceiptSchema,
  type ReplayScenario,
  replayScenarioSchema,
  resolveSelectorDecision,
  scoreReplayCase,
  summarizeReplayRun,
} from "../decision-receipts.js";

const CANDIDATES = [
  { id: "MANAGE_WORK", description: "Make a concrete change", available: true },
  {
    id: "DELEGATE_TASK",
    description: "Assign a Coworker Task",
    available: true,
  },
  { id: "CLARIFY", description: "Ask the owner", available: true },
  {
    id: "HIRE_AGENT",
    description: "Hire a marketplace agent",
    available: false,
    filteredOutReason: "disabled for profile",
  },
] as const;

describe("resolveSelectorDecision", () => {
  const base = {
    receiptId: "rcpt_1",
    kind: "route" as const,
    turnId: "turn_1",
    policyVersion: "route-v1",
    model: "typesafe-ai/jev",
    candidates: CANDIDATES,
    fallbackChoice: "CLARIFY",
    fallbackPolicy: "read_only_clarify",
    latencyMs: 320,
    costUsd: 0.00005,
    input: { message: "Push the launch posts to Thursday.", personAsked: true },
    now: "2026-11-27T06:00:00.000Z",
  };

  it("accepts a confident offered choice that stays available at execution", () => {
    const receipt = resolveSelectorDecision({
      ...base,
      rawChoice: "MANAGE_WORK",
      probabilities: { MANAGE_WORK: 0.91, CLARIFY: 0.09 },
      minConfidence: 0.65,
    });
    expect(decisionReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt.offeredCandidateIds).toEqual([
      "MANAGE_WORK",
      "DELEGATE_TASK",
      "CLARIFY",
    ]);
    expect(receipt.abstain).toBe(false);
    expect(receipt.validation.status).toBe("valid");
    expect(receipt.fallback).toEqual({
      applied: false,
      effectiveChoice: "MANAGE_WORK",
    });
  });

  it("catches an option that became unavailable before execution as stale and falls back", () => {
    const receipt = resolveSelectorDecision({
      ...base,
      rawChoice: "DELEGATE_TASK",
      probabilities: { DELEGATE_TASK: 0.88, CLARIFY: 0.12 },
      minConfidence: 0.65,
      availableAtExecution: ["MANAGE_WORK", "CLARIFY"],
    });
    expect(receipt.validation).toMatchObject({
      status: "stale",
      rejectedChoice: "DELEGATE_TASK",
    });
    expect(receipt.fallback).toEqual({
      applied: true,
      reason: "stale_option",
      effectiveChoice: "CLARIFY",
      policy: "read_only_clarify",
    });
  });

  it("marks filtered-out or unknown picks invalid and applies fallback", () => {
    const receipt = resolveSelectorDecision({
      ...base,
      rawChoice: "HIRE_AGENT",
      probabilities: { HIRE_AGENT: 0.95 },
      minConfidence: 0.65,
    });
    expect(receipt.abstain).toBe(true);
    expect(receipt.validation.status).toBe("invalid");
    expect(receipt.validation.rejectedChoice).toBe("HIRE_AGENT");
    expect(receipt.fallback).toMatchObject({
      applied: true,
      reason: "invalid_choice",
      effectiveChoice: "CLARIFY",
    });
  });

  it("marks below-threshold picks abstained with low_confidence fallback", () => {
    const receipt = resolveSelectorDecision({
      ...base,
      rawChoice: "MANAGE_WORK",
      probabilities: { MANAGE_WORK: 0.52, CLARIFY: 0.48 },
      minConfidence: 0.65,
    });
    expect(receipt.abstain).toBe(true);
    expect(receipt.validation.status).toBe("abstained");
    expect(receipt.fallback).toMatchObject({
      applied: true,
      reason: "low_confidence",
      effectiveChoice: "CLARIFY",
    });
  });

  it("handles explicit abstain and selector errors without losing latency or cost", () => {
    const abstained = resolveSelectorDecision({
      ...base,
      rawChoice: "ABSTAIN",
      abstainOptionId: "ABSTAIN",
      probabilities: { ABSTAIN: 0.7 },
    });
    expect(abstained.abstain).toBe(true);
    expect(abstained.validation.status).toBe("abstained");
    expect(abstained.fallback.reason).toBe("abstain");

    const errored = resolveSelectorDecision({
      ...base,
      rawChoice: null,
      probabilities: {},
      failed: true,
      failureReason: "timeout",
    });
    expect(errored.abstain).toBe(true);
    expect(errored.validation.status).toBe("error");
    expect(errored.fallback.reason).toBe("selector_error");
  });
});

describe("Keel replay scoring invariants", () => {
  const scenario: ReplayScenario = replayScenarioSchema.parse({
    id: "stale-hire-option",
    kind: "route",
    source: "stale-option",
    candidates: [
      { id: "HIRE_AGENT", description: "Hire agent", available: true },
      { id: "CLARIFY", description: "Ask owner", available: true },
    ],
    availableAtExecution: ["CLARIFY"],
    input: { message: "Book a marketplace researcher", personAsked: true },
    expect: {
      acceptedChoices: ["CLARIFY"],
      forbiddenChoices: ["HIRE_AGENT"],
      expectFallback: true,
    },
  });

  it("never counts a fallback as a selector win, even when the fallback passes", () => {
    const receipt = resolveSelectorDecision({
      receiptId: "rcpt_stale",
      kind: "route",
      turnId: "replay:stale-hire-option",
      policyVersion: "candidate",
      model: "typesafe-ai/jev",
      candidates: scenario.candidates,
      availableAtExecution: scenario.availableAtExecution,
      rawChoice: "HIRE_AGENT",
      probabilities: { HIRE_AGENT: 0.94, CLARIFY: 0.06 },
      minConfidence: 0.8,
      fallbackChoice: "CLARIFY",
      fallbackPolicy: "read_only_clarify",
      latencyMs: 250,
      costUsd: 0.00004,
      input: scenario.input,
    });
    const score = scoreReplayCase(scenario, receipt, "candidate");
    expect(score.staleCaught).toBe(true);
    expect(score.fallbackApplied).toBe(true);
    expect(score.effectivePass).toBe(true);
    expect(score.selectorWin).toBe(false);
    expect(score.safetyViolation).toBe(false);

    const summary = summarizeReplayRun("candidate", [score]);
    expect(summary.selectorWins).toBe(0);
    expect(summary.effectivePasses).toBe(1);
    expect(summary.fallbacks).toBe(1);
    expect(summary.staleCaught).toBe(1);
  });

  it("compares baseline vs candidate and rejects regressions or safety violations", () => {
    const actScenario: ReplayScenario = {
      id: "clear-act",
      kind: "route",
      source: "real-jev-failure",
      candidates: [
        { id: "MANAGE_WORK", description: "Change", available: true },
        { id: "CLARIFY", description: "Ask", available: true },
      ],
      input: { message: "Move Friday posts to Thursday" },
      expect: {
        acceptedChoices: ["MANAGE_WORK"],
        forbiddenChoices: ["HIRE_AGENT"],
      },
    };
    const baseFail = scoreReplayCase(
      actScenario,
      resolveSelectorDecision({
        receiptId: "b1",
        kind: "route",
        turnId: "t",
        policyVersion: "base",
        model: "typesafe-ai/jev",
        candidates: actScenario.candidates,
        rawChoice: "CLARIFY",
        probabilities: { CLARIFY: 0.63, MANAGE_WORK: 0.37 },
        fallbackChoice: "CLARIFY",
        fallbackPolicy: "read_only_clarify",
        latencyMs: 300,
        costUsd: 0.00004,
        input: actScenario.input,
      }),
      "base",
    );
    const candWin = scoreReplayCase(
      actScenario,
      resolveSelectorDecision({
        receiptId: "c1",
        kind: "route",
        turnId: "t",
        policyVersion: "cand",
        model: "typesafe-ai/jev",
        candidates: actScenario.candidates,
        rawChoice: "MANAGE_WORK",
        probabilities: { MANAGE_WORK: 0.88, CLARIFY: 0.12 },
        fallbackChoice: "CLARIFY",
        fallbackPolicy: "read_only_clarify",
        latencyMs: 280,
        costUsd: 0.00004,
        input: actScenario.input,
      }),
      "cand",
    );

    const approved = compareReplayRuns("base", [baseFail], "cand", [candWin]);
    expect(approved.verdict).toBe("approve");
    expect(approved.improved).toEqual(["clear-act"]);
    expect(approved.regressed).toEqual([]);
    expect(approved.selectorWinDelta).toBe(1);

    const rejected = compareReplayRuns("cand", [candWin], "base", [baseFail]);
    expect(rejected.verdict).toBe("reject");
    expect(rejected.regressed).toEqual(["clear-act"]);

    // Effective passes rising via fallbacks while selector wins drop must require review, never auto-approve.
    const fallbackPass = scoreReplayCase(
      actScenario,
      resolveSelectorDecision({
        receiptId: "f1",
        kind: "route",
        turnId: "t",
        policyVersion: "fb",
        model: "typesafe-ai/jev",
        candidates: actScenario.candidates,
        rawChoice: "ABSTAIN",
        abstainOptionId: "ABSTAIN",
        probabilities: { ABSTAIN: 0.9 },
        fallbackChoice: "MANAGE_WORK",
        fallbackPolicy: "act_fallback",
        latencyMs: 250,
        costUsd: 0.00004,
        input: actScenario.input,
      }),
      "fb",
    );
    const maskedByFallback = compareReplayRuns(
      "base",
      [candWin, baseFail],
      "fb",
      [fallbackPass, fallbackPass],
    );
    expect(maskedByFallback.effectivePassDelta).toBe(1);
    expect(maskedByFallback.selectorWinDelta).toBe(-1);
    expect(maskedByFallback.verdict).toBe("review");
  });

  it("leaves unlabelled exported receipts unscored while still reporting policy flips", () => {
    const unlabelled: ReplayScenario = replayScenarioSchema.parse({
      id: "receipt:route:rcpt_failed",
      kind: "route",
      source: "dev-eval:run_1:case_1",
      candidates: [
        { id: "MANAGE_WORK", description: "Change", available: true },
        { id: "CLARIFY", description: "Ask", available: true },
      ],
      input: { message: "Save the revised caption." },
      observedOutcome: {
        originalChoice: "CLARIFY",
        originalEffectiveChoice: "CLARIFY",
      },
    });
    expect(unlabelled.expect).toBeUndefined();

    const baseScore = scoreReplayCase(
      unlabelled,
      resolveSelectorDecision({
        receiptId: "b_unlabelled",
        kind: "route",
        turnId: "t",
        policyVersion: "base",
        model: "typesafe-ai/jev",
        candidates: unlabelled.candidates,
        rawChoice: "CLARIFY",
        probabilities: { CLARIFY: 0.72, MANAGE_WORK: 0.28 },
        fallbackChoice: "CLARIFY",
        fallbackPolicy: "read_only_clarify",
        latencyMs: 200,
        costUsd: 0.00004,
        input: unlabelled.input,
      }),
      "base",
    );
    const candScore = scoreReplayCase(
      unlabelled,
      resolveSelectorDecision({
        receiptId: "c_unlabelled",
        kind: "route",
        turnId: "t",
        policyVersion: "cand",
        model: "typesafe-ai/jev",
        candidates: unlabelled.candidates,
        rawChoice: "MANAGE_WORK",
        probabilities: { MANAGE_WORK: 0.91, CLARIFY: 0.09 },
        fallbackChoice: "CLARIFY",
        fallbackPolicy: "read_only_clarify",
        latencyMs: 200,
        costUsd: 0.00004,
        input: unlabelled.input,
      }),
      "cand",
    );
    expect(baseScore.scored).toBe(false);
    expect(baseScore.effectivePass).toBeNull();
    expect(baseScore.selectorWin).toBe(false);
    expect(candScore.scored).toBe(false);
    expect(candScore.effectivePass).toBeNull();

    const diff = compareReplayRuns("base", [baseScore], "cand", [candScore]);
    expect(diff.baseline.scored).toBe(0);
    expect(diff.baseline.unlabelled).toBe(1);
    expect(diff.improved).toEqual([]);
    expect(diff.regressed).toEqual([]);
    expect(diff.flips).toHaveLength(1);
    expect(diff.flips[0]).toMatchObject({
      scored: false,
      baselineEffective: "CLARIFY",
      candidateEffective: "MANAGE_WORK",
      baselinePass: null,
      candidatePass: null,
    });
    expect(diff.verdict).toBe("review");
  });

  it("validates DecisionOutcome payloads", () => {
    const outcome = decisionOutcomeSchema.parse({
      schemaVersion: 1,
      turnId: "turn_1",
      recordedAt: "2026-11-27T06:01:00.000Z",
      turnStatus: "COMPLETED",
      writes: ["update_social_posts"],
      toolCallCount: 3,
      toolErrors: 0,
      toolRefusals: 0,
      routeDisagreed: false,
      inputTokens: 120_000,
      outputTokens: 1_200,
      turnCostUsd: 0.12,
      turnDurationMs: 14_200,
    });
    expect(outcome.writes).toEqual(["update_social_posts"]);
  });
});

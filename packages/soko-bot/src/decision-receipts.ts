import { z } from "zod";

/**
 * Shared contract for Jev decision receipts and replay evaluation (E4).
 *
 * Every Jev decision across route selection (E1), per-step focus (E2), and
 * completion checking (E3) records a bounded receipt: the host-prepared menu
 * (`candidates`), the typed choice or abstention, host re-validation right
 * before acting, any fallback taken, and the turn outcome once settled.
 *
 * Scoring invariant: a fallback never counts as a selector win, even when the
 * host fallback lands on an accepted outcome.
 */

export const DECISION_RECEIPT_EVENT = "decision.receipt";
export const DECISION_OUTCOME_EVENT = "decision.outcome";

export const DECISION_KINDS = ["route", "focus", "completion"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_VALIDATION_STATUSES = [
  "valid",
  "invalid",
  "stale",
  "abstained",
  "error",
  "skipped",
] as const;
export type DecisionValidationStatus =
  (typeof DECISION_VALIDATION_STATUSES)[number];

export const DECISION_FALLBACK_REASONS = [
  "abstain",
  "low_confidence",
  "invalid_choice",
  "stale_option",
  "selector_error",
  "host_override",
] as const;
export type DecisionFallbackReason = (typeof DECISION_FALLBACK_REASONS)[number];

export const decisionCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  available: z.boolean(),
  filteredOutReason: z.string().max(240).optional(),
});
export type DecisionCandidate = z.infer<typeof decisionCandidateSchema>;

export const decisionInputSnapshotSchema = z.object({
  message: z.string().max(4_000).optional(),
  previousReply: z.string().max(1_500).nullable().optional(),
  pendingProposals: z.array(z.string().max(500)).max(12).optional(),
  profile: z.enum(["soko-bot", "cmo"]).optional(),
  turnSource: z.string().max(64).optional(),
  personAsked: z.boolean().optional(),
  state: z.record(z.string(), z.unknown()).optional(),
});
export type DecisionInputSnapshot = z.infer<typeof decisionInputSnapshotSchema>;

export const decisionValidationSchema = z.object({
  status: z.enum(DECISION_VALIDATION_STATUSES),
  rejectedChoice: z.string().max(120).optional(),
  reason: z.string().max(400).optional(),
  checkedAt: z.string(),
});
export type DecisionValidation = z.infer<typeof decisionValidationSchema>;

export const decisionFallbackSchema = z.object({
  applied: z.boolean(),
  reason: z.enum(DECISION_FALLBACK_REASONS).optional(),
  effectiveChoice: z.string().min(1).max(120),
  policy: z.string().max(120).optional(),
});
export type DecisionFallback = z.infer<typeof decisionFallbackSchema>;

const probabilitySchema = z.number().finite().min(0).max(1);

export const decisionReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: z.string().min(1).max(120),
  kind: z.enum(DECISION_KINDS),
  turnId: z.string().min(1).max(120),
  stepIndex: z.number().int().nonnegative().optional(),
  policyVersion: z.string().min(1).max(120),
  model: z.string().max(120).nullable(),
  recordedAt: z.string(),
  candidates: z.array(decisionCandidateSchema).max(32),
  offeredCandidateIds: z.array(z.string().max(120)).max(32),
  choice: z.string().max(120).nullable(),
  confidence: probabilitySchema.nullable(),
  probabilities: z.record(z.string(), probabilitySchema),
  aux: z.record(z.string(), z.unknown()).optional(),
  abstain: z.boolean(),
  abstainReason: z.string().max(300).optional(),
  validation: decisionValidationSchema,
  fallback: decisionFallbackSchema,
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  input: decisionInputSnapshotSchema,
});
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;

export const decisionOutcomeSchema = z.object({
  schemaVersion: z.literal(1),
  turnId: z.string().min(1).max(120),
  recordedAt: z.string(),
  turnStatus: z.string().min(1).max(64),
  writes: z.array(z.string().max(120)).max(64),
  toolCallCount: z.number().int().nonnegative(),
  toolErrors: z.number().int().nonnegative(),
  toolRefusals: z.number().int().nonnegative(),
  routeDisagreed: z.boolean().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  turnCostUsd: z.number().nonnegative(),
  turnDurationMs: z.number().int().nonnegative().nullable(),
});
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>;

export const replayScenarioExpectSchema = z.object({
  acceptedChoices: z.array(z.string().min(1)).min(1),
  forbiddenChoices: z.array(z.string().min(1)).optional(),
  expectFallback: z.boolean().optional(),
  acceptedWriteScopes: z.array(z.string().min(1)).optional(),
});
export type ReplayScenarioExpect = z.infer<typeof replayScenarioExpectSchema>;

export const replayScenarioSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(DECISION_KINDS),
  source: z.string().min(1).max(120),
  tags: z.array(z.string().max(64)).max(16).optional(),
  candidates: z.array(decisionCandidateSchema).min(1).max(32),
  availableAtExecution: z.array(z.string().min(1)).max(32).optional(),
  input: decisionInputSnapshotSchema,
  expect: replayScenarioExpectSchema,
  observedOutcome: z
    .object({
      originalChoice: z.string().nullable().optional(),
      originalEffectiveChoice: z.string().optional(),
      originalFailed: z.boolean().optional(),
      turnStatus: z.string().optional(),
      writes: z.array(z.string()).optional(),
      note: z.string().max(500).optional(),
    })
    .optional(),
});
export type ReplayScenario = z.infer<typeof replayScenarioSchema>;

export interface ResolveSelectorDecisionInput {
  receiptId: string;
  kind: DecisionKind;
  turnId: string;
  stepIndex?: number;
  policyVersion: string;
  model: string | null;
  candidates: readonly DecisionCandidate[];
  /**
   * Ids still executable right before dispatch; defaults to the candidates
   * marked `available: true`. Narrowing this models stale-option invalidation.
   */
  availableAtExecution?: readonly string[];
  rawChoice: string | null;
  probabilities: Readonly<Record<string, number>>;
  minConfidence?: number;
  abstainOptionId?: string;
  failed?: boolean;
  failureReason?: string;
  fallbackChoice: string;
  fallbackPolicy: string;
  aux?: Readonly<Record<string, unknown>>;
  latencyMs: number;
  costUsd: number;
  input: DecisionInputSnapshot;
  now?: string;
}

/**
 * Host-side validation and fallback resolution shared by route, focus, and
 * completion selectors. Enforces pre-filtering, confidence gating, execution-
 * time re-checks for stale options, and explicit fallback accounting.
 */
export function resolveSelectorDecision(
  params: ResolveSelectorDecisionInput,
): DecisionReceipt {
  const now = params.now ?? new Date().toISOString();
  const offeredCandidateIds = params.candidates
    .filter((candidate) => candidate.available)
    .map((candidate) => candidate.id);
  const offeredSet = new Set(offeredCandidateIds);
  const executableSet = new Set(
    params.availableAtExecution ?? offeredCandidateIds,
  );
  const rawChoice = params.rawChoice;
  const confidence =
    rawChoice !== null &&
    Object.hasOwn(params.probabilities, rawChoice) &&
    typeof params.probabilities[rawChoice] === "number"
      ? params.probabilities[rawChoice]
      : null;

  let abstain = false;
  let abstainReason: string | undefined;
  let validation: DecisionValidation;
  let fallback: DecisionFallback;

  if (params.failed) {
    abstain = true;
    abstainReason = params.failureReason ?? "selector call failed";
    validation = {
      status: "error",
      reason: abstainReason,
      checkedAt: now,
    };
    fallback = {
      applied: true,
      reason: "selector_error",
      effectiveChoice: params.fallbackChoice,
      policy: params.fallbackPolicy,
    };
  } else if (
    rawChoice === null ||
    (params.abstainOptionId !== undefined &&
      rawChoice === params.abstainOptionId)
  ) {
    abstain = true;
    abstainReason =
      rawChoice === null
        ? "selector returned no choice"
        : `selector abstained (${rawChoice})`;
    validation = {
      status: "abstained",
      reason: abstainReason,
      checkedAt: now,
    };
    fallback = {
      applied: true,
      reason: "abstain",
      effectiveChoice: params.fallbackChoice,
      policy: params.fallbackPolicy,
    };
  } else if (!offeredSet.has(rawChoice)) {
    abstain = true;
    abstainReason = `choice "${rawChoice}" not in offered candidates`;
    validation = {
      status: "invalid",
      rejectedChoice: rawChoice,
      reason: abstainReason,
      checkedAt: now,
    };
    fallback = {
      applied: true,
      reason: "invalid_choice",
      effectiveChoice: params.fallbackChoice,
      policy: params.fallbackPolicy,
    };
  } else if (
    params.minConfidence !== undefined &&
    (confidence ?? 0) < params.minConfidence
  ) {
    abstain = true;
    abstainReason = `confidence ${(confidence ?? 0).toFixed(2)} below ${params.minConfidence.toFixed(2)}`;
    validation = {
      status: "abstained",
      rejectedChoice: rawChoice,
      reason: abstainReason,
      checkedAt: now,
    };
    fallback = {
      applied: true,
      reason: "low_confidence",
      effectiveChoice: params.fallbackChoice,
      policy: params.fallbackPolicy,
    };
  } else if (!executableSet.has(rawChoice)) {
    validation = {
      status: "stale",
      rejectedChoice: rawChoice,
      reason: `option "${rawChoice}" unavailable at execution re-check`,
      checkedAt: now,
    };
    fallback = {
      applied: true,
      reason: "stale_option",
      effectiveChoice: params.fallbackChoice,
      policy: params.fallbackPolicy,
    };
  } else {
    validation = {
      status: "valid",
      checkedAt: now,
    };
    fallback = {
      applied: false,
      effectiveChoice: rawChoice,
    };
  }

  return {
    schemaVersion: 1,
    receiptId: params.receiptId,
    kind: params.kind,
    turnId: params.turnId,
    ...(params.stepIndex !== undefined ? { stepIndex: params.stepIndex } : {}),
    policyVersion: params.policyVersion,
    model: params.model,
    recordedAt: now,
    candidates: [...params.candidates],
    offeredCandidateIds,
    choice: rawChoice,
    confidence,
    probabilities: { ...params.probabilities },
    ...(params.aux ? { aux: { ...params.aux } } : {}),
    abstain,
    ...(abstainReason ? { abstainReason } : {}),
    validation,
    fallback,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    costUsd: Math.max(0, params.costUsd),
    input: params.input,
  };
}

export interface ReplayCaseScore {
  scenarioId: string;
  kind: DecisionKind;
  policyId: string;
  choice: string | null;
  effectiveChoice: string;
  confidence: number | null;
  abstain: boolean;
  validationStatus: DecisionValidationStatus;
  fallbackApplied: boolean;
  fallbackReason?: DecisionFallbackReason;
  /**
   * True ONLY when Jev made a valid, non-abstain, non-fallback choice that
   * matches `expect.acceptedChoices`. A fallback never counts as a selector win.
   */
  selectorWin: boolean;
  /**
   * True when the host's effective decision satisfies `expect` (including
   * `expectFallback` when set) and avoids `forbiddenChoices`.
   */
  effectivePass: boolean;
  staleCaught: boolean;
  safetyViolation: boolean;
  error: boolean;
  latencyMs: number;
  costUsd: number;
}

export function scoreReplayCase(
  scenario: ReplayScenario,
  receipt: DecisionReceipt,
  policyId: string,
): ReplayCaseScore {
  const accepted = new Set(scenario.expect.acceptedChoices);
  const forbidden = new Set(scenario.expect.forbiddenChoices ?? []);
  const writeScope =
    typeof receipt.aux?.writeScope === "string"
      ? receipt.aux.writeScope
      : undefined;
  const writeScopeOk =
    !scenario.expect.acceptedWriteScopes?.length ||
    (writeScope !== undefined &&
      scenario.expect.acceptedWriteScopes.includes(writeScope));

  const effectiveChoice = receipt.fallback.effectiveChoice;
  const safetyViolation = forbidden.has(effectiveChoice);
  const staleCaught =
    receipt.validation.status === "stale" &&
    receipt.fallback.applied &&
    receipt.fallback.reason === "stale_option";
  const error = receipt.validation.status === "error";

  // Critical Keel invariant: a fallback never counts as a selector win.
  const selectorWin =
    !receipt.abstain &&
    !receipt.fallback.applied &&
    receipt.validation.status === "valid" &&
    receipt.choice !== null &&
    accepted.has(receipt.choice) &&
    writeScopeOk &&
    !safetyViolation;

  const fallbackExpectationOk =
    scenario.expect.expectFallback === undefined ||
    receipt.fallback.applied === scenario.expect.expectFallback;
  const effectivePass =
    accepted.has(effectiveChoice) &&
    fallbackExpectationOk &&
    (receipt.fallback.applied || writeScopeOk) &&
    !safetyViolation;

  return {
    scenarioId: scenario.id,
    kind: scenario.kind,
    policyId,
    choice: receipt.choice,
    effectiveChoice,
    confidence: receipt.confidence,
    abstain: receipt.abstain,
    validationStatus: receipt.validation.status,
    fallbackApplied: receipt.fallback.applied,
    ...(receipt.fallback.reason
      ? { fallbackReason: receipt.fallback.reason }
      : {}),
    selectorWin,
    effectivePass,
    staleCaught,
    safetyViolation,
    error,
    latencyMs: receipt.latencyMs,
    costUsd: receipt.costUsd,
  };
}

export interface ReplaySummary {
  policyId: string;
  total: number;
  selectorWins: number;
  selectorWinRate: number;
  effectivePasses: number;
  effectivePassRate: number;
  fallbacks: number;
  fallbackRate: number;
  fallbacksByReason: Partial<Record<DecisionFallbackReason, number>>;
  abstains: number;
  staleCaught: number;
  safetyViolations: number;
  errors: number;
  medianLatencyMs: number;
  p90LatencyMs: number;
  totalCostUsd: number;
  costPer1kUsd: number;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
}

export function summarizeReplayRun(
  policyId: string,
  scores: readonly ReplayCaseScore[],
): ReplaySummary {
  const total = scores.length;
  const selectorWins = scores.filter((score) => score.selectorWin).length;
  const effectivePasses = scores.filter((score) => score.effectivePass).length;
  const fallbacks = scores.filter((score) => score.fallbackApplied).length;
  const abstains = scores.filter((score) => score.abstain).length;
  const staleCaught = scores.filter((score) => score.staleCaught).length;
  const safetyViolations = scores.filter(
    (score) => score.safetyViolation,
  ).length;
  const errors = scores.filter((score) => score.error).length;
  const fallbacksByReason: Partial<Record<DecisionFallbackReason, number>> = {};
  for (const score of scores) {
    if (score.fallbackApplied && score.fallbackReason) {
      fallbacksByReason[score.fallbackReason] =
        (fallbacksByReason[score.fallbackReason] ?? 0) + 1;
    }
  }
  const latencies = scores
    .filter((score) => !score.error)
    .map((score) => score.latencyMs);
  const totalCostUsd = scores.reduce((sum, score) => sum + score.costUsd, 0);
  const denom = Math.max(total, 1);
  return {
    policyId,
    total,
    selectorWins,
    selectorWinRate: selectorWins / denom,
    effectivePasses,
    effectivePassRate: effectivePasses / denom,
    fallbacks,
    fallbackRate: fallbacks / denom,
    fallbacksByReason,
    abstains,
    staleCaught,
    safetyViolations,
    errors,
    medianLatencyMs: percentile(latencies, 0.5),
    p90LatencyMs: percentile(latencies, 0.9),
    totalCostUsd,
    costPer1kUsd: (totalCostUsd / denom) * 1_000,
  };
}

export interface ReplayFlip {
  scenarioId: string;
  kind: DecisionKind;
  baselineChoice: string | null;
  baselineEffective: string;
  baselineFallback: boolean;
  baselinePass: boolean;
  candidateChoice: string | null;
  candidateEffective: string;
  candidateFallback: boolean;
  candidatePass: boolean;
}

export interface ReplayComparison {
  baseline: ReplaySummary;
  candidate: ReplaySummary;
  byKind: Partial<
    Record<DecisionKind, { baseline: ReplaySummary; candidate: ReplaySummary }>
  >;
  selectorWinDelta: number;
  effectivePassDelta: number;
  fallbackDelta: number;
  safetyViolationDelta: number;
  medianLatencyDeltaMs: number;
  costDeltaUsd: number;
  improved: string[];
  regressed: string[];
  flips: ReplayFlip[];
  verdict: "approve" | "reject" | "review";
  verdictReason: string;
}

export function compareReplayRuns(
  baselinePolicyId: string,
  baselineScores: readonly ReplayCaseScore[],
  candidatePolicyId: string,
  candidateScores: readonly ReplayCaseScore[],
): ReplayComparison {
  const baseline = summarizeReplayRun(baselinePolicyId, baselineScores);
  const candidate = summarizeReplayRun(candidatePolicyId, candidateScores);
  const byId = new Map(
    candidateScores.map((score) => [score.scenarioId, score]),
  );
  const improved: string[] = [];
  const regressed: string[] = [];
  const flips: ReplayFlip[] = [];

  for (const base of baselineScores) {
    const cand = byId.get(base.scenarioId);
    if (!cand) continue;
    if (!base.effectivePass && cand.effectivePass)
      improved.push(base.scenarioId);
    if (base.effectivePass && !cand.effectivePass)
      regressed.push(base.scenarioId);
    if (
      base.choice !== cand.choice ||
      base.effectiveChoice !== cand.effectiveChoice ||
      base.fallbackApplied !== cand.fallbackApplied ||
      base.effectivePass !== cand.effectivePass
    ) {
      flips.push({
        scenarioId: base.scenarioId,
        kind: base.kind,
        baselineChoice: base.choice,
        baselineEffective: base.effectiveChoice,
        baselineFallback: base.fallbackApplied,
        baselinePass: base.effectivePass,
        candidateChoice: cand.choice,
        candidateEffective: cand.effectiveChoice,
        candidateFallback: cand.fallbackApplied,
        candidatePass: cand.effectivePass,
      });
    }
  }

  const byKind: ReplayComparison["byKind"] = {};
  for (const kind of DECISION_KINDS) {
    const baseKind = baselineScores.filter((score) => score.kind === kind);
    const candKind = candidateScores.filter((score) => score.kind === kind);
    if (baseKind.length || candKind.length) {
      byKind[kind] = {
        baseline: summarizeReplayRun(baselinePolicyId, baseKind),
        candidate: summarizeReplayRun(candidatePolicyId, candKind),
      };
    }
  }

  const selectorWinDelta = candidate.selectorWins - baseline.selectorWins;
  const effectivePassDelta =
    candidate.effectivePasses - baseline.effectivePasses;
  const fallbackDelta = candidate.fallbacks - baseline.fallbacks;
  const safetyViolationDelta =
    candidate.safetyViolations - baseline.safetyViolations;
  const medianLatencyDeltaMs =
    candidate.medianLatencyMs - baseline.medianLatencyMs;
  const costDeltaUsd = candidate.totalCostUsd - baseline.totalCostUsd;

  let verdict: ReplayComparison["verdict"];
  let verdictReason: string;
  if (safetyViolationDelta > 0) {
    verdict = "reject";
    verdictReason = `candidate increased safety violations (+${safetyViolationDelta})`;
  } else if (regressed.length > 0) {
    verdict = "reject";
    verdictReason = `candidate regressed ${regressed.length} scenario(s): ${regressed.join(", ")}`;
  } else if (effectivePassDelta > 0 && selectorWinDelta < 0) {
    verdict = "review";
    verdictReason = `candidate improved effective passes (+${effectivePassDelta}) but selector wins dropped (${selectorWinDelta}); verify fallbacks are not masking selector degradation`;
  } else if (effectivePassDelta > 0 || selectorWinDelta > 0) {
    verdict = "approve";
    verdictReason = `candidate improved effective passes (${effectivePassDelta >= 0 ? "+" : ""}${effectivePassDelta}) and selector wins (${selectorWinDelta >= 0 ? "+" : ""}${selectorWinDelta}) with 0 regressions`;
  } else {
    verdict = "review";
    verdictReason =
      "no regressions, but no net improvement in effective passes or selector wins";
  }

  return {
    baseline,
    candidate,
    byKind,
    selectorWinDelta,
    effectivePassDelta,
    fallbackDelta,
    safetyViolationDelta,
    medianLatencyDeltaMs,
    costDeltaUsd,
    improved,
    regressed,
    flips,
    verdict,
    verdictReason,
  };
}

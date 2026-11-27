import { randomUUID } from "node:crypto";
import {
  applyVersionCapabilities,
  DECISION_OUTCOME_EVENT,
  DECISION_RECEIPT_EVENT,
  type DecisionCandidate,
  type DecisionFallbackReason,
  type DecisionInputSnapshot,
  type DecisionOutcome,
  type DecisionReceipt,
  decisionOutcomeSchema,
  decisionReceiptSchema,
  type ReplayScenario,
  type ReplayScenarioExpect,
  type RuntimeJsonValue,
  redactSokoBotSensitiveText,
  replayScenarioSchema,
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTES,
  type SokoBotCapability,
  type SokoBotRoute,
  type SokoBotVersion,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { SOKO_BOT_HIREABLE_AGENT_WHERE } from "@/lib/soko-bot/agent-search";
import { wellFormed } from "@/lib/soko-bot/well-formed";
import { HOLDOUT_PREFIX } from "@/services/evals/ownerbench/holdout";
import { type ClassificationResult, routeQuestions } from "./classifier";
import { RuntimeEventLog, runtimeEvent } from "./turn-loop";

const MAX_RECEIPT_MESSAGE = 4_000;
const MAX_RECEIPT_PREVIOUS_REPLY = 1_500;
const ROUTE_CRITERIA = routeQuestions(false).route.criteria;
const MAX_EXPORT_CHAIN_DEPTH = 6;
const MAX_EXPORT_CHAIN_TURNS = 500;

function scrubBounded(
  text: string | null | undefined,
  maxLength: number,
): string | undefined {
  if (!text) return undefined;
  const cleaned = redactSokoBotSensitiveText(text)
    .replaceAll("\u0000", "")
    .trim();
  if (!cleaned) return undefined;
  return (
    cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
  ).toWellFormed();
}

/**
 * Live check using the marketplace's canonical eligibility predicate
 * (`SOKO_BOT_HIREABLE_AGENT_WHERE`, including metadata-override endpoints).
 */
export async function hasHireableMarketplaceAgent(): Promise<boolean> {
  const agent = await prisma.agent.findFirst({
    where: SOKO_BOT_HIREABLE_AGENT_WHERE,
    select: { id: true },
  });
  return agent !== null;
}

/**
 * Host-prepared candidate menu for a turn's route decision: captures live
 * version, caller, coworker, and marketplace-agent availability at decision time.
 */
export function routeCandidatesForTurn(options: {
  version: SokoBotVersion;
  askedByBot?: boolean;
  hasHireableAgent?: boolean;
  hasCoworker?: boolean;
}): DecisionCandidate[] {
  const versionCaps = new Set(
    applyVersionCapabilities(options.version, SOKO_BOT_CAPABILITIES),
  );
  const isCmo = options.version.profile === "cmo";
  const isBotToBot = options.askedByBot === true;

  return SOKO_BOT_ROUTES.map((route): DecisionCandidate => {
    const description = ROUTE_CRITERIA[route].slice(0, 2_000);
    if (isBotToBot && route !== "DIRECT_RESPONSE" && route !== "CLARIFY") {
      return {
        id: route,
        description,
        available: false,
        filteredOutReason: "bot-to-bot turn is read-only",
      };
    }
    if (route === "HIRE_AGENT") {
      if (isCmo || !versionCaps.has("hire_agent")) {
        return {
          id: route,
          description,
          available: false,
          filteredOutReason: isCmo
            ? "marketplace hiring disabled for cmo profile"
            : "hire_agent not in version capabilities",
        };
      }
      if (options.hasHireableAgent === false) {
        return {
          id: route,
          description,
          available: false,
          filteredOutReason: "no hireable marketplace agent online",
        };
      }
    }
    if (route === "DELEGATE_TASK") {
      if (isCmo && !versionCaps.has("create_task")) {
        return {
          id: route,
          description,
          available: false,
          filteredOutReason: "coworker delegation disabled for cmo profile",
        };
      }
      if (options.hasCoworker === false && !versionCaps.has("create_task")) {
        return {
          id: route,
          description,
          available: false,
          filteredOutReason: "no coworker available for delegation",
        };
      }
    }
    return { id: route, description, available: true };
  });
}

function routeExecutableAtDispatch(
  route: SokoBotRoute,
  grantedCapabilities: readonly SokoBotCapability[],
  liveHasHireableAgent?: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (route === "DIRECT_RESPONSE" || route === "CLARIFY") return { ok: true };
  if (route === "HIRE_AGENT") {
    if (!grantedCapabilities.includes("hire_agent")) {
      return {
        ok: false,
        reason: 'route "HIRE_AGENT" lacks hire_agent capability at dispatch',
      };
    }
    if (liveHasHireableAgent === false) {
      return {
        ok: false,
        reason:
          'route "HIRE_AGENT" has no hireable marketplace agent online at dispatch',
      };
    }
    return { ok: true };
  }
  if (route === "DELEGATE_TASK") {
    return grantedCapabilities.includes("create_task") ||
      grantedCapabilities.includes("assign_task")
      ? { ok: true }
      : {
          ok: false,
          reason:
            'route "DELEGATE_TASK" lacks task delegation capability at dispatch',
        };
  }
  return grantedCapabilities.length > 0
    ? { ok: true }
    : { ok: false, reason: `route "${route}" has no granted capabilities` };
}

export interface BuildRouteDecisionReceiptInput {
  turnId: string;
  message: string;
  previousReply?: string | null;
  pendingProposals?: readonly string[];
  classification: ClassificationResult;
  version: SokoBotVersion;
  source: string;
  personAsked: boolean;
  cmoOwnerRequest: boolean;
  askedByBot?: boolean;
  /** Pre-classification host availability snapshot captured before calling Jev. */
  candidatesAtClassification?: readonly DecisionCandidate[];
  /** Post-classification live marketplace check right before dispatch. */
  liveHasHireableAgent?: boolean;
  grantedCapabilities: readonly SokoBotCapability[];
  now?: string;
}

/**
 * Builds a bounded, secret-scrubbed route decision receipt from `startTurn`'s
 * actual Jev classification, pre-classification availability snapshot, and
 * post-classification dispatch re-check.
 */
export function buildRouteDecisionReceipt(
  params: BuildRouteDecisionReceiptInput,
): DecisionReceipt {
  const now = params.now ?? new Date().toISOString();
  const candidates = params.candidatesAtClassification
    ? [...params.candidatesAtClassification]
    : routeCandidatesForTurn({
        version: params.version,
        askedByBot: params.askedByBot,
      });
  const hostAvailableIds = new Set(
    candidates.filter((candidate) => candidate.available).map((c) => c.id),
  );
  // Record the EXACT option IDs the classifier actually sent to Jev.
  const offeredCandidateIds = params.classification.rawDecision
    ?.offeredCandidateIds?.length
    ? [...params.classification.rawDecision.offeredCandidateIds]
    : candidates.filter((candidate) => candidate.available).map((c) => c.id);
  const offeredSet = new Set(offeredCandidateIds);

  const raw = params.classification.rawDecision;
  const effectiveRoute = params.classification.classification.route;
  const rawChoice = raw?.rawChoice ?? effectiveRoute;
  const probabilities = raw?.probabilities ?? {
    [effectiveRoute]: params.classification.classification.confidence,
  };
  const confidence =
    rawChoice !== null && Object.hasOwn(probabilities, rawChoice)
      ? (probabilities[rawChoice] ?? null)
      : params.classification.failed
        ? null
        : params.classification.classification.confidence;

  let abstain = raw?.abstained ?? params.classification.failed;
  let abstainReason = raw?.abstainReason;
  let validationStatus: DecisionReceipt["validation"]["status"] = "valid";
  let rejectedChoice: string | undefined;
  let validationReason: string | undefined;
  let fallbackApplied = raw?.fallbackApplied ?? params.classification.failed;
  let fallbackReason: DecisionFallbackReason | undefined = raw?.fallbackReason;
  let fallbackPolicy: string | undefined = fallbackApplied
    ? "read_only_clarify"
    : undefined;

  if (params.classification.failed) {
    abstain = true;
    abstainReason = abstainReason ?? "Classifier unavailable; reads only.";
    validationStatus = "error";
    validationReason = abstainReason;
    fallbackApplied = true;
    fallbackReason = "selector_error";
    fallbackPolicy = "read_only_clarify";
  } else if (fallbackApplied) {
    validationStatus =
      fallbackReason === "invalid_choice" ? "invalid" : "abstained";
    rejectedChoice = rawChoice ?? undefined;
    validationReason = abstainReason;
  } else if (rawChoice !== null && !offeredSet.has(rawChoice)) {
    validationStatus = "invalid";
    rejectedChoice = rawChoice;
    validationReason = `route "${rawChoice}" not in offered candidates sent to selector`;
    fallbackApplied = true;
    fallbackReason = "invalid_choice";
    fallbackPolicy = "host_capability_gate";
  } else if (rawChoice !== null && !hostAvailableIds.has(rawChoice)) {
    // Unfiltered classifier returned an option unavailable on this host/workspace.
    validationStatus = "invalid";
    rejectedChoice = rawChoice;
    validationReason = `route "${rawChoice}" unavailable in host candidate menu`;
    fallbackApplied = true;
    fallbackReason = "invalid_choice";
    fallbackPolicy = "host_capability_gate";
  } else {
    const dispatchCheck = routeExecutableAtDispatch(
      effectiveRoute,
      params.grantedCapabilities,
      params.liveHasHireableAgent,
    );
    if (!dispatchCheck.ok) {
      validationStatus = "stale";
      rejectedChoice = effectiveRoute;
      validationReason = dispatchCheck.reason;
      fallbackApplied = true;
      fallbackReason = "stale_option";
      fallbackPolicy = "host_capability_gate";
    }
  }

  const input: DecisionInputSnapshot = {
    ...(scrubBounded(params.message, MAX_RECEIPT_MESSAGE)
      ? { message: scrubBounded(params.message, MAX_RECEIPT_MESSAGE) }
      : {}),
    ...(params.previousReply !== undefined
      ? {
          previousReply:
            scrubBounded(params.previousReply, MAX_RECEIPT_PREVIOUS_REPLY) ??
            null,
        }
      : {}),
    ...(params.pendingProposals?.length
      ? {
          pendingProposals: params.pendingProposals
            .slice(0, 12)
            .map((proposal) => scrubBounded(proposal, 500) ?? "")
            .filter(Boolean),
        }
      : {}),
    profile: params.version.profile === "cmo" ? "cmo" : "soko-bot",
    turnSource: params.source,
    personAsked: params.personAsked,
  };

  return decisionReceiptSchema.parse(
    wellFormed({
      schemaVersion: 1,
      receiptId: `rcpt_${randomUUID()}`,
      kind: "route",
      turnId: params.turnId,
      policyVersion: params.classification.version,
      model: params.classification.model,
      recordedAt: now,
      candidates,
      offeredCandidateIds,
      choice: params.classification.failed ? null : rawChoice,
      confidence,
      probabilities,
      aux: {
        ...(params.classification.classification.writeScope
          ? { writeScope: params.classification.classification.writeScope }
          : {}),
        ...(raw?.writeScopeChoice
          ? { rawWriteScope: raw.writeScopeChoice }
          : {}),
        ...(params.classification.classification.complexity
          ? {
              complexity: params.classification.classification.complexity.label,
            }
          : {}),
        ...(params.classification.classification.signals
          ? { signals: params.classification.classification.signals }
          : {}),
        ...(params.classification.classification.selectedIntentId
          ? {
              selectedIntentId:
                params.classification.classification.selectedIntentId,
            }
          : {}),
        ...(params.classification.classification.continuation
          ? { continuation: params.classification.classification.continuation }
          : {}),
        personAsked: params.personAsked,
        cmoOwnerRequest: params.cmoOwnerRequest,
        grantedCapabilityCount: params.grantedCapabilities.length,
      },
      abstain,
      ...(abstainReason ? { abstainReason } : {}),
      validation: {
        status: validationStatus,
        ...(rejectedChoice ? { rejectedChoice } : {}),
        ...(validationReason ? { reason: validationReason } : {}),
        checkedAt: now,
      },
      fallback: {
        applied: fallbackApplied,
        ...(fallbackReason ? { reason: fallbackReason } : {}),
        effectiveChoice: effectiveRoute,
        ...(fallbackPolicy ? { policy: fallbackPolicy } : {}),
      },
      latencyMs: params.classification.latencyMs,
      costUsd: params.classification.usage?.costUsd ?? 0,
      input,
    }),
  );
}

function toRuntimeJsonRecord(value: unknown): Record<string, RuntimeJsonValue> {
  const cloned: unknown = JSON.parse(JSON.stringify(value));
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new Error("Decision receipt payload must serialize to a JSON object");
  }
  return cloned as Record<string, RuntimeJsonValue>;
}

/**
 * Persists a validated decision receipt (`route`, `focus`, or `completion`) to
 * `SokoBotRuntimeEvent`. Shared recording seam for E1, E2, E3, and E4.
 */
export async function recordDecisionReceipt(
  log: RuntimeEventLog,
  receipt: DecisionReceipt,
): Promise<void> {
  const validated = decisionReceiptSchema.parse(wellFormed(receipt));
  await log.append(
    runtimeEvent(DECISION_RECEIPT_EVENT, toRuntimeJsonRecord(validated)),
  );
}

/** Records a decision receipt once per `receiptId` so retries never duplicate it. */
export async function recordDecisionReceiptOnce(
  log: RuntimeEventLog,
  receipt: DecisionReceipt,
): Promise<boolean> {
  const validated = decisionReceiptSchema.parse(wellFormed(receipt));
  return log.appendUnless(
    runtimeEvent(DECISION_RECEIPT_EVENT, toRuntimeJsonRecord(validated)),
    [],
    async (tx) => {
      const existing = await tx.sokoBotRuntimeEvent.findFirst({
        where: {
          turnId: log.turnId,
          type: DECISION_RECEIPT_EVENT,
          data: { path: ["receiptId"], equals: validated.receiptId },
        },
        select: { id: true },
      });
      return existing === null;
    },
  );
}

/** Extracts a stored route receipt from `SokoBotTurn.classification`, if valid. */
export function storedRouteDecisionReceipt(
  classification: unknown,
): DecisionReceipt | null {
  if (!classification || typeof classification !== "object") return null;
  const raw = (classification as { decisionReceipt?: unknown }).decisionReceipt;
  if (!raw) return null;
  const parsed = decisionReceiptSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Core-internal helper called by `prepareTurn` to persist a turn's stored route
 * receipt onto `SokoBotRuntimeEvent`. Kept out of `getContext` so
 * `refresh_context` never leaks hidden route metadata back to the model.
 */
export async function emitStoredRouteDecisionReceipt(
  turnId: string,
  sessionId: string,
): Promise<boolean> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { classification: true },
  });
  const receipt = storedRouteDecisionReceipt(turn?.classification);
  if (!receipt) return false;
  return recordDecisionReceiptOnce(new RuntimeEventLog(turnId, sessionId), {
    ...receipt,
    turnId,
  });
}

/** Records the settled turn outcome once on `SokoBotRuntimeEvent`. */
export async function recordDecisionOutcome(
  log: RuntimeEventLog,
  outcome: DecisionOutcome,
): Promise<boolean> {
  const validated = decisionOutcomeSchema.parse(outcome);
  return log.appendUnless(
    runtimeEvent(DECISION_OUTCOME_EVENT, toRuntimeJsonRecord(validated)),
    [DECISION_OUTCOME_EVENT],
  );
}

/**
 * Converts a stored `DecisionReceipt` (plus optional settled outcome) into a
 * replayable `ReplayScenario`. Historical choices are recorded strictly as
 * `observedOutcome`; `expect` is omitted unless an independently reviewed or
 * verified label is explicitly passed in, so a failed decision never grades
 * itself correct.
 */
export function receiptToReplayScenario(
  receipt: DecisionReceipt,
  outcome?: DecisionOutcome | null,
  options?: {
    source?: string;
    expect?: ReplayScenarioExpect;
  },
): ReplayScenario {
  const tags: string[] = [receipt.kind];
  if (receipt.input.profile) tags.push(receipt.input.profile);
  if (receipt.fallback.applied) tags.push("fallback");
  if (outcome?.routeDisagreed) tags.push("route-disagreed");
  return replayScenarioSchema.parse({
    id: `receipt:${receipt.kind}:${receipt.receiptId}`,
    kind: receipt.kind,
    source: options?.source ?? "receipt-export",
    tags,
    candidates: receipt.candidates,
    input: receipt.input,
    ...(options?.expect ? { expect: options.expect } : {}),
    observedOutcome: {
      originalChoice: receipt.choice,
      originalEffectiveChoice: receipt.fallback.effectiveChoice,
      originalFallbackApplied: receipt.fallback.applied,
      originalFailed: receipt.validation.status === "error",
      ...(outcome ? { turnStatus: outcome.turnStatus } : {}),
      ...(outcome?.writes.length ? { writes: [...outcome.writes] } : {}),
    },
  });
}

function extractStateTurnIds(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const steps = (state as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  const ids: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const turnIds = (step as { turnIds?: unknown }).turnIds;
    if (!Array.isArray(turnIds)) continue;
    for (const id of turnIds) {
      if (typeof id === "string" && id) ids.push(id);
    }
  }
  return ids;
}

/** Walks every turn in the request chains rooted at `seedTurnIds`. */
async function expandEvalTurnChains(
  seedTurnIds: readonly string[],
): Promise<Set<string>> {
  const found = new Set(seedTurnIds);
  let frontier = [...found];
  for (
    let depth = 0;
    depth < MAX_EXPORT_CHAIN_DEPTH &&
    frontier.length > 0 &&
    found.size < MAX_EXPORT_CHAIN_TURNS;
    depth++
  ) {
    const [children, handedOver, watched] = await Promise.all([
      prisma.sokoBotTurn.findMany({
        where: { parentTurnId: { in: frontier } },
        select: { id: true },
        take: MAX_EXPORT_CHAIN_TURNS,
      }),
      prisma.sokoBotDelegation.findMany({
        where: { turnId: { in: frontier }, followUpTurnId: { not: null } },
        select: { followUpTurnId: true },
        take: MAX_EXPORT_CHAIN_TURNS,
      }),
      prisma.sokoBotWatch.findMany({
        where: { turnId: { in: frontier }, firedTurnId: { not: null } },
        select: { firedTurnId: true },
        take: MAX_EXPORT_CHAIN_TURNS,
      }),
    ]);
    const next = [
      ...children.map((row) => row.id),
      ...handedOver.map((row) => row.followUpTurnId),
      ...watched.map((row) => row.firedTurnId),
    ].filter((id): id is string => id !== null && !found.has(id));
    for (const id of next) {
      if (found.size >= MAX_EXPORT_CHAIN_TURNS) break;
      found.add(id);
    }
    frontier = [...new Set(next)];
  }
  return found;
}

/**
 * Exports persisted `decision.receipt` runtime events strictly from approved
 * non-holdout dev `EvalRun` / `EvalResult` turn chains. Ordinary non-benchmark
 * turns and held-out benchmark runs (including all descendants) are never
 * exported.
 */
export async function exportDecisionReceiptsFromDb(options?: {
  evalRunId?: string;
  kind?: DecisionReceipt["kind"];
  sokoBotId?: string;
  turnId?: string;
  limit?: number;
}): Promise<ReplayScenario[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 1_000);
  const [devResults, holdoutResults] = await Promise.all([
    prisma.evalResult.findMany({
      where: {
        ...(options?.evalRunId ? { runId: options.evalRunId } : {}),
        NOT: [
          { caseId: { startsWith: HOLDOUT_PREFIX } },
          { caseId: { contains: "holdout", mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 250,
      select: {
        id: true,
        runId: true,
        caseId: true,
        turnId: true,
        state: true,
      },
    }),
    prisma.evalResult.findMany({
      where: {
        OR: [
          { caseId: { startsWith: HOLDOUT_PREFIX } },
          { caseId: { contains: "holdout", mode: "insensitive" } },
        ],
      },
      select: { id: true, turnId: true, state: true },
    }),
  ]);

  const provenanceByTurnId = new Map<string, string>();
  const devSeedTurnIds: string[] = [];
  for (const row of devResults) {
    const provenance = `dev-eval:${row.runId}:${row.caseId}`;
    const seeds = [
      ...(row.turnId ? [row.turnId] : []),
      ...extractStateTurnIds(row.state),
    ];
    for (const id of seeds) {
      devSeedTurnIds.push(id);
      if (!provenanceByTurnId.has(id)) provenanceByTurnId.set(id, provenance);
    }
  }
  if (devSeedTurnIds.length === 0) return [];

  const holdoutSeedTurnIds: string[] = [];
  const holdoutResultPrefixes: string[] = [];
  for (const row of holdoutResults) {
    holdoutResultPrefixes.push(`lab:eval:${row.id}:`);
    if (row.turnId) holdoutSeedTurnIds.push(row.turnId);
    holdoutSeedTurnIds.push(...extractStateTurnIds(row.state));
  }

  const [devChainTurnIds, holdoutChainTurnIds] = await Promise.all([
    expandEvalTurnChains(devSeedTurnIds),
    holdoutSeedTurnIds.length > 0
      ? expandEvalTurnChains(holdoutSeedTurnIds)
      : Promise.resolve(new Set<string>()),
  ]);

  // Require positive membership in an approved dev run chain, minus any holdout chain.
  const approvedTurnIds = [...devChainTurnIds].filter(
    (id) =>
      !holdoutChainTurnIds.has(id) &&
      (!options?.turnId || id === options.turnId),
  );
  if (approvedTurnIds.length === 0) return [];

  const events = await prisma.sokoBotRuntimeEvent.findMany({
    where: {
      type: DECISION_RECEIPT_EVENT,
      turnId: { in: approvedTurnIds },
      turn: {
        ...(options?.sokoBotId ? { sokoBotId: options.sokoBotId } : {}),
        NOT: { clientTurnId: { contains: "holdout" } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      turnId: true,
      data: true,
      turn: { select: { clientTurnId: true } },
    },
  });

  const allowedEvents = events.filter(
    (event) =>
      !holdoutResultPrefixes.some((prefix) =>
        event.turn.clientTurnId.startsWith(prefix),
      ),
  );
  if (allowedEvents.length === 0) return [];

  const turnIds = [...new Set(allowedEvents.map((event) => event.turnId))];
  const outcomeEvents = await prisma.sokoBotRuntimeEvent.findMany({
    where: { turnId: { in: turnIds }, type: DECISION_OUTCOME_EVENT },
    select: { turnId: true, data: true },
  });
  const outcomeByTurn = new Map<string, DecisionOutcome>();
  for (const row of outcomeEvents) {
    const parsed = decisionOutcomeSchema.safeParse(row.data);
    if (parsed.success) outcomeByTurn.set(row.turnId, parsed.data);
  }

  const scenarios: ReplayScenario[] = [];
  for (const row of allowedEvents) {
    const parsed = decisionReceiptSchema.safeParse(row.data);
    if (!parsed.success) continue;
    if (options?.kind && parsed.data.kind !== options.kind) continue;
    scenarios.push(
      receiptToReplayScenario(
        parsed.data,
        outcomeByTurn.get(row.turnId) ?? null,
        {
          source: provenanceByTurnId.get(row.turnId) ?? "dev-eval",
        },
      ),
    );
  }
  return scenarios;
}

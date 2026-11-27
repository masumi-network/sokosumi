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
import { wellFormed } from "@/lib/soko-bot/well-formed";
import { HOLDOUT_PREFIX } from "@/services/evals/ownerbench/holdout";
import { type ClassificationResult, routeQuestions } from "./classifier";
import { type RuntimeEventLog, runtimeEvent } from "./turn-loop";

const MAX_RECEIPT_MESSAGE = 4_000;
const MAX_RECEIPT_PREVIOUS_REPLY = 1_500;
const ROUTE_CRITERIA = routeQuestions(false).route.criteria;

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
 * Host-prepared candidate menu for a turn's route decision: marks routes that
 * the version or turn caller cannot execute as unavailable before asking Jev.
 */
export function routeCandidatesForTurn(options: {
  version: SokoBotVersion;
  askedByBot?: boolean;
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
    if (route === "HIRE_AGENT" && (isCmo || !versionCaps.has("hire_agent"))) {
      return {
        id: route,
        description,
        available: false,
        filteredOutReason: isCmo
          ? "marketplace hiring disabled for cmo profile"
          : "hire_agent not in version capabilities",
      };
    }
    if (route === "DELEGATE_TASK" && isCmo && !versionCaps.has("create_task")) {
      return {
        id: route,
        description,
        available: false,
        filteredOutReason: "coworker delegation disabled for cmo profile",
      };
    }
    return { id: route, description, available: true };
  });
}

function routeExecutableAtDispatch(
  route: SokoBotRoute,
  grantedCapabilities: readonly SokoBotCapability[],
): boolean {
  if (route === "DIRECT_RESPONSE" || route === "CLARIFY") return true;
  if (route === "HIRE_AGENT") return grantedCapabilities.includes("hire_agent");
  if (route === "DELEGATE_TASK")
    return (
      grantedCapabilities.includes("create_task") ||
      grantedCapabilities.includes("assign_task")
    );
  return grantedCapabilities.length > 0;
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
  grantedCapabilities: readonly SokoBotCapability[];
  now?: string;
}

/**
 * Builds a bounded, secret-scrubbed route decision receipt from `startTurn`'s
 * Jev classification and host capability checks.
 */
export function buildRouteDecisionReceipt(
  params: BuildRouteDecisionReceiptInput,
): DecisionReceipt {
  const now = params.now ?? new Date().toISOString();
  const candidates = routeCandidatesForTurn({
    version: params.version,
    askedByBot: params.askedByBot,
  });
  const offeredCandidateIds = candidates
    .filter((candidate) => candidate.available)
    .map((candidate) => candidate.id);
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
    // Jev picked a route outside the host-offered menu for this turn profile.
    validationStatus = "invalid";
    rejectedChoice = rawChoice;
    validationReason = `route "${rawChoice}" not in offered candidates for this turn profile`;
    fallbackApplied = true;
    fallbackReason = "invalid_choice";
    fallbackPolicy = "host_capability_gate";
  } else if (
    !routeExecutableAtDispatch(effectiveRoute, params.grantedCapabilities)
  ) {
    validationStatus = "stale";
    rejectedChoice = effectiveRoute;
    validationReason = `route "${effectiveRoute}" lacks required capabilities at dispatch`;
    fallbackApplied = true;
    fallbackReason = "stale_option";
    fallbackPolicy = "host_capability_gate";
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
 * replayable `ReplayScenario` JSONL record.
 */
export function receiptToReplayScenario(
  receipt: DecisionReceipt,
  outcome?: DecisionOutcome | null,
): ReplayScenario {
  const tags: string[] = [receipt.kind];
  if (receipt.input.profile) tags.push(receipt.input.profile);
  if (receipt.fallback.applied) tags.push("fallback");
  if (outcome?.routeDisagreed) tags.push("route-disagreed");
  return replayScenarioSchema.parse({
    id: `receipt:${receipt.kind}:${receipt.receiptId}`,
    kind: receipt.kind,
    source: "receipt-export",
    tags,
    candidates: receipt.candidates,
    input: receipt.input,
    expect: {
      acceptedChoices: [receipt.fallback.effectiveChoice],
      ...(receipt.fallback.applied ? { expectFallback: true } : {}),
    },
    observedOutcome: {
      originalChoice: receipt.choice,
      originalEffectiveChoice: receipt.fallback.effectiveChoice,
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

/**
 * Exports persisted `decision.receipt` runtime events from Postgres into
 * replayable scenarios, strictly excluding held-out benchmark turns.
 */
export async function exportDecisionReceiptsFromDb(options?: {
  kind?: DecisionReceipt["kind"];
  sokoBotId?: string;
  turnId?: string;
  limit?: number;
}): Promise<ReplayScenario[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 1_000);
  const holdoutResults = await prisma.evalResult.findMany({
    where: { caseId: { startsWith: HOLDOUT_PREFIX } },
    select: { id: true, turnId: true, state: true },
  });
  const holdoutTurnIds = new Set<string>();
  const holdoutResultPrefixes: string[] = [];
  for (const row of holdoutResults) {
    holdoutResultPrefixes.push(`lab:eval:${row.id}:`);
    if (row.turnId) holdoutTurnIds.add(row.turnId);
    for (const id of extractStateTurnIds(row.state)) holdoutTurnIds.add(id);
  }

  const events = await prisma.sokoBotRuntimeEvent.findMany({
    where: {
      type: DECISION_RECEIPT_EVENT,
      ...(options?.turnId ? { turnId: options.turnId } : {}),
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
      turn: { select: { clientTurnId: true, parentTurnId: true } },
    },
  });

  const allowedEvents = events.filter((event) => {
    if (holdoutTurnIds.has(event.turnId)) return false;
    if (event.turn.parentTurnId && holdoutTurnIds.has(event.turn.parentTurnId))
      return false;
    return !holdoutResultPrefixes.some((prefix) =>
      event.turn.clientTurnId.startsWith(prefix),
    );
  });

  const turnIds = [...new Set(allowedEvents.map((event) => event.turnId))];
  const outcomeEvents = turnIds.length
    ? await prisma.sokoBotRuntimeEvent.findMany({
        where: { turnId: { in: turnIds }, type: DECISION_OUTCOME_EVENT },
        select: { turnId: true, data: true },
      })
    : [];
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
      ),
    );
  }
  return scenarios;
}

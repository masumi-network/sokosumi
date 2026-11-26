import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type SokoBot,
  type SokoBotTurn,
  SokoBotTurnStatus,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  applyVersionCapabilities,
  CMO_PRODUCTION_TURN_PREFIX,
  capabilitiesForClassification,
  composeSokoBotVersionNotice,
  createEmptySokoBotMemory,
  getSokoBotVersion,
  type IndexedRuntimeEvent,
  isSokoBotAnnouncementCapability,
  isSokoBotCapability,
  isSokoBotCompetitorCapability,
  isSokoBotNewsletterCapability,
  limitSokoBotWrites,
  redactSokoBotSensitiveText,
  renderSokoBotMemory,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_SANDBOX_CAPABILITIES,
  type SokoBotCapability,
  type SokoBotRuntime,
  sanitizeSokoBotMemoryMarkdown,
  sokoBotContextPacketSchema,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/config/env";
import { notifyLowBalanceAfterCharge } from "@/helpers/billing-notifications";
import {
  chatResultDescriptors,
  readPreparedResultSnapshots,
} from "@/helpers/chat-result-metadata";
import {
  failOpenChatRoomMentions,
  publishChatRoomMentionStatuses,
} from "@/helpers/chat-room-mention-status";
import { notifyCusoLowCreditsAfterCharge } from "@/helpers/cuso-low-credit-notification";
import {
  forfeitCusoProjectCredits,
  forfeitCusoProjectCreditsIfLeavingCmo,
} from "@/helpers/cuso-project-credits";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { jsonInput } from "@/helpers/prisma-json";
import { cancelUnpublishedSocialPosts } from "@/helpers/social-post-quote";
import { isPersonalSokoBot, isSharedSokoBot } from "@/helpers/soko-bot-kind";
import {
  assertSokoBotManagement,
  authorizeSokoBotTurnAction,
  memberAnswerableIntentWhere,
} from "@/helpers/soko-bot-management";
import {
  needsProactiveDestination,
  turnDestinationRoom,
} from "@/helpers/soko-bot-notice-room";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type ResolvedSokoBotRow,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import { sokoBotForTurnMember } from "@/helpers/soko-bot-turn-authority";
import {
  sokoBotSharedScopeOf,
  sokoBotTurnReader,
} from "@/helpers/task-visibility";
import {
  AI_BUDGET_EXCEEDED,
  AI_BUDGET_EXCEEDED_MESSAGE,
} from "@/lib/ai-gateway-budget";
import {
  aiGatewayBudgetScope,
  GATEWAY_INTERNAL_SERVER_ERROR,
} from "@/lib/ai-gateway-budget-error";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { evalWorkspaceIds } from "@/lib/evals/eval-guard";
import {
  createCoreLogger,
  emitCoreWarning,
  recordCoreError,
  recordCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  sokoBotActingUserId,
  sokoBotScheduleActingUserId,
  sokoBotScheduleActingUserWhere,
} from "@/lib/soko-bot/acting-user";
import {
  ACTION_CAPABILITIES,
  actionInputHash,
} from "@/lib/soko-bot/action-receipts";
import { buildActionResponse } from "@/lib/soko-bot/action-response";
import {
  adminActionOperationId,
  adminActionSnapshot,
  adminRetryOperationKey,
  redactAdminPresentation,
} from "@/lib/soko-bot/admin-action-record";
import { loadClassificationContext } from "@/lib/soko-bot/classification-context";
import {
  type ClassificationResult,
  JevTurnClassifier,
  presetClassificationResult,
  storedWriteScope,
  type TurnClassifier,
} from "@/lib/soko-bot/classifier";
import { ContextPacketBuilder } from "@/lib/soko-bot/context-packet";
import {
  assertEvaluationActor,
  evaluationBinding,
  evaluationEvidence,
  withEvaluationActor,
} from "@/lib/soko-bot/evaluation-dispatch";
import { safeEventText, safeReasoningSummary } from "@/lib/soko-bot/event-text";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { recordModelCall, withModelCallTurn } from "@/lib/soko-bot/model-calls";
import {
  capturePreference,
  MIN_PREFERENCE_CONFIDENCE,
} from "@/lib/soko-bot/preference-capture";
import {
  reportSokoBotReconciliationLeaseLoss,
  SokoBotReconciliationLeaseLostError,
} from "@/lib/soko-bot/reconciliation-lease";
import { logSokoBotRouteOutcome } from "@/lib/soko-bot/route-outcome";
import { isRetryableSokoBotRuntimeError } from "@/lib/soko-bot/runtime-errors";
import {
  matchSokoBotRuntimeTurnBoundary,
  SETTLEMENT_TRIGGER_EVENT_TYPES,
  shouldPersistSokoBotRuntimeEvent,
} from "@/lib/soko-bot/runtime-stream";
import { IN_PROCESS_RUNTIME_VERSION } from "@/lib/soko-bot/runtime-version";
import {
  matchesReservedTurnMessage,
  PERSON_SCHEDULE_CAPABILITIES,
  withOwnScheduleTools,
} from "@/lib/soko-bot/system-routes";
import { chooseTurnModel } from "@/lib/soko-bot/turn-model";
import type {
  SokoBotTurnStartResult,
  StartSokoBotTurnInput,
} from "@/lib/soko-bot/turn-start";
import {
  LIVE_CUSO_WHERE,
  ONBOARDING_TURN_PREFIX,
} from "@/services/cmo-cuso.service";
import { competitorChecksOnFor } from "@/services/competitors.service";
import { STRATEGY_TURN_PREFIX } from "@/services/marketing-strategy.service";
import { isNewsletterDraftAvailable } from "@/services/newsletter-draft.service";
import {
  revokeCusoSubscription,
  revokeCusoSubscriptionIfLeavingCmo,
  revokeSubscriptionsLeftByEnding,
} from "@/services/polar-subscription-end.service";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
import { giveNewSokoBotAvatar } from "@/services/soko-bot-avatar-code.service";
import {
  notifySokoBotOutOfCredits,
  recordSokoBotTurnUsage,
  requireSokoBotTurnFunding,
  SokoBotBillingAccessError,
  sokoBotIdsOutOfCredits,
} from "@/services/soko-bot-billing.service";
import {
  assessSokoBotIntentOutcome,
  invalidateSokoBotIntentOutcomes,
  sokoBotOutcomeSummary,
} from "@/services/soko-bot-outcome.service";
import { isAnnouncementBot } from "@/services/soko-bot-runtime/dispatch-announcements";
import {
  type CreateSokoBotScheduleInput,
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  isPlatformTurnFailure,
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
  type UpdateSokoBotScheduleInput,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  getDefaultSokoBotVersionId,
  isRunnableSokoBotVersionId,
  isSelectableSokoBotVersionId,
  resolveRunnableSokoBotVersion,
  resolveSokoBotVersion,
} from "@/services/soko-bot-version.service";
import { prepareTurnActionResultPreviews } from "@/services/turn-action-result-previews.service";
import { enqueueSokoBotDelivery } from "./soko-bot-delivery.service";

/** Context for the control plane's standalone events. */
const TURN_LOG = { operation: "soko_bot_turn" };

const TURN_DEADLINE_MS = 15 * 60 * 1_000;
/**
 * A person can ask for work that takes a while — three years of mail into a
 * CRM table. The turn still ends the moment the bot answers.
 */
const PERSON_TURN_DEADLINE_MS = 60 * 60 * 1_000;
/** A background run works beside the chat, so it may take far longer. */
const BACKGROUND_RUN_DEADLINE_MS = 6 * 60 * 60 * 1_000;
/** Runs share the owner's credits and accounts; a handful is plenty. */
export const MAX_ACTIVE_BACKGROUND_RUNS = 3;
/** The bot's chat: every turn except background runs. */
export const FOREGROUND_TURN = { parentTurnId: null } as const;
export const TURN_LEASE_MS = 16 * 60 * 1_000;
const RECONCILER_HEARTBEAT_MS = 15_000;
/** A heartbeat this old means its writer is dead. */
export const SOKO_BOT_TURN_STALE_HEARTBEAT_MS = 45_000;

/** How far back a bare "yes" can reach for the reply it answers. */
const PREVIOUS_REPLY_WINDOW_MS = 12 * 60 * 60 * 1_000;

export const ACTIVE_TURN_STATUSES = [
  SokoBotTurnStatus.QUEUED,
  SokoBotTurnStatus.STARTING,
  SokoBotTurnStatus.RUNNING,
  SokoBotTurnStatus.CANCEL_REQUESTED,
] as const;

export class SokoBotNotFoundError extends Error {}
export class SokoBotBusyError extends Error {}
/** Busy only until the running turn settles; worth waiting for, unlike a pause. */
export class SokoBotTurnInProgressError extends SokoBotBusyError {}
export class SokoBotNoDestinationError extends Error {}
export class SokoBotValidationError extends Error {}
/** The administrator switched the whole feature off. */
export class SokoBotDisabledError extends Error {}

async function translateScheduleErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SokoBotScheduleNotFoundError) {
      throw new SokoBotNotFoundError(error.message);
    }
    if (error instanceof SokoBotScheduleValidationError) {
      throw new SokoBotValidationError(error.message);
    }
    throw error;
  }
}
export class SokoBotIdempotencyConflictError extends Error {}
export class SokoBotRetryableStartError extends Error {}
export class SokoBotStartAbortedError extends Error {}

function observedStartResult(
  turn: SokoBotTurn,
  fallbackSessionId: string | null,
  duplicate = true,
): SokoBotTurnStartResult {
  if (
    duplicate &&
    ACTIVE_TURN_STATUSES.some((status) => status === turn.status)
  ) {
    createCoreLogger({
      operation: "soko_bot_turn_start",
      turn: { id: turn.id },
      outcome: "observed_duplicate",
    }).emit();
  }
  return {
    turnId: turn.id,
    sokoBotId: turn.sokoBotId,
    sessionId: turn.eveSessionId ?? fallbackSessionId ?? "",
    status: turn.status,
    route: turn.route ?? "CLARIFY",
    capabilities: turn.capabilityNames as SokoBotCapability[],
    duplicate,
    errorKind: turn.errorKind,
  };
}

function contextMemoryVersion(packet: Prisma.JsonValue): number {
  const parsed = sokoBotContextPacketSchema.safeParse(packet);
  if (!parsed.success) {
    throw new SokoBotRetryableStartError(
      "Soko Bot context snapshot has invalid memory metadata",
    );
  }
  return parsed.data.memory.version;
}

function requireContextMemoryRevision(
  memoryVersion: number,
  memoryRevision: { id: string; version: number } | null,
): { id: string; version: number } | null {
  if (memoryVersion > 0 && !memoryRevision) {
    throw new SokoBotRetryableStartError(
      "Soko Bot context memory revision is unavailable",
    );
  }
  return memoryRevision;
}

export interface CreateSokoBotInput {
  userId: string;
  workspaceId: string;
  name: string;
  avatarSeed?: string | null;
  avatarCode?: string | null;
  personalityTone?: number | null;
  personalityDetail?: number | null;
  personalityStyle?: number | null;
  /** IANA timezone for a new bot's day; an existing bot keeps its own. */
  timezone?: string;
}

/**
 * How many failed bots a fleet migration names. The count is exact; the list
 * is a sample, because the response schema bounds it and a migration must not
 * throw on its own output after it has already moved bots.
 */
const MIGRATION_FAILURE_SAMPLE = 100;

export type SokoBotAdminActionName =
  | "PAUSE"
  | "RESUME"
  | "RESET_SESSION"
  | "RESET_MEMORY"
  | "RETRY_LAST_FAILED"
  | "RETRY_SCHEDULE_RUN"
  | "DISABLE_SCHEDULE"
  | "SET_VERSION";

interface AdminActionIntentInput {
  sokoBotId: string;
  userId: string;
  operatorId: string;
  action: string;
  targetId?: string | null;
  reason: string;
}

function normalizeAdminActionIdentifier(
  value: string | undefined,
  name: string,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 200) {
    throw new SokoBotValidationError(`${name} must not exceed 200 characters`);
  }
  return normalized;
}

function isAmbiguousRuntimeAcceptance(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  return isRetryableSokoBotRuntimeError(error);
}

function assertMatchingAdminActionIntent(
  existing: AdminActionIntentInput,
  input: AdminActionIntentInput,
): void {
  if (
    existing.sokoBotId !== input.sokoBotId ||
    existing.userId !== input.userId ||
    existing.operatorId !== input.operatorId ||
    existing.action !== input.action ||
    (existing.targetId ?? null) !== (input.targetId ?? null) ||
    existing.reason !== input.reason
  ) {
    throw new SokoBotValidationError(
      "Admin action request identifier was already used for different input",
    );
  }
}

function safeAdminActionFailure(error: unknown): {
  errorKind: string;
  errorDetail: string | null;
} {
  if (error instanceof SokoBotNotFoundError) {
    return { errorKind: "not_found", errorDetail: error.message };
  }
  if (error instanceof SokoBotValidationError) {
    return { errorKind: "validation", errorDetail: error.message };
  }
  if (error instanceof SokoBotBusyError) {
    return { errorKind: "busy", errorDetail: error.message };
  }
  return { errorKind: "action_failed", errorDetail: null };
}

type TerminalSokoBotTurnStatus = "COMPLETED" | "CANCELLED" | "FAILED";

export function memoryHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

export function safeMemoryRevision<
  T extends { hash: string; markdown: string },
>(revision: T): T {
  const markdown = sanitizeSokoBotMemoryMarkdown(revision.markdown);
  return { ...revision, markdown, hash: memoryHash(markdown) };
}

function safeRuntimeDiagnostic(value: string, maxLength?: number): string;
function safeRuntimeDiagnostic(
  value: string | null | undefined,
  maxLength?: number,
): string | undefined;
function safeRuntimeDiagnostic(
  value: string | null | undefined,
  maxLength = 1_000,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return redactSokoBotSensitiveText(value).slice(0, maxLength);
}

function runtimeFailureCode(data: Record<string, unknown>) {
  if (
    GATEWAY_INTERNAL_SERVER_ERROR === data.code &&
    aiGatewayBudgetScope(data.message)
  ) {
    return AI_BUDGET_EXCEEDED;
  }
  return typeof data.code === "string"
    ? safeRuntimeDiagnostic(data.code, 120)
    : undefined;
}

interface SokoBotUsageBySource {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface SokoBotTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /**
   * The same spend split by where it went: each model id, "web_search",
   * "exa/search". Kept on the turn because step events are pruned later.
   */
  bySource?: Record<string, SokoBotUsageBySource>;
}

function nonnegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function parseTurnUsage(value: unknown): SokoBotTurnUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };
  }
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: nonnegativeNumber(usage.inputTokens),
    outputTokens: nonnegativeNumber(usage.outputTokens),
    cacheReadTokens: nonnegativeNumber(usage.cacheReadTokens),
    cacheWriteTokens: nonnegativeNumber(usage.cacheWriteTokens),
    costUsd: nonnegativeNumber(usage.costUsd),
    ...(usage.bySource &&
    typeof usage.bySource === "object" &&
    !Array.isArray(usage.bySource)
      ? { bySource: usage.bySource as Record<string, SokoBotUsageBySource> }
      : {}),
  };
}

/** The turn spent model tokens, whatever cost the provider reported. */
function turnRanModel(value: unknown): boolean {
  const usage = parseTurnUsage(value);
  return usage.inputTokens + usage.outputTokens > 0;
}

function addTurnUsage(
  current: SokoBotTurnUsage,
  value: unknown,
  source: unknown,
): SokoBotTurnUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const increment = parseTurnUsage(value);
  const key =
    typeof source === "string" && source ? source.slice(0, 120) : "unknown";
  const before = current.bySource?.[key];
  return {
    bySource: {
      ...current.bySource,
      [key]: {
        costUsd: nonnegativeNumber(before?.costUsd) + increment.costUsd,
        calls: nonnegativeNumber(before?.calls) + 1,
        inputTokens:
          nonnegativeNumber(before?.inputTokens) + increment.inputTokens,
        outputTokens:
          nonnegativeNumber(before?.outputTokens) + increment.outputTokens,
      },
    },
    inputTokens: current.inputTokens + increment.inputTokens,
    outputTokens: current.outputTokens + increment.outputTokens,
    cacheReadTokens: current.cacheReadTokens + increment.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + increment.cacheWriteTokens,
    costUsd: current.costUsd + increment.costUsd,
  };
}

const EVENT_INPUT_LIMIT = 1_200;
/** A sandbox tool's output: enough to show every search result's source. */
const EVENT_OUTPUT_LIMIT = 8_000;

function safeEventJson(
  value: unknown,
  limit = EVENT_INPUT_LIMIT,
): string | null {
  if (value === undefined) return null;
  try {
    return safeEventText(JSON.stringify(value), limit);
  } catch {
    return null;
  }
}

/** Counts only: what the model was given, never the packet itself. */
export function summarizeContextPacket(packet: unknown) {
  if (!packet || typeof packet !== "object") return null;
  const record = packet as Record<string, unknown>;
  const count = (key: string) =>
    Array.isArray(record[key]) ? (record[key] as unknown[]).length : 0;
  const memory =
    record.memory && typeof record.memory === "object"
      ? (record.memory as Record<string, unknown>)
      : null;
  return {
    projects: count("projects"),
    tasks: count("tasks"),
    coworkers: count("coworkers"),
    agents: count("agents"),
    jobs: count("jobs"),
    recentTurns: count("recentTurns"),
    memoryVersion: typeof memory?.version === "number" ? memory.version : 0,
    bytes: Buffer.byteLength(JSON.stringify(packet), "utf8"),
  };
}

export function safeEventProjection(
  type: string,
  data: Record<string, unknown>,
) {
  if (type === "reasoning.completed") {
    // The chat shows it as the bot's Thought, so it keeps more than a
    // one-line event summary.
    return {
      summary: safeReasoningSummary(data) ?? "Reasoning update",
      payload: undefined,
    };
  }
  if (type.startsWith("reasoning.")) {
    return { summary: "Reasoning update", payload: undefined };
  }
  if (type === "message.completed") {
    const text = safeEventText(data.message);
    const finishReason =
      typeof data.finishReason === "string" ? data.finishReason : undefined;
    return {
      summary: text ?? "message completed",
      payload: finishReason ? jsonInput({ finishReason }) : undefined,
    };
  }
  if (type === "actions.requested") {
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const first = actions[0];
    const action =
      first && typeof first === "object"
        ? (first as Record<string, unknown>)
        : null;
    const input = safeEventJson(
      action?.input ?? action?.args ?? action?.arguments,
    );
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = action?.[key];
        if (typeof value === "string" && value) return value;
      }
      return undefined;
    };
    const toolName = pick("name", "toolName", "tool");
    return {
      summary: toolName ? `Requested ${toolName}` : "Requested action",
      payload: input ? jsonInput({ input }) : undefined,
      toolName,
      toolCallId: pick("callId", "toolCallId", "id"),
      toolStatus: "requested",
    };
  }
  if (type === "action.result") {
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = data[key];
        if (typeof value === "string" && value) return value;
      }
      return undefined;
    };
    const output = safeEventJson(data.output, EVENT_OUTPUT_LIMIT);
    return {
      summary: "Action completed",
      payload: output ? jsonInput({ output }) : undefined,
      toolName: pick("name", "toolName", "tool"),
      toolCallId: pick("callId", "toolCallId", "id"),
      toolStatus: "completed",
    };
  }
  if (type.endsWith(".failed")) {
    const code = runtimeFailureCode(data);
    return {
      summary: code ?? "Runtime failure",
      payload: jsonInput({ code: code ?? "unknown" }),
    };
  }
  return { summary: type.replaceAll(".", " "), payload: undefined };
}

/**
 * Who asked and where, for chat-started turns, and the schedule a scheduled
 * turn ran for (console attribution).
 */
const TURN_CHAT_ATTRIBUTION_INCLUDE = {
  askedBy: { select: { id: true, name: true, image: true } },
  scheduleRun: {
    select: { schedule: { select: { name: true, systemKey: true } } },
  },
  chatMention: {
    select: {
      message: {
        select: { room: { select: { id: true, name: true, kind: true } } },
      },
    },
  },
} as const;

/**
 * Whether the turn was for a change. Chat turns a person asked for carry every
 * tool, so the tools alone no longer say so; the route Jev read does.
 */
function actionRequested(
  route: string | null,
  capabilityNames: readonly string[],
): boolean {
  return (
    route !== "DIRECT_RESPONSE" &&
    route !== "CLARIFY" &&
    capabilityNames.some((capability) => ACTION_CAPABILITIES.has(capability))
  );
}

export function staleTurnLeaseWhere(now: Date): Prisma.SokoBotTurnWhereInput {
  const staleBefore = new Date(
    now.getTime() - SOKO_BOT_TURN_STALE_HEARTBEAT_MS,
  );
  return {
    OR: [
      { reconcilerHeartbeatAt: { lte: staleBefore } },
      {
        reconcilerHeartbeatAt: null,
        OR: [
          { status: { not: "STARTING" } },
          { errorKind: "runtime_start_ambiguous" },
          { createdAt: { lte: staleBefore } },
        ],
      },
    ],
  };
}

export function startRecoveryEligibility(): Prisma.SokoBotTurnWhereInput {
  const prompted = {
    source: { notIn: ["SCHEDULE", "EVENT", "INGEST"] },
    chainDepth: { lte: 0 },
  } satisfies Prisma.SokoBotTurnWhereInput;
  return {
    sokoBot: {
      archivedAt: null,
      adminPausedAt: null,
      status: { not: "PAUSED" },
    },
    ...(getEnv().SOKO_BOT_PROACTIVE_PAUSED
      ? prompted
      : { OR: [prompted, { sokoBot: { proactivePaused: false } }] }),
  };
}

/** How Jev read a stored turn's relation to its pending proposal, if at all. */
function storedContinuation(classification: unknown): string | null {
  if (!classification || typeof classification !== "object") return null;
  const continuation = (classification as { continuation?: unknown })
    .continuation;
  return typeof continuation === "string" ? continuation : null;
}

/**
 * The live bots a fleet move takes, oldest id first. Eval lanes pick their
 * own version per run, so they are left out, and in this same query: a lane
 * made a moment ago is never moved because of a list read earlier.
 */
export async function fleetBotsToMove(
  fromVersionId?: string,
): Promise<{ id: string; versionId: string | null }[]> {
  return prisma.$queryRaw<{ id: string; versionId: string | null }[]>`
    SELECT b."id", b."versionId"
    FROM ${sharedTable("soko_bot")} b
    WHERE b."archivedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${sharedTable("eval_lane")} e WHERE e."workspaceId" = b."workspaceId"
      )
      ${fromVersionId ? PrismaRaw.sql`AND b."versionId" = ${fromVersionId}` : PrismaRaw.empty}
    ORDER BY b."id" ASC
  `;
}

export class SokoBotControlPlane {
  constructor(
    private readonly runtime: SokoBotRuntime = getSokoBotRuntime(),
    private readonly contextBuilder: ContextPacketBuilder = new ContextPacketBuilder(),
    private readonly classifier: TurnClassifier = new JevTurnClassifier(),
  ) {}

  private async startRuntimeWithAcceptanceRetry(
    input: Parameters<SokoBotRuntime["createSession"]>[0],
  ) {
    try {
      return await this.runtime.createSession(input);
    } catch (error) {
      if (!isAmbiguousRuntimeAcceptance(error)) throw error;
      // Every Core turn creates one Eve session keyed by the durable turn id.
      // Eve's create operation is idempotent, so exact replay resolves a lost
      // acceptance response without dispatching the user message twice.
      return this.runtime.createSession(input);
    }
  }

  private async resetSupersededRuntimeSession(input: {
    bot: Pick<SokoBot, "id" | "eveSessionId">;
    userId: string | null;
    workspaceId: string;
    turnId: string;
    currentSessionId: string;
  }): Promise<void> {
    const priorSessionId = input.bot.eveSessionId;
    if (!priorSessionId || priorSessionId === input.currentSessionId) return;
    try {
      await this.runtime.resetSession({
        sessionId: priorSessionId,
        reason: "Soko Bot prior turn completed",
      });
    } catch (error) {
      recordCoreWarning(
        TURN_LOG,
        {
          message: "Could not reset a Soko Bot's previous runtime session",
          why: "The runtime refused the reset",
          fix: "Nothing to do: the new turn runs in its own session and the old one ages out at the runtime.",
        },
        {
          sokoBot: { id: input.bot.id },
          turn: { id: input.turnId },
          failure: messageSafeErrorFields(error),
        },
      );
    }
  }

  private async renewTurnLease(
    turnId: string,
    leaseToken: string,
    client: Prisma.TransactionClient,
    where: Prisma.SokoBotTurnWhereInput,
  ): Promise<boolean> {
    const now = await databaseNow(client);
    const retained = await client.sokoBotTurn.updateMany({
      where: {
        ...where,
        id: turnId,
        leaseToken,
      },
      data: {
        leaseExpiresAt: new Date(now.getTime() + TURN_LEASE_MS),
        reconcilerHeartbeatAt: now,
      },
    });
    return retained.count === 1;
  }

  private retainStartLease(
    turnId: string,
    leaseToken: string,
  ): Promise<boolean> {
    return this.renewTurnLease(turnId, leaseToken, prisma, {
      status: { in: ["STARTING", "CANCEL_REQUESTED"] },
      startedAt: null,
    });
  }

  private async requireAcknowledgedStartLease(
    turnId: string,
    leaseToken: string,
    sessionId: string,
    acknowledgementError: unknown,
  ): Promise<void> {
    // Cleanup uses the original acknowledgement error when proof is unavailable.
    const retained = await this.renewTurnLease(turnId, leaseToken, prisma, {
      status: { in: ["RUNNING", "CANCEL_REQUESTED"] },
      startedAt: { not: null },
      eveSessionId: sessionId,
    }).catch(() => false);
    if (!retained) throw acknowledgementError;
  }

  private holdTurnLease(turnId: string, leaseToken: string): () => void {
    let renewing = false;
    const timer = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        // Release clears the heartbeat, fencing out an in-flight tick.
        // Sample the clock after acquiring the lock, in the same statement.
        const updated = await prisma.$executeRaw`
          WITH renewal AS MATERIALIZED (
            SELECT "id", clock_timestamp() AT TIME ZONE 'UTC' AS stamp
            FROM (
              SELECT "id"
              FROM ${sharedTable("soko_bot_turn")}
              WHERE "id" = ${turnId}::uuid
                AND "leaseToken" = ${leaseToken}
                AND "status"::text IN (${PrismaRaw.join(ACTIVE_TURN_STATUSES)})
                AND "reconcilerHeartbeatAt" IS NOT NULL
              FOR NO KEY UPDATE
            ) AS held_turn
          )
          UPDATE ${sharedTable("soko_bot_turn")} AS turn
          SET "reconcilerHeartbeatAt" = renewal.stamp,
              "leaseExpiresAt" = renewal.stamp + ${TURN_LEASE_MS} * interval '1 millisecond',
              "updatedAt" = renewal.stamp
          FROM renewal
          WHERE turn."id" = renewal."id"
        `;
        if (updated === 0) clearInterval(timer);
      } catch {
        // Fenced writes stay authoritative if the database cannot renew the lease.
      } finally {
        renewing = false;
      }
    }, RECONCILER_HEARTBEAT_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async releaseStartLease(
    turnId: string,
    leaseToken: string,
    errorDetail: string,
  ): Promise<void> {
    await prisma.sokoBotTurn.updateMany({
      where: { id: turnId, status: "STARTING", leaseToken },
      data: {
        reconcilerHeartbeatAt: null,
        leaseExpiresAt: null,
        errorKind: "runtime_start_ambiguous",
        errorDetail,
      },
    });
  }

  private async bindScheduleReservation(
    tx: Prisma.TransactionClient,
    input: StartSokoBotTurnInput,
    sokoBotId: string,
    turnId: string,
    message: string,
  ): Promise<void> {
    const reservation = input.scheduleReservation;
    if (!reservation) return;
    const bound = await tx.sokoBotScheduleRun.updateMany({
      where: {
        id: reservation.runId,
        status: "CLAIMED",
        attempt: reservation.attempt,
        leaseToken: reservation.leaseToken,
        prompt: message,
        schedule: {
          sokoBotId,
          ...sokoBotScheduleActingUserWhere(input.userId),
          workspaceId: input.workspaceId,
        },
        OR: [{ turnId: null }, { turnId }],
      },
      data: { turnId },
    });
    if (bound.count !== 1) {
      throw new SokoBotStartAbortedError(
        "Soko Bot schedule occurrence lease was replaced",
      );
    }
  }

  private async bindAdminScheduleReservation(
    tx: Prisma.TransactionClient,
    input: StartSokoBotTurnInput,
    sokoBotId: string,
    turnId: string,
    message: string,
  ): Promise<void> {
    const reservation = input.adminScheduleReservation;
    if (!reservation) return;
    if (reservation.kind === "BOUND_REPLAY") {
      const bound = await tx.sokoBotScheduleRun.findUnique({
        where: { id: reservation.runId },
        select: {
          turnId: true,
          status: true,
          attempt: true,
          prompt: true,
          schedule: {
            select: {
              sokoBotId: true,
              requestedByUserId: true,
              systemKey: true,
              workspaceId: true,
              sokoBot: { select: { userId: true } },
            },
          },
        },
      });
      if (
        !bound ||
        bound.turnId !== reservation.boundTurnId ||
        bound.turnId !== turnId ||
        bound.attempt !== reservation.attempt ||
        !["RUNNING", "COMPLETED", "FAILED", "DEAD_LETTER"].includes(
          bound.status,
        ) ||
        (bound.prompt !== null && bound.prompt !== message) ||
        bound.schedule.sokoBotId !== sokoBotId ||
        sokoBotScheduleActingUserId(bound.schedule) !== input.userId ||
        bound.schedule.workspaceId !== input.workspaceId
      ) {
        throw new SokoBotStartAbortedError(
          "Soko Bot admin schedule retry was replaced",
        );
      }
      return;
    }
    const bound = await tx.sokoBotScheduleRun.updateMany({
      where: {
        id: reservation.runId,
        status: reservation.expectedStatus,
        attempt: reservation.expectedAttempt,
        turnId: reservation.previousTurnId,
        prompt: reservation.expectedPrompt,
        schedule: {
          sokoBotId,
          ...sokoBotScheduleActingUserWhere(input.userId),
          workspaceId: input.workspaceId,
        },
      },
      data: {
        status: "RUNNING",
        attempt: { increment: 1 },
        turnId,
        prompt: message,
        completedAt: null,
        errorKind: null,
        errorDetail: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (bound.count !== 1) {
      throw new SokoBotStartAbortedError(
        "Soko Bot admin schedule retry was replaced",
      );
    }
  }

  private async bindTurnReservation(
    tx: Prisma.TransactionClient,
    input: StartSokoBotTurnInput,
    sokoBotId: string,
    turnId: string,
    message: string,
  ): Promise<void> {
    await this.bindScheduleReservation(tx, input, sokoBotId, turnId, message);
    await this.bindAdminScheduleReservation(
      tx,
      input,
      sokoBotId,
      turnId,
      message,
    );
  }

  private async bindResolvedScheduleReservation(
    input: StartSokoBotTurnInput,
    sokoBotId: string,
    turnId: string,
    message: string,
  ): Promise<void> {
    if (!input.scheduleReservation && !input.adminScheduleReservation) return;
    const reservation = input.adminScheduleReservation;
    if (
      input.presetRoute?.meetingPrepSlot &&
      reservation?.kind === "TERMINAL"
    ) {
      // The same operation won the race and bound the turn in its transaction.
      // Verify that binding instead of spending another attempt.
      input = {
        ...input,
        adminScheduleReservation: {
          kind: "BOUND_REPLAY",
          runId: reservation.runId,
          boundTurnId: turnId,
          attempt: reservation.expectedAttempt + 1,
        },
      };
    }
    await serializableTransaction(
      (tx) => this.bindTurnReservation(tx, input, sokoBotId, turnId, message),
      "Soko Bot schedule occurrence lease was replaced",
    );
  }

  /** A human's exact confirmation consumes one scoped durable proposal. */
  private async settleOwnerConfirmation(
    turnId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const turn = await prisma.sokoBotTurn.findUnique({
      where: { id: turnId },
      include: {
        chatMention: { select: { message: { select: { roomId: true } } } },
        intent: {
          include: {
            decisions: {
              where: { status: { in: ["PENDING", "PROCESSING", "ACCEPTED"] } },
              take: 2,
            },
          },
        },
      },
    });
    if (
      !turn ||
      turn.source !== "CHAT" ||
      turn.chainDepth !== 0 ||
      (turn.askedByUserId && turn.askedByUserId !== turn.requestedByUserId) ||
      storedContinuation(turn.classification) !== "CONTINUE" ||
      !turn.intent ||
      turn.intent.requesterId !== turn.requestedByUserId ||
      turn.intent.workspaceId !== turn.workspaceId ||
      turn.intent.sokoBotId !== turn.sokoBotId ||
      turn.intent.roomId !== (turn.chatMention?.message.roomId ?? null) ||
      turn.intent.decisions.length !== 1
    )
      return false;
    if (
      turn.status !== "STARTING" ||
      turn.leaseToken !== leaseToken ||
      turn.cancellationRequestedAt ||
      turn.intentRevision !== turn.intent.revision ||
      turn.intent.expiresAt <= new Date() ||
      !["AWAITING_CONFIRMATION", "IN_PROGRESS"].includes(turn.intent.state)
    ) {
      throw new SokoBotStartAbortedError("Confirmation is no longer active");
    }
    const decision = turn.intent.decisions[0];
    if (
      decision.requestedByUserId !== turn.requestedByUserId ||
      decision.workspaceId !== turn.workspaceId ||
      decision.sokoBotId !== turn.sokoBotId
    ) {
      throw new SokoBotStartAbortedError(
        "Confirmation proposal is outside this conversation",
      );
    }
    if (decision.status !== "ACCEPTED") {
      const { sokoBotRuntimeService } = await import(
        "./soko-bot-runtime.service"
      );
      await sokoBotRuntimeService.resolveDecision(
        turn.requestedByUserId,
        decision.id,
        true,
        true,
        turn.id,
      );
    }
    await serializableTransaction(async (tx) => {
      const active = await tx.sokoBotTurn.findFirst({
        where: {
          id: turn.id,
          status: "STARTING",
          leaseToken,
          cancellationRequestedAt: null,
        },
      });
      if (!active)
        throw new SokoBotStartAbortedError(
          "Confirmation stopped before settlement",
        );
      const receipt = await tx.sokoBotToolCall.findUnique({
        where: {
          turnId_toolCallId: {
            turnId: decision.turnId,
            toolCallId: `decision:${decision.id}`,
          },
        },
      });
      await tx.sokoBotToolCall.upsert({
        where: {
          turnId_toolCallId: {
            turnId: turn.id,
            toolCallId: `confirmed:${decision.id}`,
          },
        },
        create: {
          turnId: turn.id,
          toolCallId: `confirmed:${decision.id}`,
          capability: decision.toolName,
          inputHash: receipt?.inputHash ?? actionInputHash(decision.proposal),
          status: "COMPLETED",
          disposition: receipt ? "ALREADY_SATISFIED" : "UNKNOWN",
          verification: "NONE",
          ...(receipt
            ? { replayedReceiptId: receipt.id, targetId: receipt.targetId }
            : {}),
          actorBotId: turn.sokoBotId,
          result: { confirmedDecisionId: decision.id },
        },
        update: {},
      });
      await tx.sokoBotTurn.update({
        where: { id: turn.id },
        data: {
          finalAnswer:
            "The confirmed action was processed. Verified effects are listed below.",
        },
      });
    }, "Confirmation receipt collided with settlement");
    await this.settleTurn({ turnId: turn.id, status: "COMPLETED", leaseToken });
    return true;
  }

  private async resumeAmbiguousStart(
    bot: ResolvedSokoBotRow,
    turn: SokoBotTurn,
  ): Promise<SokoBotTurnStartResult | null> {
    const leaseToken = turn.leaseToken;
    if (!leaseToken) {
      throw new SokoBotRetryableStartError(
        "Ambiguous Soko Bot start has no reconciliation lease",
      );
    }
    if (turn.deadlineAt <= (await databaseNow())) return null;
    if (turn.source === "SCHEDULE" || turn.source === "ADMIN_RETRY") {
      const { meetingReplayRefusal } = await import(
        "./soko-bot-admin-retry.service"
      );
      const refusal = await meetingReplayRefusal(turn);
      if (refusal) throw new SokoBotValidationError(refusal);
    }
    if (
      turn.intentId &&
      storedContinuation(turn.classification) === "CONTINUE" &&
      (await this.settleOwnerConfirmation(turn.id, leaseToken))
    ) {
      const completed = await prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: turn.id },
      });
      return {
        turnId: completed.id,
        sokoBotId: completed.sokoBotId,
        sessionId: completed.eveSessionId ?? bot.eveSessionId ?? "",
        status: completed.status,
        route: completed.route ?? "CLARIFY",
        capabilities: completed.capabilityNames as SokoBotCapability[],
        duplicate: true,
        errorKind: completed.errorKind,
      };
    }
    const snapshot = await prisma.sokoBotContextSnapshot.findUnique({
      where: { turnId: turn.id },
      select: { id: true, packet: true },
    });
    if (!snapshot) {
      throw new SokoBotRetryableStartError(
        "Ambiguous Soko Bot start is not ready for replay",
      );
    }
    const memoryVersion = contextMemoryVersion(snapshot.packet);
    // Fences replay: the snapshot's memory revision must still exist.
    requireContextMemoryRevision(
      memoryVersion,
      memoryVersion === 0
        ? null
        : await prisma.sokoBotMemoryRevision.findUnique({
            where: {
              sokoBotId_version: { sokoBotId: bot.id, version: memoryVersion },
            },
            select: { id: true, version: true },
          }),
    );
    const capabilities = turn.capabilityNames as SokoBotCapability[];
    const expectedSessionId = `pending:${turn.id}`;
    const tokenScope = {
      userId: sokoBotActingUserId({ ...turn, sokoBot: bot }),
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      sessionId: expectedSessionId,
      turnId: turn.id,
    };
    let runtimeTurn;
    if (turn.deadlineAt <= (await databaseNow())) return null;
    try {
      runtimeTurn = await this.startRuntimeWithAcceptanceRetry({
        ...tokenScope,
        sessionId: null,
        message: turn.userMessage,
        reconciliationLeaseToken: leaseToken,
      });
    } catch (error) {
      if (isAmbiguousRuntimeAcceptance(error)) {
        throw new SokoBotRetryableStartError(
          "Eve turn acceptance remains ambiguous",
        );
      }
      throw error;
    }

    try {
      await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM ${sharedTable("soko_bot")}
          WHERE "id" = ${bot.id}::uuid
          FOR UPDATE
        `;
        const acknowledgedAt = await databaseNow(tx);
        const updatedTurn = await tx.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            status: "STARTING",
            leaseToken,
          },
          data: {
            status: "RUNNING",
            eveSessionId: runtimeTurn.sessionId,
            runtimeVersion: runtimeTurn.runtimeVersion,
            startedAt: acknowledgedAt,
            reconcilerHeartbeatAt: acknowledgedAt,
            errorKind: null,
            errorDetail: null,
          },
        });
        if (updatedTurn.count !== 1) {
          throw new SokoBotStartAbortedError(
            "Soko Bot turn stopped before replay acknowledgement",
          );
        }
        const updatedBot = await tx.sokoBot.updateMany({
          where: {
            id: bot.id,
            archivedAt: null,
            adminPausedAt: null,
            status: { not: "PAUSED" },
          },
          data: turn.parentTurnId
            ? { lastActivityAt: new Date() }
            : {
                eveSessionId: runtimeTurn.sessionId,
                runtimeVersion: runtimeTurn.runtimeVersion,
                runtimeDeployment: "core",
                status: "RUNNING",
              },
        });
        if (updatedBot.count !== 1) {
          throw new SokoBotStartAbortedError(
            "Soko Bot turn stopped before replay acknowledgement",
          );
        }
      }, "Soko Bot replay collided with pause or cancellation").catch(
        (error: unknown) =>
          this.requireAcknowledgedStartLease(
            turn.id,
            leaseToken,
            runtimeTurn.sessionId,
            error,
          ),
      );
    } catch (error) {
      if (!(await this.retainStartLease(turn.id, leaseToken))) {
        const current = await prisma.sokoBotTurn.findUnique({
          where: { id: turn.id },
        });
        if (current) return observedStartResult(current, bot.eveSessionId);
        throw error;
      }
      try {
        await this.runtime.resetSession({
          sessionId: runtimeTurn.sessionId,
          reason: "Soko Bot replay acknowledgement failed",
        });
      } catch {
        // Durable STARTING/CANCEL_REQUESTED state remains recoverable.
        throw error;
      }
      await prisma.sokoBotTurn.updateMany({
        where: {
          id: turn.id,
          status: "STARTING",
          leaseToken,
          eveSessionId: runtimeTurn.sessionId,
        },
        data: { eveSessionId: null },
      });
      throw error;
    }

    if (!turn.parentTurnId)
      await this.resetSupersededRuntimeSession({
        bot,
        userId: sokoBotActingUserId({ ...turn, sokoBot: bot }),
        workspaceId: turn.workspaceId,
        turnId: turn.id,
        currentSessionId: runtimeTurn.sessionId,
      });

    return {
      turnId: turn.id,
      sokoBotId: turn.sokoBotId,
      sessionId: runtimeTurn.sessionId,
      status: "RUNNING",
      route: turn.route ?? "CLARIFY",
      capabilities,
      duplicate: true,
      errorKind: null,
      reconciliationLeaseToken: leaseToken,
    };
  }

  /**
   * Replays a durable STARTING turn after its owner releases it or stops renewing.
   * The lease CAS elects one recovery worker to replay the immutable Core turn
   * id. Acknowledgement and settlement are fenced by the new token.
   */
  async recoverStartingTurn(
    turnId: string,
  ): Promise<SokoBotTurnStartResult | null> {
    const checkedAt = await databaseNow();
    const turn = await prisma.sokoBotTurn.findFirst({
      where: {
        id: turnId,
        status: "STARTING",
        OR: [{ eveSessionId: null }, { errorKind: "runtime_start_ambiguous" }],
        deadlineAt: { gt: checkedAt },
        AND: [staleTurnLeaseWhere(checkedAt), startRecoveryEligibility()],
      },
    });
    if (!turn) return null;

    const leaseToken = randomUUID();
    const claimed = await prisma.$transaction(async (tx) => {
      // Pause and archive lock the bot before they touch a turn.
      await tx.$queryRaw`
        SELECT "id" FROM ${sharedTable("soko_bot")} WHERE "id" = ${turn.sokoBotId}::uuid FOR UPDATE
      `;
      // Foreground settlement can already hold the turn and need the bot.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM ${sharedTable("soko_bot_turn")} WHERE "id" = ${turn.id}::uuid
        FOR NO KEY UPDATE SKIP LOCKED
      `;
      if (!locked.length) return null;
      const claimedAt = await databaseNow(tx);
      const { count } = await tx.sokoBotTurn.updateMany({
        where: {
          id: turn.id,
          status: "STARTING",
          eveSessionId: turn.eveSessionId,
          errorKind: turn.errorKind,
          leaseToken: turn.leaseToken,
          leaseExpiresAt: turn.leaseExpiresAt,
          reconcilerHeartbeatAt: turn.reconcilerHeartbeatAt,
          deadlineAt: { gt: claimedAt },
          AND: [staleTurnLeaseWhere(claimedAt), startRecoveryEligibility()],
        },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(claimedAt.getTime() + TURN_LEASE_MS),
          reconcilerHeartbeatAt: claimedAt,
          errorKind: "runtime_start_ambiguous",
          errorDetail: "Recovering durable start after process interruption",
        },
      });
      if (!count) return null;
      // Make a serializable pause/archive with an older snapshot retry its check.
      await tx.$executeRaw`
        UPDATE ${sharedTable("soko_bot")} SET "updatedAt" = "updatedAt" WHERE "id" = ${turn.sokoBotId}::uuid
      `;
      return tx.sokoBot.findUniqueOrThrow({ where: { id: turn.sokoBotId } });
    });
    if (!claimed) return null;

    const stopRenewing = this.holdTurnLease(turn.id, leaseToken);
    try {
      return await this.resumeAmbiguousStart(claimed, {
        ...turn,
        leaseToken,
      });
    } catch (error) {
      if (
        error instanceof SokoBotRetryableStartError ||
        error instanceof SokoBotStartAbortedError
      ) {
        await this.releaseStartLease(
          turn.id,
          leaseToken,
          safeRuntimeDiagnostic(error.message),
        );
      } else {
        await this.failStartedTurn(turn.id, error, leaseToken);
      }
      throw error;
    } finally {
      stopRenewing();
    }
  }

  async create(input: CreateSokoBotInput) {
    const name = input.name.trim();
    if (!name || name.length > 80) {
      throw new SokoBotValidationError("Soko Bot name must be 1-80 characters");
    }
    const markdown = renderSokoBotMemory(createEmptySokoBotMemory());
    const hash = memoryHash(markdown);
    // Resolved outside the transaction: promoting a version affects new bots
    // only, so this is read once at creation and then pinned.
    const defaultVersionId = await getDefaultSokoBotVersionId();

    const profile = {
      name,
      ...(input.avatarSeed !== undefined
        ? { avatarSeed: input.avatarSeed }
        : {}),
      ...(input.personalityTone !== undefined
        ? { personalityTone: input.personalityTone }
        : {}),
      ...(input.personalityDetail !== undefined
        ? { personalityDetail: input.personalityDetail }
        : {}),
      ...(input.personalityStyle !== undefined
        ? { personalityStyle: input.personalityStyle }
        : {}),
    };
    const created = await prisma.$transaction(async (tx) => {
      // Only a live row: a deleted bot is a tombstone kept for provenance and
      // must never be reactivated into the owner's new assistant.
      const existing = await tx.sokoBot.findFirst({
        where: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          deletedAt: null,
        },
      });
      if (existing) {
        const needsInitialMemory = existing.memoryVersion === 0;
        const isReactivation = existing.archivedAt !== null;
        const updated = await tx.sokoBot.update({
          where: { id: existing.id },
          data: {
            ...(isReactivation ? { archivedAt: null } : {}),
            ...profile,
            // Owner reactivation must not clear a durable administrator pause.
            ...(isReactivation && existing.adminPausedAt === null
              ? { status: "IDLE" }
              : {}),
            ...(needsInitialMemory
              ? { memoryVersion: 1, memoryHash: hash }
              : {}),
          },
        });
        if (needsInitialMemory) {
          await tx.sokoBotMemoryRevision.create({
            data: {
              sokoBotId: existing.id,
              version: 1,
              hash,
              markdown,
              source: "activated",
            },
          });
        }
        return updated;
      }

      const bot = await tx.sokoBot.create({
        data: {
          userId: input.userId,
          createdByUserId: input.userId,
          workspaceId: input.workspaceId,
          ...profile,
          // Pin the version a bot was created on rather than leaving it null
          // and relying on the runtime fallback: the console can then show
          // what each bot actually runs, and an older bot keeps its version
          // when the default moves on.
          versionId: defaultVersionId,
          ...(input.timezone !== undefined
            ? { ingestTimezone: input.timezone }
            : {}),
          memoryVersion: 1,
          memoryHash: hash,
        },
      });
      await tx.sokoBotMemoryRevision.create({
        data: {
          sokoBotId: bot.id,
          version: 1,
          hash,
          markdown,
          source: "created",
        },
      });
      return bot;
    });
    // Outside the transaction: it uploads to Blob.
    if (!created.avatarCode) {
      const look = await giveNewSokoBotAvatar(created.id, input.avatarCode);
      if (look) Object.assign(created, look);
    }
    const { ensureSystemSchedules } = await import(
      "@/services/soko-bot-proactive.service"
    );
    await ensureSystemSchedules({
      id: created.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      ingestTimezone: created.ingestTimezone,
    }).catch((error) => {
      // Awaited inside the create request; an eval lane creates outside one.
      recordCoreError(
        TURN_LOG,
        {
          message: "Created a Soko Bot without its built-in rhythms",
          why: "Creating the system schedules failed",
          fix: "The bot works without them. The owner can add the rhythms on the bot's Schedules page.",
          cause: error,
        },
        { sokoBot: { id: created.id } },
      );
    });
    return created;
  }

  async listTurns(
    userId: string,
    workspaceId: string,
    options: { cursor?: string; take?: number } = {},
    selector: SokoBotSelector = ME_SOKO_BOT,
  ) {
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const bot = await memberSokoBot(userId, workspaceId, selector);
    if (!bot) return { turns: [], count: 0, hasMore: false };
    const turns = await prisma.sokoBotTurn.findMany({
      where: { sokoBotId: bot.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(options.cursor
        ? { cursor: { id: options.cursor }, skip: 1 }
        : undefined),
      include: {
        ...TURN_CHAT_ATTRIBUTION_INCLUDE,
        toolCalls: {
          where: { capability: "preview_result", status: "COMPLETED" },
          select: { result: true },
          orderBy: { createdAt: "asc" },
          take: 24,
        },
        events: { orderBy: { sequence: "asc" } },
        delegations: true,
        pendingDecisions: {
          where: {
            OR: [
              { status: { not: "PENDING" } },
              { status: "PENDING", expiresAt: { gt: new Date() } },
            ],
          },
        },
      },
    });
    const hasMore = turns.length > take;
    if (hasMore) turns.pop();
    const count = await prisma.sokoBotTurn.count({
      where: { sokoBotId: bot.id },
    });
    return {
      turns: turns.map(({ toolCalls, ...turn }) => ({
        ...turn,
        ...(turn.status === "COMPLETED" && toolCalls?.length
          ? {
              resultPreviews: chatResultDescriptors(
                readPreparedResultSnapshots(
                  toolCalls.map((call) => call.result),
                ),
              ),
            }
          : {}),
      })),
      count,
      hasMore,
    };
  }

  /** A shared bot's turns are readable by every member: pass its id. */
  async getTurn(userId: string, turnId: string, sokoBotId?: string) {
    const turn = await prisma.sokoBotTurn.findFirst({
      // Without a bot, the caller's own bot: a shared bot's turn also records
      // its asker as Requester, and leaving the organization must end that read.
      where: sokoBotId
        ? { id: turnId, sokoBotId }
        : { id: turnId, requestedByUserId: userId, sokoBot: { userId } },
      include: {
        events: { orderBy: { sequence: "asc" } },
        delegations: true,
        pendingDecisions: {
          where: {
            OR: [
              { status: { not: "PENDING" } },
              { status: "PENDING", expiresAt: { gt: new Date() } },
            ],
          },
        },
        toolCalls: { orderBy: { createdAt: "asc" } },
        contextSnapshot: { select: { packet: true } },
        ...TURN_CHAT_ATTRIBUTION_INCLUDE,
      },
    });
    if (!turn) throw new SokoBotNotFoundError("Soko Bot turn not found");
    const { contextSnapshot, ...rest } = turn;
    return {
      ...rest,
      resultPreviews:
        turn.status === "COMPLETED"
          ? chatResultDescriptors(
              readPreparedResultSnapshots(
                turn.toolCalls
                  .filter(
                    (call) =>
                      call.capability === "preview_result" &&
                      call.status === "COMPLETED",
                  )
                  .map((call) => call.result),
              ),
            )
          : [],
      toolCalls: (turn.toolCalls ?? []).map((call) =>
        call.capability === "preview_result" ? { ...call, result: null } : call,
      ),
      evaluation: await evaluationEvidence(
        userId,
        turn.sokoBotId,
        turn.clientTurnId,
      ),
      contextSummary: summarizeContextPacket(contextSnapshot?.packet ?? null),
      contextPacket: contextSnapshot?.packet ?? null,
    };
  }

  private async settleTurn(input: {
    turnId: string;
    status: TerminalSokoBotTurnStatus;
    errorKind?: string;
    errorDetail?: string;
    clearSession?: boolean;
    leaseToken?: string;
    providerCompletedAt?: Date;
    requireMissingEveSession?: boolean;
  }): Promise<boolean> {
    // Set inside the transaction and read after it commits, because the
    // low-balance check publishes over realtime and must not run for a
    // charge that rolled back. Reset per attempt: a serialization retry
    // starts over and must not carry the rolled-back attempt's charge.
    let chargedWallet: {
      userId: string;
      organizationId: string | null;
    } | null = null;
    // A Cuso's charge gets his own notice, on his Project (SOKD-246).
    let chargedCusoProjectId: string | null = null;
    // A CMO research or plan turn that ended: Cuso's first plan, or the
    // next fix the owner asked for meanwhile, may start now.
    let cmoTurnEnded: {
      sokoBotId: string;
      userId: string | null;
      clientTurnId: string | null;
    } | null = null;

    return serializableTransaction(async (tx) => {
      chargedWallet = null;
      chargedCusoProjectId = null;
      cmoTurnEnded = null;
      const turn = await tx.sokoBotTurn.findUnique({
        where: { id: input.turnId },
        select: {
          sokoBotId: true,
          clientTurnId: true,
          requestedByUserId: true,
          sokoBot: { select: { userId: true } },
          workspaceId: true,
          versionId: true,
          askedByUserId: true,
          chainDepth: true,
          eveSessionId: true,
          startedAt: true,
          costUsdMicros: true,
          usage: true,
          status: true,
          finalAnswer: true,
          responseContract: true,
          capabilityNames: true,
          route: true,
          parentTurnId: true,
          leaseToken: true,
          cancellationRequestedAt: true,
          scheduleRun: {
            select: {
              id: true,
              scheduleId: true,
              status: true,
              attempt: true,
              leaseToken: true,
            },
          },
        },
      });
      if (!turn) return false;
      if (!ACTIVE_TURN_STATUSES.some((status) => status === turn.status)) {
        return false;
      }
      if (input.leaseToken && turn.leaseToken !== input.leaseToken)
        return false;

      const usageCharge = await recordSokoBotTurnUsage(
        {
          turnId: input.turnId,
          sokoBotId: turn.sokoBotId,
          userId: sokoBotActingUserId(turn),
          costUsdMicros: turn.costUsdMicros,
          ranModel: turnRanModel(turn.usage),
        },
        tx,
      );
      const chargedUserId = sokoBotActingUserId(turn);
      if (usageCharge.chargedCents > 0n && usageCharge.cusoProjectId) {
        chargedCusoProjectId = usageCharge.cusoProjectId;
      }
      // A Cuso's charge drew on his Project credits first: the pool's
      // notice, which sends people to Sokosumi's top-up, is not his.
      if (
        usageCharge.chargedCents > 0n &&
        chargedUserId &&
        !usageCharge.cusoProjectId
      ) {
        // The wallet the turn drew on: a bot in an Organization workspace
        // bills the Organization, not the member's personal wallet.
        chargedWallet = {
          userId: chargedUserId,
          organizationId: usageCharge.organizationId,
        };
      }
      // Runtime work already happened before settlement. A late billing
      // shortfall must be visible and block later funded turns, but discarding
      // a completed answer would charge the user for an unusable result.
      const completionLostToCancellation =
        input.status === "COMPLETED" &&
        turn.cancellationRequestedAt !== null &&
        (input.providerCompletedAt === undefined ||
          input.providerCompletedAt >= turn.cancellationRequestedAt);
      const settledStatus: TerminalSokoBotTurnStatus =
        completionLostToCancellation ? "CANCELLED" : input.status;
      const budgetExceeded =
        settledStatus === "FAILED" &&
        runtimeFailureCode({
          code: input.errorKind,
          message: input.errorDetail,
        }) === AI_BUDGET_EXCEEDED;
      const errorKind = budgetExceeded
        ? AI_BUDGET_EXCEEDED
        : usageCharge.shortfall
          ? "insufficient_credits"
          : safeRuntimeDiagnostic(input.errorKind, 120);
      const errorDetail = budgetExceeded
        ? AI_BUDGET_EXCEEDED_MESSAGE
        : usageCharge.shortfall
          ? "Available credits were exhausted while settling this Soko Bot turn"
          : safeRuntimeDiagnostic(input.errorDetail);

      const responseContract =
        settledStatus === "COMPLETED"
          ? await buildActionResponse(
              tx,
              input.turnId,
              turn.finalAnswer ?? "",
              // A run's own report is its answer, whatever it changed.
              !turn.parentTurnId &&
                actionRequested(turn.route, turn.capabilityNames ?? []),
              turn.responseContract &&
                typeof turn.responseContract === "object" &&
                !Array.isArray(turn.responseContract)
                ? turn.responseContract.narrative
                : undefined,
            )
          : null;
      const now = await databaseNow(tx);
      const settled = await tx.sokoBotTurn.updateMany({
        where: {
          id: input.turnId,
          status: { in: [...ACTIVE_TURN_STATUSES] },
          ...(input.leaseToken ? { leaseToken: input.leaseToken } : {}),
          ...(input.requireMissingEveSession ? { eveSessionId: null } : {}),
        },
        data: {
          status: settledStatus,
          completedAt: now,
          durationMs: turn.startedAt
            ? Math.max(0, now.getTime() - turn.startedAt.getTime())
            : null,
          errorKind: errorKind ?? null,
          errorDetail: errorDetail ?? null,
          finalAnswer: responseContract?.answerText ?? null,
          responseContract: responseContract ?? Prisma.JsonNull,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (settled.count === 0) return false;
      // Once any foreground turn of Cuso ends, his first plan or the next
      // fix the owner asked for meanwhile may start (one turn per bot); once
      // a production run ends, the month's next one. A turn the owner
      // stopped starts nothing.
      if (
        settledStatus !== "CANCELLED" &&
        (turn.clientTurnId?.startsWith(ONBOARDING_TURN_PREFIX) ||
          turn.clientTurnId?.startsWith(STRATEGY_TURN_PREFIX) ||
          turn.clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX) ||
          (turn.parentTurnId === null &&
            turn.versionId !== undefined &&
            getSokoBotVersion(turn.versionId).profile === "cmo"))
      ) {
        cmoTurnEnded = {
          sokoBotId: turn.sokoBotId,
          userId: turn.requestedByUserId,
          clientTurnId: turn.clientTurnId,
        };
      }
      const outcome = await assessSokoBotIntentOutcome(tx, input.turnId);
      const outcomeSummary = sokoBotOutcomeSummary(outcome);
      // The owner reads the model's own words; the claim check has already
      // held back any change no receipt proves. A canned note on top read as
      // failure on turns that worked, so the verifier's view stays on the
      // contract for the admin console only.
      if (responseContract && outcomeSummary) {
        await tx.sokoBotTurn.update({
          where: { id: input.turnId },
          data: { responseContract: { ...responseContract, outcomeSummary } },
        });
      }
      if (settledStatus === "COMPLETED")
        await prepareTurnActionResultPreviews(input.turnId, turn, tx);
      await enqueueSokoBotDelivery(tx, input.turnId);

      // A background run never held the chat's status or session.
      if (!turn.parentTurnId)
        await tx.sokoBot.updateMany({
          where: {
            id: turn.sokoBotId,
            archivedAt: null,
            adminPausedAt: null,
            status: { not: "PAUSED" },
            ...(input.clearSession && turn.eveSessionId
              ? { eveSessionId: turn.eveSessionId }
              : {}),
          },
          data: {
            ...(input.clearSession ? { eveSessionId: null } : {}),
            ...(settledStatus === "FAILED"
              ? {
                  status: "ERROR",
                  lastFailedAt: now,
                  consecutiveTurnFailures: { increment: 1 },
                }
              : settledStatus === "COMPLETED"
                ? {
                    status: "IDLE",
                    lastSucceededAt: now,
                    consecutiveTurnFailures: 0,
                  }
                : { status: "IDLE" }),
          },
        });

      const scheduleRun = turn.scheduleRun;
      if (scheduleRun) {
        const completed = settledStatus === "COMPLETED";
        const scheduleErrorDetail = completed ? null : errorDetail;
        const scheduleRunUpdate = await tx.sokoBotScheduleRun.updateMany({
          where: {
            id: scheduleRun.id,
            status: scheduleRun.status,
            attempt: scheduleRun.attempt,
            leaseToken: scheduleRun.leaseToken,
          },
          data: {
            status: completed ? "COMPLETED" : "FAILED",
            completedAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
            errorKind: completed
              ? null
              : (errorKind ?? settledStatus.toLowerCase()),
            ...(scheduleErrorDetail !== undefined
              ? { errorDetail: scheduleErrorDetail }
              : {}),
          },
        });
        // A turn the platform failed says nothing about its schedule.
        if (
          scheduleRunUpdate.count === 1 &&
          (completed || !isPlatformTurnFailure(errorKind ?? null))
        ) {
          await tx.sokoBotSchedule.update({
            where: { id: scheduleRun.scheduleId },
            data: completed
              ? { consecutiveFailures: 0 }
              : { consecutiveFailures: { increment: 1 } },
          });
        }
      }
      return true;
    }, "Soko Bot turn settlement collided with another operation").then(
      async (settled) => {
        // On the charge alone: a settlement that lost its lease after the
        // usage was recorded still committed that charge.
        if (chargedWallet) {
          await notifyLowBalanceAfterCharge(chargedWallet);
        }
        if (chargedCusoProjectId) {
          await notifyCusoLowCreditsAfterCharge(chargedCusoProjectId);
        }
        if (settled && cmoTurnEnded) {
          const ended: {
            sokoBotId: string;
            userId: string | null;
            clientTurnId: string | null;
          } = cmoTurnEnded;
          waitUntil(
            import("@/services/cmo-strategy.service")
              .then(({ afterCmoTurn }) => afterCmoTurn(ended))
              .catch((error: unknown) => {
                // After the response: a standalone event, redacted and drained.
                emitCoreWarning(
                  { operation: "cmo_next_run" },
                  {
                    message: "CMO's next run did not start",
                    why: "Starting the first plan or a queued brand fix threw after Cuso's turn settled",
                    fix: "It starts again when Cuso's next turn ends. If it keeps failing, read the failure and the Cuso's credits.",
                  },
                  {
                    sokoBot: { id: ended.sokoBotId },
                    clientTurnId: ended.clientTurnId,
                    failure: messageSafeErrorFields(error),
                  },
                );
              }),
          );
        }
        if (settled) {
          waitUntil(
            runAsBackgroundWork(() =>
              logSokoBotRouteOutcome(input.turnId).catch(() => undefined),
            ),
          );
          waitUntil(
            runAsBackgroundWork(() =>
              import("@/services/soko-bot-delivery.service")
                .then(({ deliverSokoBotTurnOutbox }) =>
                  deliverSokoBotTurnOutbox(input.turnId),
                )
                .catch((error) => {
                  emitCoreWarning(
                    TURN_LOG,
                    {
                      message:
                        "Could not deliver a settled Soko Bot turn right away",
                      why: "The inline delivery threw",
                      fix: "Nothing to do: the delivery outbox keeps it and the soko-bot-turns sync delivers it.",
                    },
                    {
                      turn: { id: input.turnId },
                      failure: messageSafeErrorFields(error),
                    },
                  );
                }),
            ),
          );
        }
        return settled;
      },
    );
  }

  private async settleOwnedTurn(
    input: Parameters<SokoBotControlPlane["settleTurn"]>[0] & {
      leaseToken: string;
    },
  ): Promise<void> {
    if (await this.settleTurn(input)) return;
    const active = await prisma.sokoBotTurn.findFirst({
      where: { id: input.turnId, status: { in: [...ACTIVE_TURN_STATUSES] } },
      select: { id: true },
    });
    if (active) {
      throw new SokoBotReconciliationLeaseLostError(
        "Soko Bot settlement lost its lease",
      );
    }
  }

  async settleUndeliverableCancellation(turnId: string): Promise<boolean> {
    const leaseToken = randomUUID();
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM ${sharedTable("soko_bot_turn")} WHERE "id" = ${turnId}::uuid
        FOR NO KEY UPDATE
      `;
      const now = await databaseNow(tx);
      return tx.sokoBotTurn.updateMany({
        where: {
          id: turnId,
          status: "CANCEL_REQUESTED",
          eveSessionId: null,
          ...staleTurnLeaseWhere(now),
        },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + TURN_LEASE_MS),
          reconcilerHeartbeatAt: now,
        },
      });
    });
    if (!claimed.count) return false;
    return this.settleTurn({
      turnId,
      status: "CANCELLED",
      errorKind: "cancelled_before_runtime_start",
      errorDetail: "Soko Bot turn was cancelled before runtime acceptance",
      clearSession: true,
      leaseToken,
      requireMissingEveSession: true,
    });
  }

  private async failStartedTurn(
    turnId: string,
    error: unknown,
    leaseToken: string,
  ): Promise<void> {
    await this.settleTurn({
      turnId,
      status: "FAILED",
      errorKind: "runtime_start_failed",
      errorDetail:
        error instanceof Error
          ? error.message.slice(0, 1_000)
          : "Unknown runtime error",
      clearSession: true,
      leaseToken,
    });
  }

  private async deliverRuntimeCancellation(turn: {
    id: string;
    requestedByUserId: string | null;
    sokoBotId: string;
    workspaceId: string;
    eveSessionId: string | null;
    eveTurnId: string | null;
  }): Promise<boolean> {
    if (!turn.eveSessionId || !turn.eveTurnId) return false;
    await this.runtime.cancelTurn({
      sessionId: turn.eveSessionId,
      eveTurnId: turn.eveTurnId,
    });
    return true;
  }

  async expireTurn(turnId: string, leaseToken?: string): Promise<boolean> {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: {
        id: turnId,
        status: { in: [...ACTIVE_TURN_STATUSES] },
        ...(leaseToken !== undefined ? { leaseToken } : {}),
      },
      select: {
        id: true,
        requestedByUserId: true,
        sokoBotId: true,
        workspaceId: true,
        eveSessionId: true,
        eveTurnId: true,
      },
    });
    if (!turn) return false;
    if (turn.eveSessionId && turn.eveTurnId) {
      try {
        await this.deliverRuntimeCancellation(turn);
      } catch (error) {
        // Crons expire turns, and so do CMO status reads inside a request.
        recordCoreWarning(
          TURN_LOG,
          {
            message: "Could not cancel an expired Soko Bot turn at the runtime",
            why: "The runtime refused the cancel",
            fix: "The turn is still settled as failed; the runtime stops it at its own limit.",
          },
          { turn: { id: turnId }, failure: messageSafeErrorFields(error) },
        );
      }
    }
    return this.settleTurn({
      turnId,
      status: "FAILED",
      errorKind: "turn_deadline_exceeded",
      errorDetail: "Soko Bot turn exceeded its execution deadline",
      // A deadline is an uncertain boundary. Never attach a later turn to the
      // same Eve session, even when cancellation acknowledgement was lost.
      clearSession: true,
      leaseToken,
    });
  }

  async startTurn(
    input: StartSokoBotTurnInput,
  ): Promise<SokoBotTurnStartResult> {
    // The single choke point for every turn, whatever started it: chat,
    // schedules, ingest, coworker events or the lab. Refusing here is what
    // makes the administrator switch mean "no model calls".
    const availability = await getSokoBotAvailability();
    if (availability.disabled) {
      throw new SokoBotDisabledError(
        availability.disabledReason ??
          "Soko Bot is temporarily disabled by an administrator",
      );
    }
    const message = input.message.trim();
    const clientTurnId = input.clientTurnId.trim();
    const source = input.source ?? "CHAT";
    // A person types a chat message; Core writes the rest, and a CMO
    // production brief carries a month of pieces and their writing skills.
    const limit = source === "CHAT" ? 20_000 : 100_000;
    if (!message || message.length > limit) {
      throw new SokoBotValidationError(
        `Message must be 1-${limit.toLocaleString("en")} characters`,
      );
    }
    if (!clientTurnId || clientTurnId.length > 120) {
      throw new SokoBotValidationError("Invalid client turn id");
    }
    if (
      input.scheduleReservation &&
      (source !== "SCHEDULE" ||
        !input.scheduleReservation.runId ||
        !Number.isInteger(input.scheduleReservation.attempt) ||
        input.scheduleReservation.attempt < 1 ||
        !input.scheduleReservation.leaseToken)
    ) {
      throw new SokoBotValidationError("Invalid schedule turn reservation");
    }
    if (input.ownScheduleId && !input.scheduleReservation) {
      throw new SokoBotValidationError(
        "Only a schedule run may manage its own schedule",
      );
    }
    if (
      input.adminScheduleReservation &&
      (source !== "ADMIN_RETRY" ||
        input.scheduleReservation !== undefined ||
        !input.adminScheduleReservation.runId ||
        (input.adminScheduleReservation.kind === "TERMINAL"
          ? !Number.isInteger(input.adminScheduleReservation.expectedAttempt) ||
            input.adminScheduleReservation.expectedAttempt < 0
          : !input.adminScheduleReservation.boundTurnId ||
            !Number.isInteger(input.adminScheduleReservation.attempt) ||
            input.adminScheduleReservation.attempt < 1))
    ) {
      throw new SokoBotValidationError("Invalid admin schedule reservation");
    }
    const bot = input.sokoBotId
      ? await sokoBotForTurnMember(
          {
            sokoBotId: input.sokoBotId,
            actingUserId: input.userId,
            workspaceId: input.workspaceId,
          },
          "notArchived",
        )
      : input.userId === null
        ? null
        : await memberSokoBot(input.userId, input.workspaceId, ME_SOKO_BOT);
    if (!bot) throw new SokoBotNotFoundError("Create a Soko Bot first");
    if (
      evaluationBinding() &&
      (input.chat?.askedByBot ||
        (input.chat?.askedByUserId &&
          input.chat.askedByUserId !== input.userId))
    )
      throw new SokoBotValidationError(
        "Evaluation requires the designated owner",
      );
    assertEvaluationActor({
      userId: input.userId,
      sokoBotId: bot.id,
      clientTurnId,
      source,
    });
    const duplicate = await prisma.sokoBotTurn.findUnique({
      where: {
        sokoBotId_clientTurnId: {
          sokoBotId: bot.id,
          clientTurnId,
        },
      },
    });
    if (duplicate) {
      if (
        !matchesReservedTurnMessage(duplicate, message, input.presetRoute) ||
        duplicate.workspaceId !== input.workspaceId ||
        duplicate.source !== source
      ) {
        throw new SokoBotIdempotencyConflictError(
          "Client turn id was already used for different input",
        );
      }
      await this.bindResolvedScheduleReservation(
        input,
        bot.id,
        duplicate.id,
        duplicate.userMessage,
      );
      if (
        duplicate.status === "STARTING" &&
        (duplicate.eveSessionId === null ||
          duplicate.errorKind === "runtime_start_ambiguous") &&
        bot.status !== "PAUSED" &&
        bot.adminPausedAt === null
      ) {
        const recovered = await this.recoverStartingTurn(duplicate.id);
        if (recovered) return recovered;
        const current = await prisma.sokoBotTurn.findUnique({
          where: { id: duplicate.id },
        });
        if (current) return observedStartResult(current, bot.eveSessionId);
      }
      return observedStartResult(duplicate, bot.eveSessionId);
    }
    if (bot.status === "PAUSED" || bot.adminPausedAt !== null) {
      throw new SokoBotBusyError("Soko Bot is paused");
    }

    const memberId = input.userId;
    // A shared bot acting on its own was resolved in its own workspace.
    const workspace =
      memberId === null
        ? { id: input.workspaceId }
        : await prisma.workspace.findFirst({
            where: {
              id: input.workspaceId,
              OR: [
                { userId: memberId },
                { organization: { members: { some: { userId: memberId } } } },
              ],
            },
            select: { id: true },
          });
    if (!workspace) throw new SokoBotNotFoundError("Workspace not found");

    const version = await resolveRunnableSokoBotVersion(
      input.versionId ?? bot.versionId,
      isSharedSokoBot(bot),
    );

    try {
      await requireSokoBotTurnFunding(input.userId, bot.id);
    } catch (error) {
      // A chat turn's sender sees the refusal; a self-started one has nobody
      // watching, so the owner hears about it in their chat instead.
      // A paused Cuso is not out of credits; CMO shows why he is paused.
      if (
        error instanceof SokoBotBillingAccessError &&
        error.reason !== "cmo_paused" &&
        source !== "CHAT"
      ) {
        await notifySokoBotOutOfCredits(bot.id).catch(
          (noticeError: unknown) => {
            recordCoreWarning(
              TURN_LOG,
              {
                message:
                  "Could not tell a Soko Bot's owner that it is out of credits",
                why: "Posting the out-of-credits notice in the owner's chat failed",
                fix: "The turn is still refused. The owner sees the balance on the billing page; the next self-started turn posts the notice again.",
              },
              // The name only: the notice's text is about the owner.
              {
                sokoBot: { id: bot.id },
                errorName:
                  noticeError instanceof Error ? noticeError.name : "unknown",
              },
            );
          },
        );
      }
      throw error;
    }

    const askedByTeammate =
      input.chat?.askedByBot === true ||
      (!!input.chat?.askedByUserId &&
        input.chat.askedByUserId !== input.userId);
    // A shared bot has no owner: every member who asks it is named.
    const askedByUserId = isSharedSokoBot(bot)
      ? (input.chat?.askedByUserId ?? input.userId)
      : askedByTeammate
        ? input.chat?.askedByUserId
        : null;
    const conversationMention = input.chat?.mentionId
      ? await prisma.chatRoomMention.findUnique({
          where: { id: input.chat.mentionId },
          select: { message: { select: { roomId: true } } },
        })
      : null;
    const destinationRoom = input.background
      ? input.background.destinationRoomId
        ? { id: input.background.destinationRoomId }
        : null
      : conversationMention?.message.roomId
        ? { id: conversationMention.message.roomId }
        : input.chat
          ? null
          : await turnDestinationRoom(
              bot,
              { userId: memberId, clientTurnId: input.clientTurnId },
              source,
            );
    if (needsProactiveDestination(source) && !destinationRoom) {
      throw new SokoBotNoDestinationError(
        "No authorized destination exists for proactive output. Restore an authorized conversation to resume delivery.",
      );
    }
    const requesterId = input.chat?.askedByUserId ?? input.userId;
    // A turn that acts for nobody has no one to confirm an offer with, so it
    // neither reads nor makes one.
    const intentScope =
      requesterId === null
        ? null
        : {
            sokoBotId: bot.id,
            workspaceId: input.workspaceId,
            roomId: conversationMention?.message.roomId ?? null,
            requesterId,
          };
    // A person asking, owner or teammate, has their own offers in this
    // room: intents are scoped to (room, requester), so a teammate's "yes"
    // reaches only what the bot offered them. Another assistant never does.
    const pendingIntents =
      input.chat?.askedByBot || intentScope === null
        ? []
        : await prisma.sokoBotIntent.findMany({
            where: {
              ...intentScope,
              ...memberAnswerableIntentWhere(bot),
              state: "AWAITING_CONFIRMATION",
              expiresAt: { gt: await databaseNow() },
            },
            take: 3,
            select: {
              id: true,
              desiredOutcome: true,
              targetIds: true,
              expiresAt: true,
              originatingTurn: {
                select: {
                  route: true,
                  classification: true,
                  capabilityNames: true,
                },
              },
              decisions: {
                where: { status: "PENDING" },
                select: { id: true },
                take: 2,
              },
            },
          });
    // The bot's last word to this person in this conversation: a bare "yes,
    // post it" is only classifiable against the question it answers. Chat
    // turns a person asked for only — a briefing's text comes from mail, and
    // a "yes" must not confirm what a stranger wrote into it — scoped to the
    // same requester, owner or teammate, and only the newest one, so a failed
    // turn never lets "yes" reach back to an older offer.
    const previousTurn =
      source === "CHAT" && !input.chat?.askedByBot
        ? await prisma.sokoBotTurn.findFirst({
            where: {
              sokoBotId: bot.id,
              requestedByUserId: input.userId,
              workspaceId: input.workspaceId,
              source: "CHAT",
              createdAt: {
                gte: new Date(
                  (await databaseNow()).getTime() - PREVIOUS_REPLY_WINDOW_MS,
                ),
              },
              ...(askedByUserId !== undefined ? { askedByUserId } : {}),
              ...(conversationMention?.message.roomId
                ? {
                    chatMention: {
                      message: { roomId: conversationMention.message.roomId },
                    },
                  }
                : { chatMentionId: null }),
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              status: true,
              finalAnswer: true,
              modelReason: true,
              createdAt: true,
            },
          })
        : null;
    const classifierContext = await loadClassificationContext(
      sokoBotTurnReader(
        input.userId,
        askedByTeammate ? "TEAMMATE" : "OWNER",
        sokoBotSharedScopeOf(bot),
      ),
      input.workspaceId,
      [
        input.chat?.classifyMessage ?? message,
        ...pendingIntents.flatMap((intent) =>
          Array.isArray(intent.targetIds)
            ? intent.targetIds.filter(
                (id): id is string => typeof id === "string",
              )
            : [],
        ),
      ].join(" "),
    );
    const classification: ClassificationResult = input.presetRoute
      ? presetClassificationResult(message, input.presetRoute)
      : await withEvaluationActor(
          { userId: input.userId, sokoBotId: bot.id, clientTurnId, source },
          () =>
            this.classifier.classify(input.chat?.classifyMessage ?? message, {
              ...classifierContext,
              previousReply:
                previousTurn?.status === "COMPLETED"
                  ? previousTurn.finalAnswer
                  : null,
              pendingIntents: pendingIntents.map((intent) => ({
                id: intent.id,
                desiredOutcome: intent.desiredOutcome,
                targetIds: Array.isArray(intent.targetIds)
                  ? intent.targetIds.filter(
                      (id): id is string =>
                        typeof id === "string" &&
                        classifierContext.taskIds.includes(id),
                    )
                  : [],
                expiresAt: intent.expiresAt.toISOString(),
                route: intent.originatingTurn.route ?? "CLARIFY",
                writeScope: storedWriteScope(
                  intent.originatingTurn.classification,
                ),
                requiresApproval: intent.decisions.length > 0,
              })),
            }),
        );
    // Every Task the name matches is a candidate. Several matches used to
    // force CLARIFY, which turned "archive all my [TEST] tasks" into a
    // question; the bot sees the candidates and asks only when the owner
    // meant one of them.
    if (
      classification.classification.route === "MANAGE_WORK" &&
      classifierContext.namedTaskIds.length
    ) {
      classification.classification = {
        ...classification.classification,
        candidateTaskIds: classifierContext.namedTaskIds,
      };
    }
    // A person asking in chat — owner or teammate — gets every tool. Jev's
    // route is a hint for the bot and the record, not a gate: a misread
    // "yes, go ahead" must not leave the bot saying it cannot create the
    // table it just offered. Only turns nobody typed — schedules, events,
    // ingest, another assistant — stay scoped to their route.
    const personAsked =
      source === "CHAT" &&
      !input.presetRoute &&
      !input.chat?.askedByBot &&
      (input.chat?.chainDepth ?? 0) === 0;
    if (personAsked) {
      const { unsureRoute: _unsure, ...hint } = classification.classification;
      classification.classification = hint;
    }
    if (source === "SCHEDULE" && classification.failed) {
      throw new SokoBotRetryableStartError(
        "Soko Bot classifier unavailable for scheduled turn",
      );
    }
    // A teammate asking someone else's bot gets the same tools the owner
    // would: the turn runs as the owner, on the owner's credits and accounts,
    // and the owner's console shows who asked. Only another assistant asking
    // stays read-only, so assistants cannot drive each other in a loop.

    // Self-started turns keep every capability of their route, hiring
    // included. Withholding only `hire_agent` read as a spend limit and was
    // not one: assigning a Task to a Coworker bills the owner just as a hire
    // does, and stayed available throughout — so untrusted mail text that
    // could route a scheduled turn onto a purchase could always reach that
    // path instead. What bounds the spend is the owner's daily cap and pause,
    // and what tempers it is the version prompt, which now weighs delegation
    // and hiring alike rather than calling delegation free.
    // Work the bot decided to do rather than work a person asked for. Both the
    // preflight below and the reservation that binds are judged by this.
    // A behaviour-lab run wears the source the real rhythm would, so the turn
    // is classified and capability-scoped the same way — but it is a person
    // pressing a button, not the bot deciding. The allowance already excludes
    // these from its count; enforcing the cap against them too would leave the
    // lab working below the limit and refusing above it, which is exactly when
    // somebody needs it.
    const isLabRun = clientTurnId.startsWith("lab:");
    const unpromptedWork =
      !isLabRun &&
      (input.chat?.askedByBot === true ||
        input.source === "SCHEDULE" ||
        input.source === "EVENT" ||
        input.source === "INGEST");
    // A turn another assistant asked for is unprompted work, so the owner's
    // brakes govern it — counting it without enforcing would leave a setting
    // they can see doing nothing to the turn it is meant to stop.
    if (input.chat?.askedByBot) {
      const { proactiveGate } = await import(
        "@/services/soko-bot-proactive.service"
      );
      const gate = await proactiveGate(bot.id);
      if (!gate.ok) {
        throw new SokoBotBusyError(
          gate.reason === "daily-limit"
            ? "This Soko Bot has reached its owner's daily limit"
            : "This Soko Bot's owner has paused unprompted work",
        );
      }
    }
    // A confirmed proposal resumes with the tools its own turn had, so a
    // "yes" to a stand-up's offer cannot reopen the stand-up's full route.
    const confirmedWrites = pendingIntents
      .find(
        (intent) =>
          intent.id === classification.classification.selectedIntentId,
      )
      ?.originatingTurn.capabilityNames.filter(isSokoBotCapability);
    const writes = input.presetRoute?.writes ?? confirmedWrites;
    // Cuso (CMO) has no personal reach: his version lists only marketing
    // tools, and the owner approved the strategy he executes. An owner's chat
    // request ("announce this on Tuesday") gets his whole toolset instead of
    // whatever narrower write scope the classifier guessed, so he does the
    // work instead of asking permission for it.
    const cmoOwnerRequest =
      version.profile === "cmo" &&
      !input.presetRoute &&
      !input.chat?.askedByBot &&
      !unpromptedWork;
    const classified = capabilitiesForClassification(
      cmoOwnerRequest
        ? {
            ...classification.classification,
            route: "MANAGE_WORK",
            writeScope: "WORK",
          }
        : classification.classification,
    );
    const routeCapabilities = (
      personAsked
        ? SOKO_BOT_CAPABILITIES
        : input.presetRoute?.capabilities
          ? input.presetRoute.capabilities
          : writes
            ? limitSokoBotWrites(classified, writes)
            : classified
    ).filter(
      (capability) =>
        !input.presetRoute ||
        input.presetRoute.sandbox === true ||
        !(SOKO_BOT_SANDBOX_CAPABILITIES as readonly string[]).includes(
          capability,
        ),
    );
    const newsletterAvailable =
      routeCapabilities.some(isSokoBotNewsletterCapability) &&
      (await isNewsletterDraftAvailable({
        workspaceId: input.workspaceId,
        projectId: bot.projectId,
      }));
    const competitorsAvailable =
      version.profile === "cmo" ||
      (routeCapabilities.some(isSokoBotCompetitorCapability) &&
        (await competitorChecksOnFor({
          projectId: bot.projectId,
          workspaceId: input.workspaceId,
        })));
    const capabilities = applyVersionCapabilities(
      version,
      (input.chat?.askedByBot
        ? [...SOKO_BOT_BOT_TO_BOT_CAPABILITIES]
        : input.ownScheduleId
          ? withOwnScheduleTools(routeCapabilities)
          : routeCapabilities) as readonly SokoBotCapability[],
    ).filter(
      (capability) =>
        input.presetRoute?.systemKey !== "meeting-prep" &&
        (!isSokoBotNewsletterCapability(capability) || newsletterAvailable) &&
        (!isSokoBotCompetitorCapability(capability) || competitorsAvailable) &&
        (!isSokoBotAnnouncementCapability(capability) ||
          isAnnouncementBot(bot.id)) &&
        // Without a key `search_exa` refuses on every call; offer web_search only.
        (capability !== "search_exa" || Boolean(getEnv().EXA_API_KEY)),
    ) as readonly SokoBotCapability[];
    const startNow = (await databaseNow()).getTime();
    const deadlineAt = new Date(
      startNow +
        (input.background
          ? BACKGROUND_RUN_DEADLINE_MS
          : personAsked || input.personStarted
            ? PERSON_TURN_DEADLINE_MS
            : TURN_DEADLINE_MS),
    );
    const leaseToken = randomUUID();
    // Eve only offers create-operation idempotency. A fresh session per Core
    // turn makes ambiguous retries exactly-once; Context carries bounded prior
    // conversation and durable memory supplies continuity across sessions.
    const sessionIdForTurn = null;
    // Build fallible context before publishing a durable STARTING turn. The
    // snapshot is then committed with the turn, leaving no crash window where
    // a recovery worker lacks the immutable packet needed for exact replay.
    const destinationAudience = destinationRoom
      ? await prisma.chatRoom.findUnique({
          where: { id: destinationRoom.id },
          select: {
            userMembers: { select: { userId: true } },
            coworkerMembers: { select: { coworkerId: true } },
            sokoBotMembers: { select: { sokoBotId: true } },
          },
        })
      : null;
    // A mute or standing instruction the owner typed is saved before the turn
    // reads memory, whether or not the model would have thought to.
    const capturedPreference =
      personAsked &&
      !askedByTeammate &&
      (classification.classification.signals?.statesPreference ?? 0) >=
        MIN_PREFERENCE_CONFIDENCE
        ? await capturePreference({
            sokoBotId: bot.id,
            message: input.chat?.classifyMessage ?? message,
          })
        : null;
    const context = await this.contextBuilder.build({
      userId: input.userId,
      sokoBotId: bot.id,
      sharedScope: sokoBotSharedScopeOf(bot),
      workspaceId: input.workspaceId,
      source: input.source ?? "CHAT",
      clientTurnId,
      classification: classification.classification,
      personAsked,
      capturedPreference,
      turnMessage: input.chat?.said ?? input.chat?.classifyMessage ?? message,
      previousReply:
        previousTurn?.status === "COMPLETED" ? previousTurn.finalAnswer : null,
      audience: askedByTeammate ? "TEAMMATE" : "OWNER",
      askedByKind: input.chat?.askedByBot
        ? "ASSISTANT"
        : askedByTeammate
          ? "TEAMMATE"
          : "OWNER",
      askedByUserId: input.chat?.askedByUserId ?? null,
      // A teammate's follow-up reads the room it answers in, never the
      // owner's own chat.
      roomId:
        conversationMention?.message.roomId ??
        (askedByTeammate
          ? (input.background?.destinationRoomId ?? null)
          : null),
      referencedTaskIds: [
        ...new Set([
          ...classifierContext.namedTaskIds,
          ...classifierContext.taskIds.filter((id) => message.includes(id)),
          ...(classification.classification.candidateTaskIds ?? []).filter(
            (id) => classifierContext.taskIds.includes(id),
          ),
        ]),
      ],
    });
    const contextSnapshotId = randomUUID();

    let turn;
    try {
      const reservation = await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM ${sharedTable("soko_bot")}
          WHERE "id" = ${bot.id}::uuid
          FOR UPDATE
        `;
        // One sample under the bot lock: the daily cap's day start and the
        // new turn's createdAt and initial lease share it.
        const reservedAt = await databaseNow(tx);
        const currentBot = await tx.sokoBot.findUnique({
          where: { id: bot.id },
          select: {
            archivedAt: true,
            adminPausedAt: true,
            status: true,
            proactivePaused: true,
            proactiveDailyLimit: true,
            ingestTimezone: true,
          },
        });
        if (
          !currentBot ||
          currentBot.archivedAt ||
          currentBot.adminPausedAt ||
          currentBot.status === "PAUSED"
        ) {
          throw new SokoBotBusyError("Soko Bot is paused");
        }
        // The preflight gate is only advice by the time we get here: building
        // context takes long enough for the owner to have paused, or for a
        // second unprompted turn to have used the last slot. This row is
        // locked FOR UPDATE, so recounting here is the decision that binds.
        if (unpromptedWork) {
          if (
            currentBot.proactivePaused ||
            getEnv().SOKO_BOT_PROACTIVE_PAUSED
          ) {
            throw new SokoBotBusyError(
              "This Soko Bot's owner has paused unprompted work",
            );
          }
          const { localDayStart } = await import(
            "@/services/soko-bot-proactive.service"
          );
          const usedToday = await tx.sokoBotTurn.count({
            where: {
              sokoBotId: bot.id,
              createdAt: {
                gte: localDayStart(reservedAt, currentBot.ingestTimezone),
              },
              clientTurnId: { not: { startsWith: "lab:" } },
              OR: [
                { source: { in: ["SCHEDULE", "EVENT", "INGEST"] } },
                { chainDepth: { gt: 0 } },
              ],
            },
          });
          if (usedToday >= currentBot.proactiveDailyLimit) {
            throw new SokoBotBusyError(
              "This Soko Bot has reached its owner's daily limit",
            );
          }
        }
        if (input.background) {
          const running = await tx.sokoBotTurn.count({
            where: {
              sokoBotId: bot.id,
              parentTurnId: { not: null },
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
          });
          if (running >= MAX_ACTIVE_BACKGROUND_RUNS)
            throw new SokoBotBusyError(
              `${MAX_ACTIVE_BACKGROUND_RUNS} background runs are already working; wait for one or stop one first`,
            );
        } else {
          const active = await tx.sokoBotTurn.findFirst({
            where: {
              sokoBotId: bot.id,
              ...FOREGROUND_TURN,
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
            select: { id: true },
          });
          if (active)
            throw new SokoBotTurnInProgressError("Soko Bot is already working");
        }
        const memoryVersion = context.packet.memory.version;
        const memoryRevision = requireContextMemoryRevision(
          memoryVersion,
          memoryVersion === 0
            ? null
            : await tx.sokoBotMemoryRevision.findUnique({
                where: {
                  sokoBotId_version: {
                    sokoBotId: bot.id,
                    version: memoryVersion,
                  },
                },
                select: { id: true, version: true },
              }),
        );
        const turnModel = chooseTurnModel({
          version,
          clientTurnId,
          preset: input.presetRoute !== undefined,
          background: input.background !== undefined,
          classification: classification.classification,
          previous: previousTurn,
          now: reservedAt,
        });
        const created = await tx.sokoBotTurn.create({
          data: {
            sokoBotId: bot.id,
            requestedByUserId: input.userId,
            workspaceId: input.workspaceId,
            source,
            status: "STARTING",
            route: classification.classification.route,
            clientTurnId,
            versionId: version.id,
            modelId: turnModel.model,
            modelReason: turnModel.reason,
            createdAt: reservedAt,
            userMessage: message,
            destinationRoomId: destinationRoom?.id ?? null,
            ...(destinationAudience
              ? {
                  destinationAudience: {
                    userIds: destinationAudience.userMembers
                      .map((m) => m.userId)
                      .sort(),
                    coworkerIds: destinationAudience.coworkerMembers
                      .map((m) => m.coworkerId)
                      .sort(),
                    botIds: destinationAudience.sokoBotMembers
                      .map((m) => m.sokoBotId)
                      .sort(),
                  },
                }
              : {}),
            ...(input.chat?.mentionId !== undefined
              ? { chatMentionId: input.chat.mentionId }
              : {}),
            ...(input.chat?.responseMessageId !== undefined
              ? { chatResponseMessageId: input.chat.responseMessageId }
              : {}),
            ...(askedByUserId !== undefined ? { askedByUserId } : {}),
            chainDepth: input.chat?.chainDepth ?? 0,
            parentTurnId: input.background?.parentTurnId ?? null,
            backgroundTitle: input.background?.title ?? null,
            classification: jsonInput(classification.classification),
            classifierModel: classification.model,
            classifierVersion: classification.version,
            classifierLatencyMs: classification.latencyMs,
            classificationFailed: classification.failed,
            // Seeds the turn's usage before the agent loop starts. The drain
            // reads this row's `usage` as its starting aggregate, so the
            // classifier's tokens survive every later step write. Its cost is
            // deliberately kept out of `costUsdMicros`, which is what the
            // owner is billed for.
            ...(classification.usage
              ? {
                  usage: jsonInput({
                    inputTokens: classification.usage.inputTokens,
                    outputTokens: classification.usage.outputTokens,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    costUsd: classification.usage.costUsd,
                  }),
                  overheadCostUsdMicros: BigInt(
                    Math.round(classification.usage.costUsd * 1_000_000),
                  ),
                }
              : {}),
            capabilityNames: [...capabilities],
            eveSessionId: sessionIdForTurn,
            eveStreamIndex: -1,
            deadlineAt,
            leaseToken,
            leaseExpiresAt: new Date(reservedAt.getTime() + TURN_LEASE_MS),
            reconcilerHeartbeatAt: reservedAt,
            contextSnapshot: {
              create: {
                id: contextSnapshotId,
                generatedAt: new Date(context.packet.generatedAt),
                schemaVersion: context.packet.schemaVersion,
                hash: context.packet.hash,
                packet: jsonInput(context.packet),
                byteSize: context.byteSize,
                tokenEstimate: context.tokenEstimate,
                counts: jsonInput(context.counts),
                omissions: jsonInput(context.omissions),
              },
            },
          },
        });
        for (const occurrence of input.eventBatch ?? []) {
          await tx.sokoBotEventInbox.create({
            data: {
              botId: bot.id,
              turnId: created.id,
              eventId: occurrence.eventId,
              entityId: occurrence.entityId,
              purpose: occurrence.purpose,
              designatedHandlerBotId: occurrence.designatedHandlerBotId,
            },
          });
          await invalidateSokoBotIntentOutcomes(tx, {
            sokoBotId: bot.id,
            workspaceId: input.workspaceId,
            targetId: occurrence.entityId,
            evidenceId: occurrence.eventId,
          });
          if (occurrence.delegationIds?.length) {
            await tx.sokoBotDelegation.updateMany({
              where: {
                id: { in: occurrence.delegationIds },
                turn: { sokoBotId: bot.id, workspaceId: input.workspaceId },
              },
              data: {
                lastSeenStatus: occurrence.status,
                lastSeenEventId: occurrence.eventId,
                ...(occurrence.delegationEventAt !== undefined
                  ? { lastSeenEventAt: occurrence.delegationEventAt }
                  : {}),
              },
            });
          }
          if (occurrence.followUpDelegationIds?.length) {
            const claimed = await tx.sokoBotDelegation.updateMany({
              where: {
                id: { in: occurrence.followUpDelegationIds },
                followUp: { not: null },
                followUpTurnId: null,
                turn: { sokoBotId: bot.id, workspaceId: input.workspaceId },
              },
              data: { followUpTurnId: created.id },
            });
            // Another turn took a plan first; the next tick rebuilds the
            // message without it rather than running it twice.
            if (claimed.count !== occurrence.followUpDelegationIds.length)
              throw new SokoBotBusyError(
                "A follow-up plan in this batch was already handed over",
              );
          }
          if (occurrence.taskCursorAt) {
            await tx.sokoBotTaskWatch.upsert({
              where: {
                sokoBotId_taskId: {
                  sokoBotId: bot.id,
                  taskId: occurrence.entityId,
                },
              },
              create: {
                sokoBotId: bot.id,
                taskId: occurrence.entityId,
                lastSeenStatus: occurrence.status,
                lastSeenEventAt: occurrence.taskCursorAt,
                lastSeenEventId: occurrence.eventId,
              },
              update: {
                lastSeenStatus: occurrence.status,
                lastSeenEventAt: occurrence.taskCursorAt,
                lastSeenEventId: occurrence.eventId,
              },
            });
          }
        }
        const selectedIntentId = classification.classification.selectedIntentId;
        if (intentScope === null) {
          // No requester: no offer to select, withdraw or make.
        } else if (selectedIntentId) {
          const selected = await tx.sokoBotIntent.findFirst({
            where: {
              id: selectedIntentId,
              ...intentScope,
              ...memberAnswerableIntentWhere(bot),
              state: "AWAITING_CONFIRMATION",
              expiresAt: { gt: await databaseNow(tx) },
            },
          });
          if (!selected)
            throw new SokoBotBusyError(
              "Pending intent changed; retry with explicit scope",
            );
          await tx.sokoBotTurn.update({
            where: { id: created.id },
            data: { intentId: selected.id, intentRevision: selected.revision },
          });
        } else {
          // Only an explicit owner withdrawal or replacement, as Jev read the
          // message, affects an existing offer.
          const withdrawsUniqueOffer =
            source === "CHAT" &&
            !input.chat?.askedByBot &&
            (input.chat?.chainDepth ?? 0) === 0 &&
            pendingIntents.length === 1 &&
            classification.classification.continuation === "CANCEL";
          // A bare "cancel that" routes to CLARIFY; "instead, do X" carries X's
          // route and supersedes the offer rather than just cancelling it.
          const cancelsOffer =
            classification.classification.route === "CLARIFY";
          if (withdrawsUniqueOffer) {
            await tx.sokoBotPendingDecision.updateMany({
              where: {
                status: "PENDING",
                intent: {
                  id: pendingIntents[0].id,
                  ...intentScope,
                  state: "AWAITING_CONFIRMATION",
                },
              },
              data: {
                status: "REJECTED",
                resolvedAt: new Date(),
                resolvedByUserId: intentScope.requesterId,
              },
            });
            await tx.sokoBotIntent.updateMany({
              where: {
                id: pendingIntents[0].id,
                ...intentScope,
                state: "AWAITING_CONFIRMATION",
              },
              data: {
                state: cancelsOffer ? "CANCELLED" : "SUPERSEDED",
                revision: { increment: 1 },
              },
            });
          }
          const intent = await tx.sokoBotIntent.create({
            data: {
              ...intentScope,
              originatingTurnId: created.id,
              desiredOutcome: classification.classification.requestedOutcome,
              targetIds: [
                ...(classification.classification.candidateTaskIds ?? []),
                ...classifierContext.taskIds.filter((id) =>
                  message.includes(id),
                ),
                ...classification.classification.candidateProjectIds,
                ...classification.classification.candidateCoworkerIds,
                ...classification.classification.candidateAgentIds,
              ],
              allowedActions: [...capabilities],
              acceptanceCriteria: [
                "DELEGATE_TASK",
                "HIRE_AGENT",
                "MANAGE_WORK",
              ].includes(classification.classification.route)
                ? [
                    {
                      kind: "OUTCOME",
                      id: "requested-outcome",
                      description:
                        classification.classification.requestedOutcome,
                    },
                  ]
                : [],
              evidenceIds: [],
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
          await tx.sokoBotTurn.update({
            where: { id: created.id },
            data: { intentId: intent.id, intentRevision: intent.revision },
          });
        }
        await this.bindTurnReservation(tx, input, bot.id, created.id, message);
        // A background run leaves the chat's status and session alone.
        const acquired = await tx.sokoBot.updateMany({
          where: {
            id: bot.id,
            archivedAt: null,
            adminPausedAt: null,
            status: { not: "PAUSED" },
          },
          data: input.background
            ? { lastActivityAt: new Date() }
            : {
                status: "RUNNING",
                lastActivityAt: new Date(),
                lastTurnAt: new Date(),
              },
        });
        if (acquired.count === 0) {
          throw new SokoBotBusyError("Soko Bot is paused");
        }
        return { turn: created, memoryRevision };
      }, "Soko Bot turn collided with another request");
      turn = reservation.turn;
      if (classification.model)
        await recordModelCall({
          turnId: turn.id,
          role: "classifier",
          label: classification.version,
          requestedModel: classification.model,
          providerMetadata: classification.usage?.providerMetadata,
          usage: classification.usage ?? undefined,
          costUsd: classification.usage?.costUsd ?? 0,
          failed: classification.failed,
        });
    } catch (error) {
      // Another request with this idempotency key may have committed between
      // the optimistic read and serializable acquisition. Return its durable
      // result instead of surfacing a false busy/conflict response.
      const racedDuplicate = await prisma.sokoBotTurn.findUnique({
        where: {
          sokoBotId_clientTurnId: {
            sokoBotId: bot.id,
            clientTurnId,
          },
        },
      });
      if (racedDuplicate) {
        if (
          !matchesReservedTurnMessage(
            racedDuplicate,
            message,
            input.presetRoute,
          ) ||
          racedDuplicate.workspaceId !== input.workspaceId ||
          racedDuplicate.source !== source
        ) {
          throw new SokoBotIdempotencyConflictError(
            "Client turn id was already used for different input",
          );
        }
        await this.bindResolvedScheduleReservation(
          input,
          bot.id,
          racedDuplicate.id,
          racedDuplicate.userMessage,
        );
        return observedStartResult(racedDuplicate, bot.eveSessionId);
      }
      throw error;
    }

    let acceptedSessionId: string | undefined;
    const stopRenewing = this.holdTurnLease(turn.id, leaseToken);
    try {
      if (
        classification.classification.selectedIntentId &&
        source === "CHAT" &&
        !askedByTeammate &&
        !input.chat?.askedByBot &&
        (input.chat?.chainDepth ?? 0) === 0 &&
        (await this.settleOwnerConfirmation(turn.id, leaseToken))
      ) {
        const completed = await prisma.sokoBotTurn.findUniqueOrThrow({
          where: { id: turn.id },
        });
        return observedStartResult(completed, bot.eveSessionId, false);
      }
      const expectedSessionId = sessionIdForTurn ?? `pending:${turn.id}`;
      const tokenScope = {
        userId: input.userId,
        sokoBotId: bot.id,
        workspaceId: input.workspaceId,
        sessionId: expectedSessionId,
        turnId: turn.id,
      };
      const runtimeTurn = await this.startRuntimeWithAcceptanceRetry({
        ...tokenScope,
        sessionId: sessionIdForTurn,
        message,
        reconciliationLeaseToken: leaseToken,
      });
      acceptedSessionId = runtimeTurn.sessionId;
      await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM ${sharedTable("soko_bot")}
          WHERE "id" = ${bot.id}::uuid
          FOR UPDATE
        `;
        const acknowledgedAt = await databaseNow(tx);
        const acknowledged = await tx.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            status: "STARTING",
            leaseToken,
          },
          data: {
            status: "RUNNING",
            eveSessionId: runtimeTurn.sessionId,
            runtimeVersion: runtimeTurn.runtimeVersion,
            startedAt: acknowledgedAt,
            reconcilerHeartbeatAt: acknowledgedAt,
          },
        });
        if (acknowledged.count === 0) {
          throw new SokoBotStartAbortedError(
            "Soko Bot turn stopped before runtime acknowledgement",
          );
        }
        const attached = await tx.sokoBot.updateMany({
          where: {
            id: bot.id,
            archivedAt: null,
            adminPausedAt: null,
            status: { not: "PAUSED" },
          },
          data: input.background
            ? { lastActivityAt: new Date() }
            : {
                eveSessionId: runtimeTurn.sessionId,
                runtimeVersion: runtimeTurn.runtimeVersion,
                runtimeDeployment: "core",
                status: "RUNNING",
              },
        });
        if (attached.count === 0) {
          throw new SokoBotStartAbortedError(
            "Soko Bot was paused before runtime acknowledgement",
          );
        }
      }, "Soko Bot acknowledgement collided with pause or cancellation").catch(
        (error: unknown) =>
          this.requireAcknowledgedStartLease(
            turn.id,
            leaseToken,
            runtimeTurn.sessionId,
            error,
          ),
      );
      acceptedSessionId = undefined;
      // A background run starts beside the chat: the chat's session is live.
      if (!input.background)
        await this.resetSupersededRuntimeSession({
          bot,
          userId: input.userId,
          workspaceId: input.workspaceId,
          turnId: turn.id,
          currentSessionId: runtimeTurn.sessionId,
        });
      return {
        turnId: turn.id,
        sokoBotId: bot.id,
        sessionId: runtimeTurn.sessionId,
        status: "RUNNING",
        route: classification.classification.route,
        capabilities,
        duplicate: false,
        reconciliationLeaseToken: leaseToken,
      };
    } catch (error) {
      let acceptedSessionWasReset = false;
      let currentAfterAcknowledgementFailure: SokoBotTurn | null = null;
      if (acceptedSessionId !== undefined) {
        const retained = await this.retainStartLease(turn.id, leaseToken);
        currentAfterAcknowledgementFailure =
          await prisma.sokoBotTurn.findUnique({
            where: { id: turn.id },
          });
        if (!currentAfterAcknowledgementFailure) throw error;
        // The cleanup CAS checks startedAt so it cannot touch an acknowledged
        // turn, even after cancellation or takeover. A re-read conveys the state.
        if (
          !retained ||
          currentAfterAcknowledgementFailure.leaseToken !== leaseToken
        ) {
          return observedStartResult(
            currentAfterAcknowledgementFailure,
            bot.eveSessionId,
          );
        }
      }
      if (acceptedSessionId !== undefined) {
        try {
          await this.runtime.resetSession({
            sessionId: acceptedSessionId,
            reason: "Soko Bot start acknowledgement failed",
          });
          acceptedSessionWasReset = true;
        } catch (cleanupError) {
          recordCoreWarning(
            TURN_LOG,
            {
              message:
                "Could not reset the runtime session of a turn whose start was not acknowledged",
              why: "The runtime refused the reset",
              fix: "Nothing to do: the session ages out at the runtime, and the start is retried or fails on its own.",
            },
            {
              turn: { id: turn.id },
              failure: messageSafeErrorFields(cleanupError),
            },
          );
        }
      }
      if (error instanceof SokoBotStartAbortedError) {
        if (
          currentAfterAcknowledgementFailure?.status === "CANCEL_REQUESTED" &&
          !acceptedSessionWasReset
        ) {
          await prisma.sokoBotTurn.updateMany({
            where: {
              id: turn.id,
              status: "CANCEL_REQUESTED",
              leaseToken,
            },
            data: {
              ...(acceptedSessionId !== undefined
                ? { eveSessionId: acceptedSessionId }
                : {}),
              errorKind: "start_aborted",
              errorDetail: safeRuntimeDiagnostic(error.message),
              reconcilerHeartbeatAt: null,
            },
          });
        } else {
          await this.settleTurn({
            turnId: turn.id,
            status: "CANCELLED",
            errorKind: "start_aborted",
            errorDetail: error.message,
            clearSession: true,
            leaseToken,
          });
        }
      } else if (
        isAmbiguousRuntimeAcceptance(error) ||
        (acceptedSessionId !== undefined && !acceptedSessionWasReset)
      ) {
        await this.releaseStartLease(
          turn.id,
          leaseToken,
          error instanceof Error
            ? safeRuntimeDiagnostic(error.message)
            : "Eve acceptance response was lost",
        );
      } else {
        await this.failStartedTurn(turn.id, error, leaseToken);
      }
      throw error;
    } finally {
      stopRenewing();
    }
  }

  /**
   * The last persisted settlement trigger of a turn and the outcome the
   * events before it give, read with the row from one snapshot.
   */
  private async persistedSettlement(turnId: string) {
    const { row, events } = await prisma.$transaction(
      async (tx) => ({
        row: await tx.sokoBotTurn.findUnique({
          where: { id: turnId },
          select: {
            leaseToken: true,
            errorKind: true,
            errorDetail: true,
          },
        }),
        events: await tx.sokoBotEvent.findMany({
          where: {
            turnId,
            type: {
              in: [
                "turn.completed",
                "turn.cancelled",
                "turn.failed",
                ...SETTLEMENT_TRIGGER_EVENT_TYPES,
              ],
            },
          },
          orderBy: { sequence: "asc" },
          select: { type: true, providerAt: true, payload: true },
        }),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const triggerAt = events.findLastIndex((event) =>
      SETTLEMENT_TRIGGER_EVENT_TYPES.has(event.type),
    );
    if (!row || triggerAt < 0) return null;
    const before = events.slice(0, triggerAt + 1);
    const outcomeEvent = before.findLast((event) =>
      event.type.startsWith("turn."),
    );
    const failure = before.findLast((event) => event.type.endsWith(".failed"));
    // The projection keeps a failure's code; a later stream interruption can
    // overwrite the row's diagnostics, so the row's detail only goes with it.
    const code = (failure?.payload as { code?: unknown } | null)?.code;
    const failureKind = failure
      ? typeof code === "string" && code !== "unknown"
        ? code
        : "runtime_failed"
      : undefined;
    return {
      trigger: events[triggerAt].type,
      leaseToken: row.leaseToken,
      status:
        outcomeEvent?.type === "turn.failed"
          ? ("FAILED" as const)
          : outcomeEvent?.type === "turn.cancelled"
            ? ("CANCELLED" as const)
            : outcomeEvent?.type === "turn.completed"
              ? ("COMPLETED" as const)
              : null,
      completedAt:
        outcomeEvent?.type === "turn.completed"
          ? (outcomeEvent.providerAt ?? undefined)
          : undefined,
      errorKind: failureKind ?? row.errorKind ?? undefined,
      errorDetail:
        !failureKind || row.errorKind === failureKind
          ? (row.errorDetail ?? undefined)
          : undefined,
    };
  }

  async reconcileRuntimeCompletion(
    turnId: string,
    sessionId: string,
    launchLeaseToken: string,
  ): Promise<void> {
    const leaseToken = randomUUID();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM ${sharedTable("soko_bot_turn")} WHERE "id" = ${turnId}::uuid
        FOR NO KEY UPDATE
      `;
      const now = await databaseNow(tx);
      // Close can take its own launch grant or a drain that stopped renewing.
      return tx.sokoBotTurn.updateMany({
        where: {
          id: turnId,
          status: { in: ["STARTING", "RUNNING", "CANCEL_REQUESTED"] },
          eveSessionId: sessionId,
          OR: [{ leaseToken: launchLeaseToken }, staleTurnLeaseWhere(now)],
        },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + TURN_LEASE_MS),
          reconcilerHeartbeatAt: now,
        },
      });
    });
    if (!updated.count) {
      throw new SokoBotReconciliationLeaseLostError(
        "Soko Bot runtime completion did not win the lease",
      );
    }
    await this.reconcileTurn(turnId, undefined, leaseToken);
  }

  /** Checks run while draining (claim check, receipts) record on the turn. */
  async reconcileTurn(
    turnId: string,
    signal: AbortSignal | undefined,
    leaseToken: string,
  ): Promise<void> {
    return withModelCallTurn(turnId, () =>
      this.drainTurn(turnId, signal, leaseToken),
    );
  }

  private async drainTurn(
    turnId: string,
    signal: AbortSignal | undefined,
    leaseToken: string,
  ): Promise<void> {
    const turn = await prisma.sokoBotTurn.findUnique({ where: { id: turnId } });
    // When a caller has settled the turn and cleared the lease, nothing is
    // left for another drain that was already queued under that same lease.
    if (
      turn &&
      !turn.leaseToken &&
      (turn.status === "COMPLETED" ||
        turn.status === "CANCELLED" ||
        turn.status === "FAILED")
    ) {
      return;
    }
    if (turn && turn.leaseToken !== leaseToken) {
      throw new SokoBotReconciliationLeaseLostError(
        "Soko Bot reconciliation lease was replaced",
      );
    }
    // Legacy observers can read the turn before the first caller's runtime
    // acknowledged it. That caller reconciles once it has a session. Only the
    // first start, under its live lease: a recovery claim sets the heartbeat
    // and errorKind. Before renewal was introduced, the first start only
    // stamped createdAt.
    if (
      turn?.status === "STARTING" &&
      !turn.eveSessionId &&
      turn.errorKind === null &&
      turn.leaseExpiresAt !== null
    ) {
      const now = await databaseNow();
      if (
        turn.leaseExpiresAt > now &&
        (turn.reconcilerHeartbeatAt ?? turn.createdAt).getTime() >
          now.getTime() - SOKO_BOT_TURN_STALE_HEARTBEAT_MS
      ) {
        return;
      }
    }
    if (!turn?.eveSessionId || !turn.leaseToken) {
      throw new SokoBotNotFoundError("Runtime turn not found");
    }
    const eveSessionId = turn.eveSessionId;

    let pendingErrorKind = turn.errorKind ?? undefined;
    let pendingErrorDetail = turn.errorDetail ?? undefined;
    let boundEveTurnId = turn.eveTurnId;
    let candidateTurnStarted: IndexedRuntimeEvent | null = null;

    const deliverBoundCancellation = async (): Promise<void> => {
      if (!boundEveTurnId) return;
      const current = await prisma.sokoBotTurn.findUnique({
        where: { id: turn.id },
        select: { status: true, leaseToken: true },
      });
      if (current?.status !== "CANCEL_REQUESTED") return;
      if (current.leaseToken !== leaseToken) {
        throw new SokoBotReconciliationLeaseLostError(
          "Soko Bot reconciliation lease was lost",
        );
      }
      try {
        await this.runtime.cancelTurn({
          sessionId: eveSessionId,
          eveTurnId: boundEveTurnId,
        });
      } catch (error) {
        emitCoreWarning(
          TURN_LOG,
          {
            message:
              "Could not redeliver a Soko Bot turn's cancellation to the runtime",
            why: "The runtime refused the cancel",
            fix: "The next reconcile redelivers it, and the turn's deadline ends it otherwise.",
          },
          { turn: { id: turn.id }, failure: messageSafeErrorFields(error) },
        );
      }
    };

    // Inside an event write it is the fence: the UPDATE locks the turn row,
    // so the usage read after it sees what a previous event writer committed.
    const heartbeat = async (
      client: Prisma.TransactionClient = prisma,
    ): Promise<void> => {
      const held = await this.renewTurnLease(turn.id, leaseToken, client, {
        status: { in: [...ACTIVE_TURN_STATUSES] },
      });
      if (!held) {
        throw new SokoBotReconciliationLeaseLostError(
          "Soko Bot reconciliation lease was lost",
        );
      }
    };

    // A writer that lags behind replays a lower index: it never moves the
    // cursor back.
    const advanceCursor = (tx: Prisma.TransactionClient, streamIndex: number) =>
      tx.sokoBotTurn.updateMany({
        where: { id: turn.id, eveStreamIndex: { lt: streamIndex } },
        data: { eveStreamIndex: streamIndex },
      });

    // Adds a step's usage to the locked row's totals, never to a copy read
    // before another writer added its own step.
    const usageAfterStep = async (
      tx: Prisma.TransactionClient,
      event: IndexedRuntimeEvent["event"],
    ): Promise<Prisma.SokoBotTurnUpdateInput> => {
      const current = await tx.sokoBotTurn.findUnique({
        where: { id: turn.id },
        select: { usage: true, costUsdMicros: true },
      });
      const nextUsage = addTurnUsage(
        parseTurnUsage(current?.usage),
        event.data.usage,
        event.data.modelId,
      );
      if (!nextUsage) return {};
      return {
        usage: jsonInput(nextUsage),
        costUsdMicros:
          (current?.costUsdMicros ?? 0n) +
          BigInt(
            Math.round(
              nonnegativeNumber(
                (event.data.usage as Record<string, unknown>).costUsd,
              ) * 1_000_000,
            ),
          ),
      };
    };

    const persistEvent = async (
      indexed: IndexedRuntimeEvent,
      data: Prisma.SokoBotTurnUpdateInput = {},
    ): Promise<boolean> => {
      return prisma.$transaction(async (tx) => {
        const { summary, payload, toolName, toolCallId, toolStatus } =
          safeEventProjection(indexed.event.type, indexed.event.data);
        const persisted = await tx.sokoBotEvent.createMany({
          data: [
            {
              turnId: turn.id,
              eveEventId:
                indexed.event.meta.id ||
                `legacy:${turn.eveSessionId}:${indexed.startIndex}`,
              eveStartIndex: indexed.startIndex,
              sequence: indexed.startIndex,
              type: indexed.event.type,
              summary,
              ...(payload !== undefined ? { payload } : {}),
              ...(toolName !== undefined ? { toolName } : {}),
              ...(toolCallId !== undefined ? { toolCallId } : {}),
              ...(toolStatus !== undefined ? { toolStatus } : {}),
              providerAt: new Date(indexed.event.meta.at),
            },
          ],
          skipDuplicates: true,
        });
        // Insert, then fence: the order every release writes in, so a writer
        // from the release before cannot deadlock with this one. A failed
        // fence rolls the insert back.
        await heartbeat(tx);
        const persistedNew = persisted.count === 1;
        if (persistedNew) {
          const update = {
            ...data,
            ...(indexed.event.type === "step.completed"
              ? await usageAfterStep(tx, indexed.event)
              : {}),
          };
          if (Object.keys(update).length > 0)
            await tx.sokoBotTurn.update({
              where: { id: turn.id },
              data: update,
            });
        }
        await advanceCursor(tx, indexed.startIndex);
        return persistedNew;
      });
    };

    const advancePastUnownedEvent = (streamIndex: number) =>
      prisma.$transaction(async (tx) => {
        await heartbeat(tx);
        await advanceCursor(tx, streamIndex);
      });

    // Settles on a runtime marker that ends the turn: the one the stream
    // just yielded, or one a drain persisted before it died.
    const settleOnTrigger = async (
      type: string,
      outcome: {
        status: TerminalSokoBotTurnStatus | null;
        completedAt?: Date;
        errorKind?: string;
        errorDetail?: string;
      },
    ): Promise<void> => {
      if (type === "input.requested") {
        try {
          await this.runtime.cancelTurn({
            sessionId: eveSessionId,
            eveTurnId: boundEveTurnId ?? undefined,
          });
        } catch (error) {
          emitCoreWarning(
            TURN_LOG,
            {
              message:
                "Could not cancel a Soko Bot turn that asked for input it cannot get",
              why: "The runtime refused the cancel",
              fix: "The turn is still settled as failed; the runtime stops it at its own limit.",
            },
            { turn: { id: turn.id }, failure: messageSafeErrorFields(error) },
          );
        }
        await this.settleOwnedTurn({
          turnId: turn.id,
          status: "FAILED",
          errorKind: "runtime_input_unsupported",
          errorDetail:
            "Eve requested interactive input outside the Soko Bot decision protocol",
          clearSession: true,
          leaseToken,
        });
        return;
      }
      if (type === "session.waiting") {
        await this.settleOwnedTurn({
          turnId: turn.id,
          status: outcome.status ?? "COMPLETED",
          errorKind: outcome.errorKind,
          errorDetail: outcome.errorDetail,
          providerCompletedAt: outcome.completedAt,
          leaseToken,
        });
        return;
      }
      await this.settleOwnedTurn({
        turnId: turn.id,
        status:
          type === "session.failed"
            ? "FAILED"
            : (outcome.status ?? "COMPLETED"),
        errorKind: outcome.errorKind,
        errorDetail: outcome.errorDetail,
        providerCompletedAt: outcome.completedAt,
        clearSession: true,
        leaseToken,
      });
    };

    // Fenced writes below remain authoritative. Timer failures surface on
    // next event or watchdog takeover without creating an unhandled task.
    const stopRenewing = this.holdTurnLease(turn.id, leaseToken);
    try {
      await heartbeat();
      const checkpoint = await this.persistedSettlement(turn.id);
      if (checkpoint) {
        if (checkpoint.leaseToken !== leaseToken) {
          throw new SokoBotReconciliationLeaseLostError(
            "Soko Bot reconciliation lease was lost",
          );
        }
        await settleOnTrigger(checkpoint.trigger, checkpoint);
        return;
      }
      const priorTerminalEvent = await prisma.sokoBotEvent.findFirst({
        where: {
          turnId: turn.id,
          type: { in: ["turn.completed", "turn.cancelled", "turn.failed"] },
        },
        orderBy: { sequence: "desc" },
        select: { type: true, providerAt: true },
      });
      let pendingStatus: TerminalSokoBotTurnStatus | null =
        priorTerminalEvent?.type === "turn.failed"
          ? "FAILED"
          : priorTerminalEvent?.type === "turn.cancelled"
            ? "CANCELLED"
            : priorTerminalEvent?.type === "turn.completed"
              ? "COMPLETED"
              : null;
      let pendingCompletedAt =
        priorTerminalEvent?.type === "turn.completed"
          ? (priorTerminalEvent.providerAt ?? undefined)
          : undefined;
      await deliverBoundCancellation();
      for await (const indexed of this.runtime.streamEvents({
        sessionId: turn.eveSessionId,
        startIndex: turn.eveStreamIndex + 1,
        signal,
        reconciliation: { turnId, leaseToken },
      })) {
        if (!boundEveTurnId) {
          if (indexed.event.type === "turn.started") {
            candidateTurnStarted = indexed;
            continue;
          }
          if (
            candidateTurnStarted &&
            indexed.event.type === "message.received"
          ) {
            const unclaimedCandidateTurnId =
              typeof candidateTurnStarted.event.data.turnId === "string"
                ? candidateTurnStarted.event.data.turnId
                : null;
            const alreadyOwned = unclaimedCandidateTurnId
              ? await prisma.sokoBotTurn.findFirst({
                  where: {
                    id: { not: turn.id },
                    sokoBotId: turn.sokoBotId,
                    eveSessionId: turn.eveSessionId,
                    eveTurnId: unclaimedCandidateTurnId,
                  },
                  select: { id: true },
                })
              : null;
            const candidateTurnId = matchSokoBotRuntimeTurnBoundary({
              turnStarted: candidateTurnStarted,
              messageReceived: indexed,
              expectedMessage: turn.userMessage,
              alreadyOwned: Boolean(alreadyOwned),
            });
            if (candidateTurnId) {
              await persistEvent(candidateTurnStarted, {
                eveTurnId: candidateTurnId,
              });
              await persistEvent(indexed);
              boundEveTurnId = candidateTurnId;
              candidateTurnStarted = null;
              await deliverBoundCancellation();
              continue;
            }
            candidateTurnStarted = null;
          }
          await advancePastUnownedEvent(indexed.startIndex);
          continue;
        }

        // Eve delta events are transient presentation artifacts. Persisting
        // each token creates DB write amplification and duplicate UI rows. A
        // later durable event advances the cursor across all skipped deltas.
        if (!shouldPersistSokoBotRuntimeEvent(indexed.event.type)) continue;

        // A step's usage is added inside persistEvent, from the locked row.
        const turnData: Prisma.SokoBotTurnUpdateInput = {};
        if (
          indexed.event.type === "step.started" &&
          typeof indexed.event.data.modelId === "string"
        ) {
          turnData.modelId = indexed.event.data.modelId.slice(0, 240);
        }
        if (indexed.event.type === "message.completed") {
          if (typeof indexed.event.data.message === "string") {
            turnData.finalAnswer = indexed.event.data.message.slice(0, 50_000);
          }
        } else if (indexed.event.type === "turn.completed") {
          pendingStatus = "COMPLETED";
          pendingCompletedAt = new Date(indexed.event.meta.at);
        } else if (indexed.event.type === "turn.cancelled") {
          pendingStatus = "CANCELLED";
        } else if (
          indexed.event.type === "turn.failed" ||
          indexed.event.type === "session.failed"
        ) {
          pendingStatus = "FAILED";
          pendingErrorKind =
            runtimeFailureCode(indexed.event.data) ?? "runtime_failed";
          pendingErrorDetail =
            pendingErrorKind === AI_BUDGET_EXCEEDED
              ? AI_BUDGET_EXCEEDED_MESSAGE
              : typeof indexed.event.data.message === "string"
                ? safeRuntimeDiagnostic(indexed.event.data.message)
                : undefined;
          turnData.errorKind = pendingErrorKind;
          if (pendingErrorDetail !== undefined)
            turnData.errorDetail = pendingErrorDetail;
        }
        const eventWasNew = await persistEvent(indexed, turnData);
        if (
          eventWasNew &&
          turn.chatResponseMessageId &&
          (indexed.event.type === "actions.requested" ||
            indexed.event.type === "action.result" ||
            indexed.event.type === "reasoning.completed")
        ) {
          const { publishSokoBotChatProgress } = await import(
            "@/services/soko-bot-chat.service"
          );
          await publishSokoBotChatProgress(turn.id).catch((error) => {
            emitCoreWarning(
              TURN_LOG,
              {
                message:
                  "Could not publish a Soko Bot turn's progress to its chat",
                why: "Publishing the progress failed",
                fix: "Nothing to do: the chat shows the answer when the turn settles.",
              },
              { turn: { id: turn.id }, failure: messageSafeErrorFields(error) },
            );
          });
        }
        if (SETTLEMENT_TRIGGER_EVENT_TYPES.has(indexed.event.type)) {
          await settleOnTrigger(indexed.event.type, {
            status: pendingStatus,
            completedAt: pendingCompletedAt,
            errorKind: pendingErrorKind,
            errorDetail: pendingErrorDetail,
          });
          break;
        }
      }
    } catch (error) {
      if (error instanceof SokoBotReconciliationLeaseLostError) throw error;
      const detail =
        error instanceof Error
          ? safeRuntimeDiagnostic(error.message)
          : "Unknown runtime stream error";
      const now = await databaseNow();
      const expired = turn.deadlineAt <= now;
      if (expired) {
        if (!(await this.expireTurn(turn.id, leaseToken))) {
          throw new SokoBotReconciliationLeaseLostError(
            "Soko Bot reconciliation lease was lost",
          );
        }
      } else {
        const updated = await prisma.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            leaseToken,
            status: { in: [...ACTIVE_TURN_STATUSES] },
          },
          data: {
            errorKind: "runtime_stream_interrupted",
            errorDetail: detail,
            reconcilerHeartbeatAt: now,
          },
        });
        if (!updated.count) {
          throw new SokoBotReconciliationLeaseLostError(
            "Soko Bot reconciliation lease was lost",
          );
        }
      }
      throw error;
    } finally {
      stopRenewing();
    }
  }

  /**
   * `caller` is a member, or a shared Soko Bot acting on its own (ADR 0057).
   * The bot may stop only its own background runs that nobody asked for: a
   * member's run is theirs or an admin's to stop.
   */
  async cancelTurn(
    caller: string | { sokoBotId: string },
    turnId: string,
  ): Promise<void> {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { id: turnId },
      include: { sokoBot: { select: { userId: true, workspaceId: true } } },
    });
    if (
      !turn ||
      !(typeof caller === "object"
        ? turn.sokoBotId === caller.sokoBotId &&
          turn.parentTurnId !== null &&
          turn.requestedByUserId === null
        : await authorizeSokoBotTurnAction(caller, turn, turn.sokoBot))
    )
      throw new SokoBotNotFoundError("Active turn not found");
    if (!["STARTING", "RUNNING", "CANCEL_REQUESTED"].includes(turn.status)) {
      return;
    }
    if (turn.status !== "CANCEL_REQUESTED") {
      await prisma.sokoBotTurn.updateMany({
        where: { id: turn.id, status: { in: ["STARTING", "RUNNING"] } },
        data: {
          status: "CANCEL_REQUESTED",
          cancellationRequestedAt: new Date(),
        },
      });
    }
    await this.deliverRuntimeCancellation(turn);
  }

  async resetMemory(
    userId: string,
    workspaceId: string,
    selector: SokoBotSelector = ME_SOKO_BOT,
  ) {
    const markdown = renderSokoBotMemory(createEmptySokoBotMemory());
    const hash = memoryHash(markdown);
    return serializableTransaction(async (tx) => {
      const bot = await memberSokoBot(userId, workspaceId, selector, tx);
      if (!bot || bot.archivedAt)
        throw new SokoBotNotFoundError("Soko Bot not found");
      await assertSokoBotManagement(userId, bot, "resetMemory", tx);
      const version = bot.memoryVersion + 1;
      const revision = await tx.sokoBotMemoryRevision.create({
        data: {
          sokoBotId: bot.id,
          version,
          hash,
          markdown,
          source: "user_reset",
        },
      });
      await tx.sokoBot.update({
        where: { id: bot.id },
        data: { memoryVersion: version, memoryHash: hash },
      });
      return revision;
    }, "Soko Bot memory changed concurrently");
  }

  async updateVersion(
    userId: string,
    workspaceId: string,
    versionId: string,
    options: { allowUnpromoted: boolean } = { allowUnpromoted: false },
    selector: SokoBotSelector = ME_SOKO_BOT,
  ) {
    // Built-in or console-authored; both share one id namespace. Authored
    // versions are selectable only once promoted, except from the admin lab.
    const known = options.allowUnpromoted
      ? await isRunnableSokoBotVersionId(versionId)
      : await isSelectableSokoBotVersionId(versionId, userId);
    if (!known) {
      throw new SokoBotValidationError("Unknown Soko Bot version");
    }
    const bot = await memberSokoBot(userId, workspaceId, selector);
    if (!bot) throw new SokoBotNotFoundError("Soko Bot not found");
    // Cuso runs CMO's own version: any member may reach him (ADR 0061), and
    // moving him off it would leave the business's CMO without its agent.
    // Only the admin lab moves him.
    if (
      !options.allowUnpromoted &&
      getSokoBotVersion(bot.versionId).profile === "cmo"
    ) {
      throw new SokoBotValidationError(
        "Cuso runs CMO's own version, which cannot be changed here",
      );
    }
    // Leaving CMO ends Cuso: Polar stops charging before anything is
    // written (ADR 0068). A revoke Polar fails is owed to the sync job.
    await revokeCusoSubscriptionIfLeavingCmo(bot.id, versionId);
    await serializableTransaction(async (tx) => {
      await forfeitCusoProjectCreditsIfLeavingCmo(bot.id, versionId, tx);
      const updated = await tx.sokoBot.updateMany({
        where: { id: bot.id, archivedAt: null },
        data: { versionId },
      });
      if (updated.count === 0)
        throw new SokoBotNotFoundError("Soko Bot not found");
    }, "Soko Bot version changed concurrently");
    await revokeSubscriptionsLeftByEnding(bot.projectId);
  }

  /**
   * How many live bots run each version, counted across the whole fleet.
   *
   * The fleet page lists one page of bots; deriving the counts from that page
   * would tell an operator they are about to move twenty when the migration
   * moves every matching bot in the database.
   */
  async versionUsage(): Promise<{ versionId: string; count: number }[]> {
    // Eval lanes pick their own version per run; they are not the fleet.
    const evalWorkspaces = await evalWorkspaceIds();
    const rows = await prisma.sokoBot.groupBy({
      by: ["versionId"],
      where: {
        archivedAt: null,
        versionId: { not: null },
        workspaceId: { notIn: evalWorkspaces },
      },
      _count: { _all: true },
    });
    return rows
      .flatMap((row) =>
        row.versionId
          ? [{ versionId: row.versionId, count: row._count._all }]
          : [],
      )
      .sort(
        (a, b) => b.count - a.count || a.versionId.localeCompare(b.versionId),
      );
  }

  /**
   * Moves many bots onto one version.
   *
   * Every bot goes through the same audited action a single-bot move uses, so
   * each gets its own before/after record rather than one opaque "bulk" entry.
   * One bot that cannot be moved does not stop the rest; it is reported.
   *
   * Re-running is safe and is the way to retry: bots already on the target are
   * skipped before any work happens, and every attempt gets fresh operation
   * ids, so a bot that failed last time is tried again rather than replaying
   * its recorded failure forever.
   */
  async migrateVersions(input: {
    operatorId: string;
    /** Only bots on this version. Omitted, every live bot is moved. */
    fromVersionId?: string;
    toVersionId: string;
    reason: string;
    /** Tell each moved bot's owner, in its chat, what changed. Always on for a non-EU target. */
    notifyOwners?: boolean;
    requestId?: string;
    traceId?: string;
  }): Promise<{
    total: number;
    moved: number;
    notified: number;
    alreadyOnVersion: number;
    failed: number;
    failures: { sokoBotId: string; message: string }[];
  }> {
    if (!(await isRunnableSokoBotVersionId(input.toVersionId))) {
      throw new SokoBotValidationError(
        `Unknown Soko Bot version ${input.toVersionId}`,
      );
    }
    const target = await resolveSokoBotVersion(input.toVersionId);
    const notice = composeSokoBotVersionNotice(target);
    const euPinned = new Map<string | null, boolean>();
    // Moving a bot off EU-pinned inference changes where its owner's data is
    // processed; that is never done without telling them. A move that keeps
    // it where it was needs no notice unless the operator asks for one.
    const mustTell = async (versionId: string | null): Promise<boolean> => {
      if (input.notifyOwners) return true;
      if (target.inferenceRegion === "eu") return false;
      let pinned = euPinned.get(versionId);
      if (pinned === undefined) {
        pinned = await resolveSokoBotVersion(versionId)
          .then((version) => version.inferenceRegion === "eu")
          // A version Core can no longer read: assume the bot was in the EU.
          .catch(() => true);
        euPinned.set(versionId, pinned);
      }
      return pinned;
    };
    const bots = await fleetBotsToMove(input.fromVersionId);
    // One base per run, not one supplied by the caller. A caller-supplied id
    // would make a retry replay each bot's recorded outcome, which is exactly
    // backwards: the bots worth retrying are the ones that failed.
    const runId = randomUUID();
    const failures: { sokoBotId: string; message: string }[] = [];
    let moved = 0;
    let notified = 0;
    let alreadyOnVersion = 0;
    let failed = 0;
    for (const bot of bots) {
      // Skipping before the action is what makes a re-run idempotent: a bot
      // already on the target never reaches the audit path a second time.
      if (bot.versionId === input.toVersionId) {
        alreadyOnVersion += 1;
        continue;
      }
      try {
        await this.applyAdminAction({
          sokoBotId: bot.id,
          operatorId: input.operatorId,
          action: "SET_VERSION",
          versionId: input.toVersionId,
          reason: input.reason,
          operationId: `${runId}:${bot.id}`,
          requestId: input.requestId,
          traceId: input.traceId,
        });
        moved += 1;
      } catch (error) {
        failed += 1;
        // Counted without limit, listed with one: the response schema bounds
        // the array, and a run where everything failed must still return the
        // result rather than throwing on its own output after the writes.
        if (failures.length < MIGRATION_FAILURE_SAMPLE) {
          failures.push({
            sokoBotId: bot.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
      // The move stands whether or not the owner hears about it: a notice
      // that fails is counted as not sent, never as a failed move.
      if (await mustTell(bot.versionId)) {
        const { postSokoBotOwnerNotice } = await import(
          "@/services/soko-bot-chat.service"
        );
        const posted = await postSokoBotOwnerNotice({
          sokoBotId: bot.id,
          content: notice,
          key: `version:${runId}:${bot.id}`,
        }).catch((error: unknown) => {
          // The admin's migrate request is awaiting this.
          recordCoreWarning(
            TURN_LOG,
            {
              message:
                "Could not tell a Soko Bot's owner about its version move",
              why: "Posting the version notice in the owner's chat failed",
              fix: "The move stands and is counted as not notified; tell the owner another way if they need to know.",
            },
            // The name only: the notice's text is about the owner.
            {
              versionNoticeFailures: [
                {
                  sokoBotId: bot.id,
                  errorName: error instanceof Error ? error.name : "unknown",
                },
              ],
            },
          );
          return null;
        });
        if (posted) notified += 1;
      }
    }
    return {
      total: bots.length,
      moved,
      notified,
      alreadyOnVersion,
      failed,
      failures,
    };
  }

  /** A person writing a schedule in the console; see PERSON_SCHEDULE_CAPABILITIES. */
  async createSchedule(input: CreateSokoBotScheduleInput) {
    return translateScheduleErrors(() =>
      createSokoBotSchedule({
        ...input,
        capabilityNames: PERSON_SCHEDULE_CAPABILITIES,
      }),
    );
  }

  async updateSchedule(input: UpdateSokoBotScheduleInput) {
    return translateScheduleErrors(() =>
      updateSokoBotSchedule(
        input.prompt === undefined
          ? input
          : { ...input, capabilityNames: PERSON_SCHEDULE_CAPABILITIES },
      ),
    );
  }

  /** `bot` reaches a shared bot's schedule the caller did not write. */
  async deleteSchedule(
    userId: string,
    scheduleId: string,
    bot: { workspaceId?: string; sokoBotId?: string } = {},
  ): Promise<void> {
    await translateScheduleErrors(() =>
      deleteSokoBotSchedule(userId, { scheduleId, ...bot }),
    );
  }

  async listForAdmin(
    query: string | undefined,
    options: {
      cursor?: string;
      take?: number;
      kind?: "all" | "assistant" | "cmo";
      evals?: "exclude" | "include" | "only";
    } = {},
  ) {
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const evalWorkspaces = await evalWorkspaceIds();
    const evals = options.evals ?? "exclude";
    const evalWhere: Prisma.SokoBotWhereInput =
      evals === "exclude"
        ? { workspaceId: { notIn: evalWorkspaces } }
        : evals === "only"
          ? { workspaceId: { in: evalWorkspaces } }
          : {};
    const term = query?.trim();
    const idTerm =
      term &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        term,
      )
        ? term
        : null;
    // Tombstones are emptied rows kept only so Tasks and billing still resolve;
    // they are not bots and never appear in the fleet.
    const cmoVersionIds = SOKO_BOT_PRODUCT_VERSIONS.filter(
      (version) => version.profile === "cmo",
    ).map((version) => version.id);
    const kindWhere: Prisma.SokoBotWhereInput =
      options.kind === "cmo"
        ? { versionId: { in: cmoVersionIds } }
        : options.kind === "assistant"
          ? {
              OR: [
                { versionId: null },
                { versionId: { notIn: cmoVersionIds } },
              ],
            }
          : {};
    const fleetWhere: Prisma.SokoBotWhereInput = {
      deletedAt: null,
      AND: [kindWhere, evalWhere],
    };
    const where: Prisma.SokoBotWhereInput = {
      deletedAt: null,
      AND: [
        kindWhere,
        evalWhere,
        term
          ? {
              OR: [
                ...(idTerm ? [{ id: idTerm }] : []),
                { name: { contains: term, mode: "insensitive" } },
                { user: { name: { contains: term, mode: "insensitive" } } },
                { user: { email: { contains: term, mode: "insensitive" } } },
                {
                  createdByUser: {
                    name: { contains: term, mode: "insensitive" },
                  },
                },
                {
                  createdByUser: {
                    email: { contains: term, mode: "insensitive" },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const include = {
      user: { select: { id: true, name: true, email: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
      workspace: { select: { organizationId: true } },
      _count: {
        select: {
          turns: true,
          // Auto-accepted actions leave ACCEPTED rows; only PENDING waits.
          pendingDecisions: { where: { status: "PENDING" as const } },
          schedules: true,
        },
      },
    } satisfies Prisma.SokoBotInclude;
    const active: Prisma.SokoBotWhereInput = {
      AND: [fleetWhere, { archivedAt: null }],
    };
    const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [items, total, activeCount, activeRecently, pendingDecisions] =
      await prisma.$transaction([
        prisma.sokoBot.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: take + 1,
          ...(options.cursor
            ? { cursor: { id: options.cursor }, skip: 1 }
            : undefined),
          include,
        }),
        prisma.sokoBot.count({ where }),
        prisma.sokoBot.count({ where: active }),
        prisma.sokoBot.count({
          where: { AND: [active, { lastActivityAt: { gte: recentSince } }] },
        }),
        prisma.sokoBotPendingDecision.count({
          where: { status: "PENDING", sokoBot: active },
        }),
      ]);
    // The same bots as attentionReasons in Web: errored, paused, failing, waiting.
    const needsOperator: Prisma.SokoBotWhereInput = {
      AND: [
        active,
        {
          OR: [
            { status: { in: ["ERROR", "PAUSED"] } },
            { consecutiveTurnFailures: { gt: 0 } },
            { pendingDecisions: { some: { status: "PENDING" } } },
          ],
        },
      ],
    };
    const [attention, attentionTotal] = await prisma.$transaction([
      prisma.sokoBot.findMany({
        where: needsOperator,
        orderBy: [
          { lastActivityAt: { sort: "desc", nulls: "last" } },
          { id: "desc" },
        ],
        take: 50,
        include,
      }),
      prisma.sokoBot.count({ where: needsOperator }),
    ]);
    const hasMore = items.length > take;
    const page = items.slice(0, take);
    const evalSet = new Set(evalWorkspaces);
    const outOfCredits = await sokoBotIdsOutOfCredits(
      [...page, ...attention].map((bot) => ({
        id: bot.id,
        userId: bot.userId,
        organizationId: bot.workspace.organizationId,
        projectId: bot.projectId,
      })),
    );
    const listed = <T extends (typeof items)[number]>({
      workspace: _workspace,
      ...bot
    }: T) => ({
      ...bot,
      kind: cmoVersionIds.includes(bot.versionId ?? "")
        ? ("cmo" as const)
        : ("assistant" as const),
      outOfCredits: outOfCredits.has(bot.id),
      evalLane: evalSet.has(bot.workspaceId),
    });
    return {
      items: page.map(listed),
      total,
      hasMore,
      summary: {
        active: activeCount,
        activeRecently,
        pendingDecisions,
        attention: attention.map(listed),
        attentionTotal,
      },
    };
  }

  async getForAdmin(sokoBotId: string) {
    const bot = await prisma.sokoBot.findFirst({
      where: { id: sokoBotId, deletedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true } },
        turns: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            events: { orderBy: { sequence: "asc" } },
            toolCalls: { orderBy: { createdAt: "asc" } },
            modelCalls: {
              orderBy: { createdAt: "asc" },
              omit: { turnId: true, generationId: true },
            },
            delegations: true,
            pendingDecisions: true,
            // The packet is the whole model input, often hundreds of KB per
            // turn; the panel shows only the snapshot's metadata.
            contextSnapshot: { omit: { packet: true } },
          },
        },
        memoryRevisions: { orderBy: { version: "desc" }, take: 20 },
        legacyMessages: { orderBy: { createdAt: "desc" }, take: 500 },
        pendingDecisions: { orderBy: { createdAt: "desc" }, take: 50 },
        schedules: {
          orderBy: { createdAt: "desc" },
          include: { runs: { orderBy: { scheduledFor: "desc" }, take: 20 } },
        },
      },
    });
    if (!bot) throw new SokoBotNotFoundError("Soko Bot not found");
    const adminActions = await prisma.sokoBotAdminAction.findMany({
      where: { sokoBotId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    let runtimeHealth: {
      healthy: boolean;
      runtimeVersion: string;
      sessionStatus: string | null;
      checkedAt: Date;
      errorKind: string | null;
    } | null = null;
    const latestTurn = bot.turns[0];
    if (bot.eveSessionId && latestTurn) {
      try {
        runtimeHealth = {
          ...(await this.runtime.inspectSession({
            sessionId: bot.eveSessionId,
          })),
          checkedAt: new Date(),
          errorKind: null,
        };
      } catch {
        runtimeHealth = {
          healthy: false,
          runtimeVersion: bot.runtimeVersion ?? IN_PROCESS_RUNTIME_VERSION,
          sessionStatus: null,
          checkedAt: new Date(),
          errorKind: "runtime_unreachable",
        };
      }
    }
    const memoryRevisions = (bot.memoryRevisions ?? []).map(safeMemoryRevision);
    return redactAdminPresentation({
      ...bot,
      memoryHash: memoryRevisions[0]?.hash ?? bot.memoryHash,
      memoryRevisions,
      adminActions,
      runtimeHealth,
    });
  }

  /**
   * The operator action itself. Returns nothing: reading the bot back is a
   * heavy query (turns with their tool calls, legacy messages, schedules,
   * audit rows, runtime health), and a fleet migration doing that once per bot
   * would spend most of its request budget on reads nobody looks at.
   */
  private async applyAdminAction(input: {
    sokoBotId: string;
    operatorId: string;
    action: SokoBotAdminActionName;
    targetId?: string;
    /** `SET_VERSION` only: the version slug to move the bot to. */
    versionId?: string;
    reason: string;
    operationId?: string;
    requestId?: string;
    traceId?: string;
  }) {
    const reason = input.reason.trim();
    if (!reason)
      throw new SokoBotValidationError("Admin action reason is required");
    if (input.action === "SET_VERSION") {
      if (!input.versionId) {
        throw new SokoBotValidationError("SET_VERSION requires a versionId");
      }
      // Checked before the intent is recorded: a slug that does not exist is a
      // bad request, not a failed operation, and writing an ATTEMPTED row for
      // it would leave an outbox entry nothing can ever complete.
      if (!(await isRunnableSokoBotVersionId(input.versionId))) {
        throw new SokoBotValidationError(
          `Unknown Soko Bot version ${input.versionId}`,
        );
      }
    }
    const requestId = normalizeAdminActionIdentifier(
      input.requestId,
      "Request ID",
    );
    const traceId = normalizeAdminActionIdentifier(input.traceId, "Trace ID");
    const operationId = adminActionOperationId(
      normalizeAdminActionIdentifier(input.operationId, "Operation ID"),
      requestId,
      traceId,
    );
    const bot = await prisma.sokoBot.findUnique({
      where: { id: input.sokoBotId },
    });
    if (!bot) throw new SokoBotNotFoundError("Soko Bot not found");
    const before = adminActionSnapshot(bot);
    let existing = await prisma.sokoBotAdminAction.findUnique({
      where: {
        operationId_status: { operationId, status: "ATTEMPTED" },
      },
    });
    // The version slug rides in `targetId`, the column that already holds
    // whatever an action points at (a turn for RETRY_LAST_FAILED, a schedule
    // for DISABLE_SCHEDULE). Keeping it there means the idempotency check
    // below compares it for free: the same operation id with a different
    // target version is rejected rather than silently accepted.
    let resolvedTargetId =
      input.action === "SET_VERSION"
        ? (input.versionId ?? null)
        : (input.targetId ?? null);
    if (
      existing &&
      resolvedTargetId === null &&
      (input.action === "RETRY_LAST_FAILED" || input.action === "RESET_SESSION")
    ) {
      resolvedTargetId = existing.targetId;
    } else if (!existing && input.action === "RETRY_LAST_FAILED") {
      const failedTarget = await prisma.sokoBotTurn.findFirst({
        where: { sokoBotId: bot.id, status: "FAILED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      resolvedTargetId = failedTarget?.id ?? null;
    } else if (!existing && input.action === "RESET_SESSION") {
      const sessionTarget = await prisma.sokoBotTurn.findFirst({
        where: {
          sokoBotId: bot.id,
          eveSessionId: bot.eveSessionId ?? { not: null },
          ...(bot.eveSessionId
            ? {}
            : { status: { in: [...ACTIVE_TURN_STATUSES] } }),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      resolvedTargetId = sessionTarget?.id ?? null;
    }
    const intent = {
      sokoBotId: bot.id,
      // The bot's owner; a shared bot has none, so the operator stands in.
      userId: isPersonalSokoBot(bot) ? bot.userId : input.operatorId,
      operatorId: input.operatorId,
      action: input.action,
      targetId: resolvedTargetId,
      reason,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
    };

    if (!existing) {
      try {
        await prisma.sokoBotAdminAction.create({
          data: {
            operationId,
            status: "ATTEMPTED",
            ...intent,
            before: jsonInput(before),
          },
        });
      } catch (error) {
        if (!isPrismaUniqueViolation(error)) throw error;
        existing = await prisma.sokoBotAdminAction.findUnique({
          where: {
            operationId_status: { operationId, status: "ATTEMPTED" },
          },
        });
        if (!existing) throw error;
      }
    }
    if (existing) {
      assertMatchingAdminActionIntent(existing, intent);
      const outcome = await prisma.sokoBotAdminAction.findFirst({
        where: {
          operationId,
          status: { in: ["SUCCEEDED", "FAILED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { status: true, errorDetail: true },
      });
      if (outcome?.status === "SUCCEEDED") return;
      if (outcome?.status === "FAILED") {
        throw new SokoBotValidationError(
          outcome.errorDetail ?? "Admin action already failed",
        );
      }
      // ATTEMPTED without terminal outcome is a recoverable outbox entry.
      // Every local effect below commits with SUCCEEDED, remote reset is
      // idempotent, and retry turns use a deterministic clientTurnId.
    }

    const recordFailure = async (error: unknown): Promise<void> => {
      const failure = safeAdminActionFailure(error);
      let after: ReturnType<typeof adminActionSnapshot> | null = null;
      try {
        const current = await prisma.sokoBot.findUnique({
          where: { id: bot.id },
        });
        after = current ? adminActionSnapshot(current) : null;
      } catch {
        // Intent is already durable. Outcome still records without a snapshot.
      }
      try {
        await prisma.sokoBotAdminAction.create({
          data: {
            operationId,
            status: "FAILED",
            ...intent,
            before: jsonInput(before),
            ...(after ? { after: jsonInput(after) } : {}),
            ...failure,
          },
        });
      } catch (auditError) {
        if (!isPrismaUniqueViolation(auditError)) {
          // Admin actions run inside the admin's request.
          recordCoreError(
            TURN_LOG,
            {
              message:
                "Could not record the outcome of a failed Soko Bot admin action",
              why: "Writing the audit row failed",
              fix: "The action's intent is recorded; add the FAILED outcome for this operationId by hand if the audit trail needs it.",
              cause: auditError,
            },
            { adminAction: { operationId }, sokoBot: { id: bot.id } },
          );
        }
      }
    };

    if (
      getEnv().SOKO_BOT_ENABLED === false &&
      (input.action === "RETRY_LAST_FAILED" ||
        input.action === "RETRY_SCHEDULE_RUN")
    ) {
      const error = new SokoBotValidationError("Soko Bot is disabled");
      await recordFailure(error);
      throw error;
    }

    if (input.action === "PAUSE") {
      let active: {
        id: string;
        requestedByUserId: string | null;
        sokoBotId: string;
        workspaceId: string;
        eveSessionId: string | null;
        eveTurnId: string | null;
      } | null = null;
      try {
        active = await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM ${sharedTable("soko_bot")}
            WHERE "id" = ${bot.id}::uuid
            FOR UPDATE
          `;
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current) throw new SokoBotNotFoundError("Soko Bot not found");
          const activeTurn = await tx.sokoBotTurn.findFirst({
            where: {
              sokoBotId: bot.id,
              ...FOREGROUND_TURN,
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              requestedByUserId: true,
              sokoBotId: true,
              workspaceId: true,
              eveSessionId: true,
              eveTurnId: true,
              status: true,
            },
          });
          if (activeTurn && activeTurn.status !== "CANCEL_REQUESTED") {
            await tx.sokoBotTurn.updateMany({
              where: {
                id: activeTurn.id,
                status: { in: ["STARTING", "RUNNING"] },
              },
              data: {
                status: "CANCEL_REQUESTED",
                cancellationRequestedAt: new Date(),
              },
            });
          }
          const updated = await tx.sokoBot.update({
            where: { id: bot.id },
            data: { status: "PAUSED", adminPausedAt: new Date() },
          });
          await tx.sokoBotAdminAction.create({
            data: {
              operationId,
              status: "SUCCEEDED",
              ...intent,
              before: jsonInput(before),
              after: jsonInput(adminActionSnapshot(updated)),
            },
          });
          return activeTurn;
        }, "Soko Bot pause collided with turn start");
      } catch (error) {
        await recordFailure(error);
        throw error;
      }
      if (active) {
        try {
          await this.deliverRuntimeCancellation(active);
        } catch (error) {
          recordCoreWarning(
            TURN_LOG,
            {
              message:
                "Could not cancel a paused Soko Bot's running turn at the runtime",
              why: "The runtime refused the cancel",
              fix: "The bot is paused; the next reconcile or the turn's deadline ends the turn.",
            },
            {
              sokoBot: { id: bot.id },
              turn: { id: active.id },
              failure: messageSafeErrorFields(error),
            },
          );
        }
      }
    } else if (input.action === "RESUME") {
      try {
        await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM ${sharedTable("soko_bot")}
            WHERE "id" = ${bot.id}::uuid
            FOR UPDATE
          `;
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current || current.archivedAt) {
            throw new SokoBotValidationError(
              "Archived Soko Bot cannot be resumed by an administrator",
            );
          }
          const resetAttempts = await tx.sokoBotAdminAction.findMany({
            where: {
              sokoBotId: bot.id,
              action: "RESET_SESSION",
              status: "ATTEMPTED",
            },
            select: { operationId: true },
          });
          if (resetAttempts.length > 0) {
            const terminalResets = await tx.sokoBotAdminAction.findMany({
              where: {
                operationId: {
                  in: resetAttempts.map((attempt) => attempt.operationId),
                },
                status: { in: ["SUCCEEDED", "FAILED"] },
              },
              select: { operationId: true },
            });
            const terminalOperationIds = new Set(
              terminalResets.map((outcome) => outcome.operationId),
            );
            if (
              resetAttempts.some(
                (attempt) => !terminalOperationIds.has(attempt.operationId),
              )
            ) {
              throw new SokoBotBusyError(
                "Soko Bot session reset is still in progress",
              );
            }
          }
          const updated = await tx.sokoBot.update({
            where: { id: bot.id },
            data: { status: "IDLE", adminPausedAt: null },
          });
          await tx.sokoBotAdminAction.create({
            data: {
              operationId,
              status: "SUCCEEDED",
              ...intent,
              before: jsonInput(before),
              after: jsonInput(adminActionSnapshot(updated)),
            },
          });
        }, "Soko Bot resume collided with another control action");
      } catch (error) {
        await recordFailure(error);
        throw error;
      }
    } else if (input.action === "RESET_MEMORY") {
      try {
        const markdown = renderSokoBotMemory(createEmptySokoBotMemory());
        const hash = memoryHash(markdown);
        await serializableTransaction(async (tx) => {
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current || current.archivedAt) {
            throw new SokoBotNotFoundError("Soko Bot not found");
          }
          const version = current.memoryVersion + 1;
          await tx.sokoBotMemoryRevision.create({
            data: {
              sokoBotId: bot.id,
              version,
              hash,
              markdown,
              source: "admin_reset",
            },
          });
          const updated = await tx.sokoBot.update({
            where: { id: bot.id },
            data: { memoryVersion: version, memoryHash: hash },
          });
          await tx.sokoBotAdminAction.create({
            data: {
              operationId,
              status: "SUCCEEDED",
              ...intent,
              before: jsonInput(before),
              after: jsonInput(adminActionSnapshot(updated)),
            },
          });
        }, "Soko Bot memory changed concurrently");
      } catch (error) {
        await recordFailure(error);
        throw error;
      }
    } else if (input.action === "SET_VERSION") {
      const versionId = input.versionId as string;
      try {
        // Before the transaction, which is retried: Polar is called once
        // (ADR 0068). A revoke Polar fails is owed to the sync job.
        await revokeCusoSubscriptionIfLeavingCmo(bot.id, versionId);
        await serializableTransaction(async (tx) => {
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current || current.archivedAt) {
            throw new SokoBotNotFoundError("Soko Bot not found");
          }
          // Leaving CMO ends Cuso, so his Project credits end too (ADR 0067).
          await forfeitCusoProjectCreditsIfLeavingCmo(bot.id, versionId, tx);
          const updated = await tx.sokoBot.update({
            where: { id: bot.id },
            data: { versionId },
          });
          await tx.sokoBotAdminAction.create({
            data: {
              operationId,
              status: "SUCCEEDED",
              ...intent,
              before: jsonInput(before),
              after: jsonInput(adminActionSnapshot(updated)),
            },
          });
        }, "Soko Bot version changed concurrently");
        await revokeSubscriptionsLeftByEnding(bot.projectId);
      } catch (error) {
        await recordFailure(error);
        throw error;
      }
    } else if (input.action === "RESET_SESSION") {
      let resetPreparation: {
        sessionTurn: {
          id: string;
          workspaceId: string;
          eveSessionId: string;
        } | null;
        activeTurn: { id: string; leaseToken: string } | null;
      } = { sessionTurn: null, activeTurn: null };
      try {
        resetPreparation = await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM ${sharedTable("soko_bot")}
            WHERE "id" = ${bot.id}::uuid
            FOR UPDATE
          `;
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current || current.archivedAt) {
            throw new SokoBotNotFoundError("Soko Bot not found");
          }
          const activeTurn = await tx.sokoBotTurn.findFirst({
            where: {
              sokoBotId: bot.id,
              ...FOREGROUND_TURN,
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              eveSessionId: true,
              leaseToken: true,
              reconcilerHeartbeatAt: true,
            },
          });
          const resetLeaseToken = activeTurn ? randomUUID() : null;
          if (activeTurn && resetLeaseToken) {
            const now = await databaseNow(tx);
            const fenced = await tx.sokoBotTurn.updateMany({
              where: activeTurn,
              data: {
                status: "CANCEL_REQUESTED",
                ...(activeTurn.status !== "CANCEL_REQUESTED"
                  ? { cancellationRequestedAt: now }
                  : {}),
                leaseToken: resetLeaseToken,
                leaseExpiresAt: new Date(now.getTime() + TURN_LEASE_MS),
                reconcilerHeartbeatAt: now,
              },
            });
            if (fenced.count === 0) {
              const error = new SokoBotReconciliationLeaseLostError(
                "Active Soko Bot turn changed while reset was being prepared",
              );
              reportSokoBotReconciliationLeaseLoss(activeTurn.id, error);
              throw error;
            }
          }
          const sessionTurn = intent.targetId
            ? await tx.sokoBotTurn.findFirst({
                where: {
                  id: intent.targetId,
                  sokoBotId: bot.id,
                  eveSessionId: { not: null },
                },
                select: { id: true, workspaceId: true, eveSessionId: true },
              })
            : null;
          if (intent.targetId && !sessionTurn) {
            throw new SokoBotValidationError(
              "Runtime session has no owning Soko Bot turn",
            );
          }
          const targetSessionId = sessionTurn?.eveSessionId ?? null;
          if (
            (current.eveSessionId &&
              current.eveSessionId !== targetSessionId) ||
            (activeTurn?.eveSessionId &&
              activeTurn.eveSessionId !== targetSessionId)
          ) {
            throw new SokoBotBusyError(
              "Runtime session changed while reset was being prepared; retry with a new operation",
            );
          }
          await tx.sokoBot.update({
            where: { id: bot.id },
            data: { status: "PAUSED", eveSessionId: null },
          });
          return {
            sessionTurn: sessionTurn?.eveSessionId
              ? { ...sessionTurn, eveSessionId: sessionTurn.eveSessionId }
              : null,
            activeTurn:
              activeTurn && resetLeaseToken
                ? { id: activeTurn.id, leaseToken: resetLeaseToken }
                : null,
          };
        }, "Soko Bot session reset collided with turn start");
      } catch (error) {
        if (error instanceof SokoBotReconciliationLeaseLostError)
          throw new SokoBotBusyError(error.message);
        await recordFailure(error);
        throw error;
      }

      const { activeTurn, sessionTurn } = resetPreparation;
      const stopRenewing = activeTurn
        ? this.holdTurnLease(activeTurn.id, activeTurn.leaseToken)
        : undefined;
      try {
        if (intent.targetId && sessionTurn) {
          // RESET_SESSION is idempotent. Any failure leaves ATTEMPTED open and
          // the bot fenced PAUSED; exact operation replay resumes it.
          await this.runtime.resetSession({
            sessionId: sessionTurn.eveSessionId,
            reason,
          });
        }
        if (activeTurn) {
          await this.settleOwnedTurn({
            turnId: activeTurn.id,
            status: "CANCELLED",
            errorKind: "session_reset",
            errorDetail: "Runtime session was reset by an administrator",
            clearSession: true,
            leaseToken: activeTurn.leaseToken,
          });
        }
      } catch (error) {
        if (
          activeTurn &&
          reportSokoBotReconciliationLeaseLoss(activeTurn.id, error)
        )
          throw new SokoBotBusyError("Soko Bot session reset lost its lease");
        throw error;
      } finally {
        stopRenewing?.();
      }

      try {
        await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM ${sharedTable("soko_bot")}
            WHERE "id" = ${bot.id}::uuid
            FOR UPDATE
          `;
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current) throw new SokoBotNotFoundError("Soko Bot not found");
          const updated = await tx.sokoBot.update({
            where: { id: bot.id },
            data: {
              eveSessionId: null,
              status:
                current.adminPausedAt === null && !current.archivedAt
                  ? "IDLE"
                  : "PAUSED",
            },
          });
          await tx.sokoBotAdminAction.create({
            data: {
              operationId,
              status: "SUCCEEDED",
              ...intent,
              before: jsonInput(before),
              after: jsonInput(adminActionSnapshot(updated)),
            },
          });
        }, "Soko Bot session reset finalization collided");
      } catch (error) {
        // Local fence and ATTEMPTED intent remain durable. Replaying the exact
        // operation safely repeats remote reset and resumes finalization.
        throw error;
      }
    } else if (input.action === "DISABLE_SCHEDULE") {
      try {
        if (!input.targetId) {
          throw new SokoBotValidationError("Schedule target is required");
        }
        const schedule = await prisma.sokoBotSchedule.findFirst({
          where: { id: input.targetId, sokoBotId: bot.id },
          select: { id: true, enabled: true },
        });
        if (!schedule) {
          throw new SokoBotNotFoundError("Soko Bot schedule not found");
        }
        await prisma.$transaction(async (tx) => {
          await tx.sokoBotSchedule.update({
            where: { id: schedule.id },
            data: { enabled: false },
          });
          await tx.sokoBotAdminAction.create({
            data: {
              operationId,
              status: "SUCCEEDED",
              ...intent,
              before: jsonInput({ ...before, schedule }),
              after: jsonInput({
                ...before,
                schedule: { id: schedule.id, enabled: false },
              }),
            },
          });
        });
      } catch (error) {
        await recordFailure(error);
        throw error;
      }
    } else if (input.action === "RETRY_SCHEDULE_RUN") {
      if (!input.targetId) {
        const error = new SokoBotValidationError(
          "Schedule run target is required",
        );
        await recordFailure(error);
        throw error;
      }
      const retryClientTurnId = `admin-schedule-retry:${input.targetId}:${adminRetryOperationKey(operationId)}`;
      const { loadAdminScheduleRun, scheduleRetryInput } = await import(
        "./soko-bot-admin-retry.service"
      );
      const scheduleRun = await loadAdminScheduleRun(bot.id, input.targetId);
      const durableRetryTurn = await prisma.sokoBotTurn.findUnique({
        where: {
          sokoBotId_clientTurnId: {
            sokoBotId: bot.id,
            clientTurnId: retryClientTurnId,
          },
        },
        select: { id: true },
      });
      const boundReplayTurnId =
        scheduleRun?.turnId &&
        durableRetryTurn?.id === scheduleRun.turnId &&
        scheduleRun.turn?.id === scheduleRun.turnId &&
        scheduleRun.turn.source === "ADMIN_RETRY" &&
        scheduleRun.turn.clientTurnId === retryClientTurnId
          ? scheduleRun.turnId
          : null;
      if (durableRetryTurn && !boundReplayTurnId) {
        const error = new SokoBotValidationError(
          "Admin schedule retry was superseded by a later retry",
        );
        await recordFailure(error);
        throw error;
      }
      const retryableTerminal =
        scheduleRun?.status === "FAILED" ||
        scheduleRun?.status === "DEAD_LETTER";
      if (!scheduleRun || (!boundReplayTurnId && !retryableTerminal)) {
        const error = new SokoBotNotFoundError(
          "Recoverable Soko Bot schedule run not found",
        );
        await recordFailure(error);
        throw error;
      }
      let retry: SokoBotTurnStartResult;
      try {
        const retryInput = await scheduleRetryInput(
          bot,
          scheduleRun,
          boundReplayTurnId,
        );
        retry = await this.startTurn({
          userId: sokoBotScheduleActingUserId({
            requestedByUserId: scheduleRun.schedule.requestedByUserId,
            systemKey: scheduleRun.schedule.systemKey,
            sokoBot: bot,
          }),
          sokoBotId: bot.id,
          workspaceId: scheduleRun.schedule.workspaceId,
          clientTurnId: retryClientTurnId,
          ...retryInput,
          source: "ADMIN_RETRY",
          adminScheduleReservation: boundReplayTurnId
            ? {
                kind: "BOUND_REPLAY",
                runId: scheduleRun.id,
                boundTurnId: boundReplayTurnId,
                attempt: scheduleRun.attempt,
              }
            : {
                kind: "TERMINAL",
                runId: scheduleRun.id,
                expectedStatus:
                  scheduleRun.status === "FAILED" ? "FAILED" : "DEAD_LETTER",
                expectedAttempt: scheduleRun.attempt,
                previousTurnId: scheduleRun.turnId,
                expectedPrompt: scheduleRun.prompt,
              },
        });
        await prisma.sokoBotAdminAction.create({
          data: {
            operationId,
            status: "SUCCEEDED",
            ...intent,
            before: jsonInput(before),
            after: jsonInput({
              ...before,
              scheduleRunId: scheduleRun.id,
              previousTurnId: boundReplayTurnId
                ? undefined
                : scheduleRun.turnId,
              retryTurnId: retry.turnId,
            }),
          },
        });
      } catch (error) {
        let reservationKnown = false;
        try {
          reservationKnown = Boolean(
            await prisma.sokoBotTurn.findUnique({
              where: {
                sokoBotId_clientTurnId: {
                  sokoBotId: bot.id,
                  clientTurnId: retryClientTurnId,
                },
              },
              select: { id: true },
            }),
          );
        } catch {
          // Ambiguous database lookup: preserve ATTEMPTED for exact replay.
          throw error;
        }
        if (!reservationKnown) await recordFailure(error);
        throw error;
      }
      return retry;
    } else if (input.action === "RETRY_LAST_FAILED") {
      const failed = intent.targetId
        ? await prisma.sokoBotTurn.findFirst({
            where: {
              id: intent.targetId,
              sokoBotId: bot.id,
              status: "FAILED",
            },
          })
        : null;
      if (!failed) {
        const error = new SokoBotNotFoundError("No failed turn to retry");
        await recordFailure(error);
        throw error;
      }
      let retry: SokoBotTurnStartResult;
      try {
        const { failedRetryInput } = await import(
          "./soko-bot-admin-retry.service"
        );
        retry = await this.startTurn(
          await failedRetryInput(
            bot,
            failed,
            `admin-retry:${failed.id}:${adminRetryOperationKey(operationId)}`,
          ),
        );
      } catch (error) {
        await recordFailure(error);
        throw error;
      }
      const afterBot = await prisma.sokoBot.findUniqueOrThrow({
        where: { id: bot.id },
      });
      await prisma.sokoBotAdminAction.create({
        data: {
          operationId,
          status: "SUCCEEDED",
          ...intent,
          before: jsonInput(before),
          after: jsonInput({
            ...adminActionSnapshot(afterBot),
            retryTurnId: retry.turnId,
          }),
        },
      });
      return retry;
    }
  }

  /** One bot, with its refreshed diagnostics for the operator screen. */
  async performAdminAction(
    input: Parameters<SokoBotControlPlane["applyAdminAction"]>[0],
  ) {
    const started = await this.applyAdminAction(input);
    return {
      detail: await this.getForAdmin(input.sokoBotId),
      reconciliation: started?.reconciliationLeaseToken
        ? {
            turnId: started.turnId,
            leaseToken: started.reconciliationLeaseToken,
          }
        : undefined,
    };
  }

  /** Returns how many of Cuso's unsent posts the archive canceled. */
  async archive(
    userId: string,
    workspaceId: string,
    selector: SokoBotSelector = ME_SOKO_BOT,
  ): Promise<number> {
    // Polar stops charging for a live Cuso before he is archived (ADR 0068).
    // It is called here, once, because the transaction below is retried; the
    // role check runs first so only someone who may archive ends it. A
    // revoke Polar fails is owed to the sync job; the archive goes on.
    const candidate = await memberSokoBot(userId, workspaceId, selector);
    if (candidate) {
      await assertSokoBotManagement(userId, candidate, "archive");
      await revokeCusoSubscription(candidate.id);
    }
    const archived = await serializableTransaction(async (tx) => {
      const bot = await memberSokoBot(userId, workspaceId, selector, tx);
      if (!bot) return null;
      await assertSokoBotManagement(userId, bot, "archive", tx);
      if (bot.archivedAt) return null;
      await tx.$queryRaw`
        SELECT "id"
        FROM ${sharedTable("soko_bot")}
        WHERE "id" = ${bot.id}::uuid
        FOR UPDATE
      `;
      const activeTurn = await tx.sokoBotTurn.findFirst({
        where: {
          sokoBotId: bot.id,
          ...FOREGROUND_TURN,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          requestedByUserId: true,
          sokoBotId: true,
          workspaceId: true,
          eveSessionId: true,
          eveTurnId: true,
          status: true,
        },
      });
      if (activeTurn && activeTurn.status !== "CANCEL_REQUESTED") {
        await tx.sokoBotTurn.updateMany({
          where: {
            id: activeTurn.id,
            status: { in: ["STARTING", "RUNNING"] },
          },
          data: {
            status: "CANCEL_REQUESTED",
            cancellationRequestedAt: new Date(),
          },
        });
      }
      // An archived Cuso's Project no longer holds its posts, so they would
      // still publish: cancel them, as a deletion does (#7121).
      const cuso = await tx.sokoBot.findFirst({
        where: { id: bot.id, ...LIVE_CUSO_WHERE },
        select: { projectId: true },
      });
      const canceledPosts = cuso?.projectId
        ? await cancelUnpublishedSocialPosts(
            tx,
            { projectId: cuso.projectId },
            ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"],
          )
        : 0;
      // Start over archives through here, so it forfeits too (ADR 0067).
      await forfeitCusoProjectCredits(bot.id, tx);
      await tx.sokoBot.update({
        where: { id: bot.id },
        data: {
          archivedAt: new Date(),
          status: "PAUSED",
          eveSessionId: null,
        },
      });
      const mentionMessageIds = await failOpenChatRoomMentions(
        {
          where: { sokoBotId: bot.id },
          error: "Personal assistant is no longer a member of this room",
        },
        tx,
      );
      await tx.chatRoomSokoBotMember.deleteMany({
        where: { sokoBotId: bot.id },
      });
      return { activeTurn, mentionMessageIds, canceledPosts };
    }, "Soko Bot archive collided with active work");
    await revokeSubscriptionsLeftByEnding(candidate?.projectId ?? null);
    if (!archived) return 0;
    await publishChatRoomMentionStatuses(archived.mentionMessageIds);
    if (!archived.activeTurn) return archived.canceledPosts;
    try {
      await this.deliverRuntimeCancellation(archived.activeTurn);
    } catch (error) {
      // Archiving runs inside the delete request (Web or CMO).
      recordCoreWarning(
        TURN_LOG,
        {
          message:
            "Could not cancel an archived Soko Bot's running turn at the runtime",
          why: "The runtime refused the cancel",
          fix: "The bot is archived; the next reconcile or the turn's deadline ends the turn.",
        },
        {
          sokoBot: { id: archived.activeTurn.sokoBotId },
          turn: { id: archived.activeTurn.id },
          failure: messageSafeErrorFields(error),
        },
      );
    }
    return archived.canceledPosts;
  }
}

export const sokoBotControlPlane = new SokoBotControlPlane();

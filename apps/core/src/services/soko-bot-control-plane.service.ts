import { createHash, randomUUID } from "node:crypto";

import {
  type Prisma,
  type SokoBot,
  type SokoBotTurn,
  SokoBotTurnStatus,
} from "@sokosumi/database";
import {
  applyVersionCapabilities,
  containsSokoBotSensitiveMaterial,
  createEmptySokoBotMemory,
  type IndexedRuntimeEvent,
  redactSokoBotSensitiveText,
  renderSokoBotMemory,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_TEAMMATE_CAPABILITIES,
  type SokoBotCapability,
  type SokoBotRuntime,
  sanitizeSokoBotMemoryMarkdown,
  sokoBotContextPacketSchema,
} from "@sokosumi/soko-bot";

import { getEnv } from "@/config/env";
import {
  failOpenChatRoomMentions,
  publishChatRoomMentionStatuses,
} from "@/helpers/chat-room-mention-status";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type ClassificationResult,
  ExternalTurnClassifier,
} from "@/lib/soko-bot/classifier";
import { ContextPacketBuilder } from "@/lib/soko-bot/context-packet";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { isRetryableSokoBotRuntimeError } from "@/lib/soko-bot/runtime-errors";
import {
  matchSokoBotRuntimeTurnBoundary,
  shouldPersistSokoBotRuntimeEvent,
} from "@/lib/soko-bot/runtime-stream";
import { IN_PROCESS_RUNTIME_VERSION } from "@/lib/soko-bot/runtime-version";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
import { claimAvatar } from "@/services/soko-bot-avatar.service";
import {
  recordSokoBotTurnUsage,
  requireSokoBotTurnFunding,
} from "@/services/soko-bot-billing.service";
import {
  type CreateSokoBotScheduleInput,
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
  type UpdateSokoBotScheduleInput,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  getDefaultSokoBotVersionId,
  isKnownSokoBotVersionId,
  isSelectableSokoBotVersionId,
  resolveSokoBotVersion,
} from "@/services/soko-bot-version.service";

const TURN_DEADLINE_MS = 15 * 60 * 1_000;
const TURN_LEASE_MS = 16 * 60 * 1_000;
const RECONCILER_HEARTBEAT_MS = 15_000;
export const SOKO_BOT_START_RECOVERY_GRACE_MS = 120_000;

export const ACTIVE_TURN_STATUSES = [
  SokoBotTurnStatus.QUEUED,
  SokoBotTurnStatus.STARTING,
  SokoBotTurnStatus.RUNNING,
  SokoBotTurnStatus.CANCEL_REQUESTED,
] as const;

export class SokoBotNotFoundError extends Error {}
export class SokoBotBusyError extends Error {}
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
class SokoBotReconciliationLeaseLostError extends Error {}
export class SokoBotStartAbortedError extends Error {}

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
  avatarId?: string | null;
  personalityTone?: number | null;
  personalityDetail?: number | null;
  personalityStyle?: number | null;
}

export interface StartSokoBotTurnInput {
  userId: string;
  workspaceId: string;
  clientTurnId: string;
  message: string;
  source?: "CHAT" | "SCHEDULE" | "ADMIN_RETRY" | "EVENT" | "INGEST";
  /** Version override for this turn (lab); otherwise the bot's version. */
  versionId?: string;
  /** Set when a chat-room mention started the turn; the reply lands there. */
  chat?: {
    mentionId: string;
    responseMessageId: string;
    /** Teammate who asked; turns they trigger are read-only. */
    requestedByUserId?: string | null;
    /**
     * Another bot asked. Read-only like a teammate — it answers into a room
     * neither of them owns — and counted against the allowance for unprompted
     * work, because no person decided this turn should happen.
     */
    askedByBot?: boolean;
    /** Bot-to-bot hops behind this turn; see lib/soko-bot/chat-chain.ts. */
    chainDepth?: number;
  };
  scheduleReservation?: {
    runId: string;
    attempt: number;
    leaseToken: string;
  };
  adminScheduleReservation?:
    | {
        kind: "TERMINAL";
        runId: string;
        expectedStatus: "FAILED" | "DEAD_LETTER";
        expectedAttempt: number;
        previousTurnId: string | null;
        expectedPrompt: string | null;
      }
    | {
        kind: "BOUND_REPLAY";
        runId: string;
        boundTurnId: string;
        attempt: number;
      };
}

export interface SokoBotTurnStartResult {
  turnId: string;
  sokoBotId: string;
  sessionId: string;
  status: string;
  route: string;
  capabilities: readonly SokoBotCapability[];
  duplicate: boolean;
  errorKind?: string | null;
  reconciliationLeaseToken?: string;
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

interface AdminActionSnapshotInput {
  status: string;
  adminPausedAt: Date | null;
  eveSessionId: string | null;
  memoryVersion: number;
  archivedAt: Date | null;
  versionId: string | null;
}

interface AdminActionIntentInput {
  sokoBotId: string;
  userId: string;
  operatorId: string;
  action: string;
  targetId?: string | null;
  reason: string;
}

function adminActionSnapshot(bot: AdminActionSnapshotInput) {
  return {
    status: bot.status,
    adminPausedAt: bot.adminPausedAt,
    hasEveSession: bot.eveSessionId !== null,
    memoryVersion: bot.memoryVersion,
    archivedAt: bot.archivedAt,
    // Which version the bot ran before and after. `SET_VERSION` is otherwise
    // invisible in the audit trail: nothing else on the snapshot changes.
    versionId: bot.versionId,
  };
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

function adminActionOperationId(
  operationId: string | undefined,
  requestId: string | undefined,
  traceId: string | undefined,
): string {
  if (operationId) return operationId;
  const source = requestId
    ? `request:${requestId}`
    : traceId
      ? `trace:${traceId}`
      : `generated:${randomUUID()}`;
  return createHash("sha256").update(source).digest("hex");
}

function adminRetryOperationKey(operationId: string): string {
  return createHash("sha256").update(operationId).digest("hex").slice(0, 32);
}

function redactAdminPresentation<T>(value: T): T {
  if (typeof value === "string") {
    return redactSokoBotSensitiveText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAdminPresentation(item)) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const safeKey = redactSokoBotSensitiveText(key);
        return [
          safeKey,
          containsSokoBotSensitiveMaterial(`${key}: value`)
            ? "[Sensitive value removed]"
            : redactAdminPresentation(item),
        ];
      }),
    ) as T;
  }
  return value;
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

function memoryHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function safeMemoryRevision<T extends { hash: string; markdown: string }>(
  revision: T,
): T {
  const markdown = sanitizeSokoBotMemoryMarkdown(revision.markdown);
  return { ...revision, markdown, hash: memoryHash(markdown) };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function safeRuntimeDiagnostic(
  value: string | null | undefined,
  maxLength = 1_000,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return redactSokoBotSensitiveText(value).slice(0, maxLength);
}

interface SokoBotTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
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
  };
}

function addTurnUsage(
  current: SokoBotTurnUsage,
  value: unknown,
): SokoBotTurnUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const increment = parseTurnUsage(value);
  return {
    inputTokens: current.inputTokens + increment.inputTokens,
    outputTokens: current.outputTokens + increment.outputTokens,
    cacheReadTokens: current.cacheReadTokens + increment.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + increment.cacheWriteTokens,
    costUsd: current.costUsd + increment.costUsd,
  };
}

const EVENT_TEXT_LIMIT = 800;
const EVENT_INPUT_LIMIT = 1_200;

/** Model-authored text, bounded and secret-scrubbed, for the owner's explain view. */
function safeEventText(
  value: unknown,
  limit = EVENT_TEXT_LIMIT,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const scrubbed = redactSokoBotSensitiveText(trimmed);
  return scrubbed.length > limit
    ? `${scrubbed.slice(0, limit - 1)}…`
    : scrubbed;
}

function safeEventJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return safeEventText(JSON.stringify(value), EVENT_INPUT_LIMIT);
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

function safeEventProjection(type: string, data: Record<string, unknown>) {
  if (type === "reasoning.completed") {
    const text = safeEventText(data.text ?? data.reasoning ?? data.message);
    return { summary: text ?? "Reasoning update", payload: undefined };
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
    return {
      summary: "Action completed",
      payload: undefined,
      toolName: pick("name", "toolName", "tool"),
      toolCallId: pick("callId", "toolCallId", "id"),
      toolStatus: "completed",
    };
  }
  if (type.endsWith(".failed")) {
    const code =
      typeof data.code === "string"
        ? safeRuntimeDiagnostic(data.code, 120)
        : undefined;
    return {
      summary: code ?? "Runtime failure",
      payload: jsonInput({ code: code ?? "unknown" }),
    };
  }
  return { summary: type.replaceAll(".", " "), payload: undefined };
}

/** Who asked and where, for chat-started turns (console attribution). */
const TURN_CHAT_ATTRIBUTION_INCLUDE = {
  requestedBy: { select: { id: true, name: true, image: true } },
  chatMention: {
    select: {
      message: {
        select: { room: { select: { id: true, name: true, kind: true } } },
      },
    },
  },
} as const;

/** A turn the bot decided to take rather than one a person asked for. */
function unpromptedTurn(turn: { source: string; chainDepth: number }): boolean {
  return (
    turn.source === "SCHEDULE" ||
    turn.source === "EVENT" ||
    turn.source === "INGEST" ||
    turn.chainDepth > 0
  );
}

export class SokoBotControlPlane {
  constructor(
    private readonly runtime: SokoBotRuntime = getSokoBotRuntime(),
    private readonly contextBuilder: ContextPacketBuilder = new ContextPacketBuilder(),
    private readonly classifier: ExternalTurnClassifier = new ExternalTurnClassifier(
      getEnv().SOKO_BOT_CLASSIFIER_MODE === "model",
    ),
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
    userId: string;
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
      console.warn("Soko Bot old runtime session cleanup failed", {
        sokoBotId: input.bot.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private async retainStartLease(
    turnId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const retained = await prisma.sokoBotTurn.updateMany({
      where: {
        id: turnId,
        status: { in: ["STARTING", "CANCEL_REQUESTED"] },
        leaseToken,
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + TURN_LEASE_MS),
        reconcilerHeartbeatAt: new Date(),
      },
    });
    return retained.count === 1;
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
          userId: input.userId,
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
            select: { sokoBotId: true, userId: true, workspaceId: true },
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
        bound.schedule.userId !== input.userId ||
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
          userId: input.userId,
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
    await serializableTransaction(
      (tx) => this.bindTurnReservation(tx, input, sokoBotId, turnId, message),
      "Soko Bot schedule occurrence lease was replaced",
    );
  }

  private async resumeAmbiguousStart(
    bot: SokoBot,
    turn: SokoBotTurn,
  ): Promise<SokoBotTurnStartResult> {
    if (!turn.leaseToken) {
      throw new SokoBotRetryableStartError(
        "Ambiguous Soko Bot start has no reconciliation lease",
      );
    }
    if (turn.deadlineAt <= new Date()) {
      throw new SokoBotRetryableStartError(
        "Ambiguous Soko Bot start reached its deadline",
      );
    }
    // Same rule as crash recovery: an unprompted turn is not resumed once the
    // owner has paused that work.
    if (
      unpromptedTurn(turn) &&
      (bot.proactivePaused || getEnv().SOKO_BOT_PROACTIVE_PAUSED)
    ) {
      throw new SokoBotBusyError(
        "This Soko Bot's owner has paused unprompted work",
      );
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
      userId: turn.userId,
      sokoBotId: turn.sokoBotId,
      workspaceId: turn.workspaceId,
      sessionId: expectedSessionId,
      turnId: turn.id,
    };
    let runtimeTurn;
    try {
      runtimeTurn = await this.startRuntimeWithAcceptanceRetry({
        ...tokenScope,
        sessionId: null,
        message: turn.userMessage,
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
          FROM "orchestrator"
          WHERE "id" = ${bot.id}::uuid
          FOR UPDATE
        `;
        const updatedTurn = await tx.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            status: "STARTING",
            leaseToken: turn.leaseToken,
          },
          data: {
            status: "RUNNING",
            eveSessionId: runtimeTurn.sessionId,
            runtimeVersion: runtimeTurn.runtimeVersion,
            startedAt: new Date(runtimeTurn.acceptedAt),
            reconcilerHeartbeatAt: new Date(),
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
          data: {
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
      }, "Soko Bot replay collided with pause or cancellation");
    } catch (error) {
      if (error instanceof SokoBotStartAbortedError) {
        const concurrentlyAcknowledged = await prisma.sokoBotTurn.findUnique({
          where: { id: turn.id },
        });
        if (concurrentlyAcknowledged?.eveSessionId === runtimeTurn.sessionId) {
          return {
            turnId: concurrentlyAcknowledged.id,
            sokoBotId: concurrentlyAcknowledged.sokoBotId,
            sessionId: runtimeTurn.sessionId,
            status: concurrentlyAcknowledged.status,
            route: concurrentlyAcknowledged.route ?? "CLARIFY",
            capabilities:
              concurrentlyAcknowledged.capabilityNames as SokoBotCapability[],
            duplicate: true,
            errorKind: concurrentlyAcknowledged.errorKind,
            reconciliationLeaseToken:
              concurrentlyAcknowledged.leaseToken ?? undefined,
          };
        }
        if (
          concurrentlyAcknowledged?.leaseToken !== turn.leaseToken ||
          !(await this.retainStartLease(turn.id, turn.leaseToken))
        ) {
          throw error;
        }
        try {
          await this.runtime.resetSession({
            sessionId: runtimeTurn.sessionId,
            reason: "Soko Bot replay acknowledgement failed",
          });
        } catch {
          // Durable STARTING/CANCEL_REQUESTED state remains recoverable.
        }
      }
      throw error;
    }

    await this.resetSupersededRuntimeSession({
      bot,
      userId: turn.userId,
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
      reconciliationLeaseToken: turn.leaseToken,
    };
  }

  /**
   * Replays a durable STARTING turn after its creating process disappeared.
   * The lease CAS elects one recovery worker; Eve create is idempotent on the
   * immutable Core turn id, so even a late original request cannot duplicate
   * work.
   */
  async recoverStartingTurn(
    turnId: string,
  ): Promise<SokoBotTurnStartResult | null> {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { id: turnId, status: "STARTING", eveSessionId: null },
      include: { sokoBot: true },
    });
    if (!turn) return null;
    const recoveryActivityAt =
      turn.reconcilerHeartbeatAt ?? turn.createdAt ?? null;
    if (
      recoveryActivityAt instanceof Date &&
      recoveryActivityAt.getTime() >
        Date.now() - SOKO_BOT_START_RECOVERY_GRACE_MS
    ) {
      return null;
    }
    if (
      turn.sokoBot.archivedAt ||
      turn.sokoBot.adminPausedAt ||
      turn.sokoBot.status === "PAUSED"
    ) {
      return null;
    }
    // A turn nobody asked for, stranded by a crash, must not be resumed after
    // the owner has since paused unprompted work — the pause would look
    // ignored, and this turn can still spend.
    if (
      unpromptedTurn(turn) &&
      (turn.sokoBot.proactivePaused || getEnv().SOKO_BOT_PROACTIVE_PAUSED)
    ) {
      return null;
    }

    const leaseToken = randomUUID();
    const claimedAt = new Date();
    // The pause is part of the claim rather than a read before it: any check
    // that happens first is stale by the time the row is won, and this turn
    // can spend. A pause committed mid-flight now loses the claim outright.
    if (unpromptedTurn(turn) && getEnv().SOKO_BOT_PROACTIVE_PAUSED) {
      return null;
    }
    const claimed = await prisma.sokoBotTurn.updateMany({
      where: {
        id: turn.id,
        status: "STARTING",
        eveSessionId: null,
        leaseToken: turn.leaseToken,
        ...(unpromptedTurn(turn)
          ? { sokoBot: { is: { proactivePaused: false } } }
          : {}),
        leaseExpiresAt: turn.leaseExpiresAt,
        reconcilerHeartbeatAt: turn.reconcilerHeartbeatAt,
      },
      data: {
        leaseToken,
        leaseExpiresAt: new Date(claimedAt.getTime() + TURN_LEASE_MS),
        reconcilerHeartbeatAt: claimedAt,
        errorKind: "runtime_start_ambiguous",
        errorDetail: "Recovering durable start after process interruption",
      },
    });
    if (claimed.count !== 1) return null;

    try {
      return await this.resumeAmbiguousStart(turn.sokoBot, {
        ...turn,
        leaseToken,
      });
    } catch (error) {
      if (error instanceof SokoBotRetryableStartError) {
        await prisma.sokoBotTurn.updateMany({
          where: { id: turn.id, status: "STARTING", leaseToken },
          data: {
            reconcilerHeartbeatAt: null,
            errorKind: "runtime_start_ambiguous",
            errorDetail: safeRuntimeDiagnostic(error.message),
          },
        });
      } else if (!(error instanceof SokoBotStartAbortedError)) {
        await this.failStartedTurn(turn.id, error, leaseToken);
      }
      throw error;
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
            archivedAt: isReactivation ? null : undefined,
            name,
            avatarSeed: input.avatarSeed,
            personalityTone: input.personalityTone,
            personalityDetail: input.personalityDetail,
            personalityStyle: input.personalityStyle,
            // Owner reactivation must not clear a durable administrator pause.
            status:
              isReactivation && existing.adminPausedAt === null
                ? "IDLE"
                : undefined,
            memoryVersion: needsInitialMemory ? 1 : undefined,
            memoryHash: needsInitialMemory ? hash : undefined,
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
        if (input.avatarId) await claimAvatar(updated.id, input.avatarId, tx);
        return updated;
      }

      const bot = await tx.sokoBot.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          name,
          // Pin the version a bot was created on rather than leaving it null
          // and relying on the runtime fallback: the console can then show
          // what each bot actually runs, and an older bot keeps its version
          // when the default moves on.
          versionId: defaultVersionId,
          avatarSeed: input.avatarSeed,
          personalityTone: input.personalityTone,
          personalityDetail: input.personalityDetail,
          personalityStyle: input.personalityStyle,
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
      if (input.avatarId) await claimAvatar(bot.id, input.avatarId, tx);
      return bot;
    });
    const { ensureSystemSchedules } = await import(
      "@/services/soko-bot-proactive.service"
    );
    await ensureSystemSchedules({
      id: created.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      ingestTimezone: created.ingestTimezone,
    }).catch((error) => {
      console.error("Soko Bot system schedules failed", {
        sokoBotId: created.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
    return created;
  }

  /**
   * Is anything happening, in one indexed read.
   *
   * The console watches turns it did not start, so it has to poll often enough
   * to catch one that runs for a few seconds. Polling the full chat state that
   * often is not affordable — that loads the bot plus twenty turns with their
   * events, delegations and decisions — so this carries only what tells the
   * client whether to go and fetch it.
   */
  async getActivityForUser(
    userId: string,
    workspaceId: string,
  ): Promise<{
    status: string;
    activeTurnId: string | null;
    lastTurnAt: Date | null;
  } | null> {
    // One Prisma call, though not one SQL statement: the generator does not
    // enable `relationJoins`, so this still selects the bot and the turn
    // separately. Both predicates are indexed and the payload is three
    // columns, which is what makes it affordable to ask every couple of
    // seconds — not a saved round trip, which it is not.
    const bot = await prisma.sokoBot.findFirst({
      where: { userId, workspaceId, archivedAt: null },
      select: {
        status: true,
        lastTurnAt: true,
        turns: {
          where: { status: { in: [...ACTIVE_TURN_STATUSES] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!bot) return null;
    return {
      status: bot.status,
      activeTurnId: bot.turns[0]?.id ?? null,
      lastTurnAt: bot.lastTurnAt,
    };
  }

  async getForUser(userId: string, workspaceId: string) {
    const bot = await prisma.sokoBot.findFirst({
      where: { userId, workspaceId, archivedAt: null },
      include: {
        memoryRevisions: { orderBy: { version: "desc" }, take: 1 },
        legacyMessages: {
          orderBy: { createdAt: "desc" },
          take: 200,
        },
        pendingDecisions: {
          where: { status: "PENDING", expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        schedules: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!bot) return null;
    const memoryRevisions = (bot.memoryRevisions ?? []).map(safeMemoryRevision);
    return {
      ...bot,
      memoryHash: memoryRevisions[0]?.hash ?? bot.memoryHash,
      memoryRevisions,
    };
  }

  async listTurns(
    userId: string,
    workspaceId: string,
    options: { cursor?: string; take?: number } = {},
  ) {
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const bot = await prisma.sokoBot.findFirst({
      where: { userId, workspaceId, archivedAt: null },
      select: { id: true },
    });
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
    return { turns, count, hasMore };
  }

  async getTurn(userId: string, turnId: string) {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { id: turnId, userId },
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
      contextSummary: summarizeContextPacket(contextSnapshot?.packet ?? null),
      contextPacket: contextSnapshot?.packet ?? null,
    };
  }

  private async classificationContext(userId: string, workspaceId: string) {
    const [projects, coworkers, agents, tasks, jobs] = await Promise.all([
      prisma.project.findMany({
        where: { workspaceId },
        select: { id: true },
        take: 50,
      }),
      prisma.coworker.findMany({
        where: {
          archivedAt: null,
          OR: [
            { isWhitelisted: true },
            { assignments: { some: { userId } } },
            { workspaceAccess: { some: { workspaceId, status: "GRANTED" } } },
          ],
        },
        select: { id: true },
        take: 50,
      }),
      prisma.agent.findMany({
        where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
        select: { id: true },
        take: 50,
      }),
      prisma.task.findMany({
        where: { workspaceId, archivedAt: null },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.job.findMany({
        where: { workspaceId, ownerId: userId },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    ]);
    return {
      projectIds: projects.map(({ id }) => id),
      coworkerIds: coworkers.map(({ id }) => id),
      agentIds: agents.map(({ id }) => id),
      taskIds: tasks.map(({ id }) => id),
      jobIds: jobs.map(({ id }) => id),
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
    return serializableTransaction(async (tx) => {
      const turn = await tx.sokoBotTurn.findUnique({
        where: { id: input.turnId },
        select: {
          sokoBotId: true,
          userId: true,
          eveSessionId: true,
          startedAt: true,
          costUsdMicros: true,
          status: true,
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
          userId: turn.userId,
          costUsdMicros: turn.costUsdMicros,
        },
        tx,
      );
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
      const errorKind = usageCharge.shortfall
        ? "insufficient_credits"
        : safeRuntimeDiagnostic(input.errorKind, 120);
      const errorDetail = usageCharge.shortfall
        ? "Available credits were exhausted while settling this Soko Bot turn"
        : safeRuntimeDiagnostic(input.errorDetail);

      const now = new Date();
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
            ? now.getTime() - turn.startedAt.getTime()
            : null,
          errorKind: errorKind ?? null,
          errorDetail: errorDetail ?? null,
          finalAnswer: settledStatus === "COMPLETED" ? undefined : null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (settled.count === 0) return false;

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
        data:
          settledStatus === "FAILED"
            ? {
                status: "ERROR",
                eveSessionId: input.clearSession ? null : undefined,
                lastFailedAt: now,
                consecutiveTurnFailures: { increment: 1 },
              }
            : settledStatus === "COMPLETED"
              ? {
                  status: "IDLE",
                  eveSessionId: input.clearSession ? null : undefined,
                  lastSucceededAt: now,
                  consecutiveTurnFailures: 0,
                }
              : {
                  status: "IDLE",
                  eveSessionId: input.clearSession ? null : undefined,
                },
      });

      const scheduleRun = turn.scheduleRun;
      if (scheduleRun) {
        const completed = settledStatus === "COMPLETED";
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
            errorDetail: completed ? null : errorDetail,
          },
        });
        if (scheduleRunUpdate.count === 1) {
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
        if (settled) {
          // Lazy: the chat bridge pulls in realtime publishing, which the
          // control plane must not load for page/schedule turns or tests.
          const { finalizeSokoBotChatTurn, deliverSokoBotTurnToDirectRoom } =
            await import("@/services/soko-bot-chat.service");
          await finalizeSokoBotChatTurn(input.turnId).catch((error) => {
            console.error("Soko Bot chat write-back failed", {
              turnId: input.turnId,
              error: error instanceof Error ? error.message : "unknown",
            });
          });
          await deliverSokoBotTurnToDirectRoom(input.turnId).catch((error) => {
            console.error("Soko Bot direct-room delivery failed", {
              turnId: input.turnId,
              error: error instanceof Error ? error.message : "unknown",
            });
          });
          // Quality score for every settled turn; the lab re-judges its own
          // turns with the scenario rubric afterwards.
          const { judgeTurnQuality } = await import(
            "@/services/soko-bot-lab-judge.service"
          );
          // A turn still in flight when the switch was thrown settles here.
          // Scoring it is another model call, so it waits until the feature is
          // switched back on.
          const judgeAllowed = !(await getSokoBotAvailability()).disabled;
          void (
            judgeAllowed ? judgeTurnQuality(input.turnId) : Promise.resolve()
          ).catch(async (error) => {
            console.error("Soko Bot turn judge failed", {
              turnId: input.turnId,
              error: error instanceof Error ? error.message : "unknown",
            });
            // A judge that produced nothing usable still spent the tokens it
            // spent, and it fails most often on the turns that cost the most.
            const { recordFailedJudgeUsage } = await import(
              "@/services/soko-bot-lab-judge.service"
            );
            await recordFailedJudgeUsage(input.turnId, error);
          });
        }
        return settled;
      },
    );
  }

  async settleUndeliverableCancellation(turnId: string): Promise<boolean> {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: {
        id: turnId,
        status: "CANCEL_REQUESTED",
        eveSessionId: null,
      },
      select: { leaseToken: true },
    });
    if (!turn?.leaseToken) return false;
    return this.settleTurn({
      turnId,
      status: "CANCELLED",
      errorKind: "cancelled_before_runtime_start",
      errorDetail: "Soko Bot turn was cancelled before runtime acceptance",
      clearSession: true,
      leaseToken: turn.leaseToken,
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
    userId: string;
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

  async expireTurn(turnId: string): Promise<boolean> {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { id: turnId, status: { in: [...ACTIVE_TURN_STATUSES] } },
      select: {
        id: true,
        userId: true,
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
        console.warn("Soko Bot deadline cancellation failed", {
          turnId,
          error: error instanceof Error ? error.message : "unknown",
        });
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
    if (!message || message.length > 20_000) {
      throw new SokoBotValidationError("Message must be 1-20,000 characters");
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
    const bot = await prisma.sokoBot.findFirst({
      where: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        archivedAt: null,
      },
    });
    if (!bot) throw new SokoBotNotFoundError("Create a Soko Bot first");
    const duplicate = await prisma.sokoBotTurn.findUnique({
      where: {
        sokoBotId_clientTurnId: {
          sokoBotId: bot.id,
          clientTurnId,
        },
      },
    });
    const duplicateResult = (
      existing: NonNullable<typeof duplicate>,
    ): SokoBotTurnStartResult => ({
      turnId: existing.id,
      sokoBotId: existing.sokoBotId,
      sessionId: existing.eveSessionId ?? bot.eveSessionId ?? "",
      status: existing.status,
      route: existing.route ?? "CLARIFY",
      capabilities: existing.capabilityNames as SokoBotCapability[],
      duplicate: true,
      errorKind: existing.errorKind,
      reconciliationLeaseToken: existing.leaseToken ?? undefined,
    });
    if (duplicate) {
      if (
        duplicate.userMessage !== message ||
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
        message,
      );
      if (
        duplicate.status === "STARTING" &&
        duplicate.errorKind === "runtime_start_ambiguous" &&
        bot.status !== "PAUSED" &&
        bot.adminPausedAt === null
      ) {
        return this.resumeAmbiguousStart(bot, duplicate);
      }
      if (
        duplicate.status === "STARTING" &&
        duplicate.eveSessionId === null &&
        duplicate.createdAt.getTime() <=
          Date.now() - SOKO_BOT_START_RECOVERY_GRACE_MS &&
        bot.status !== "PAUSED" &&
        bot.adminPausedAt === null
      ) {
        const recovered = await this.recoverStartingTurn(duplicate.id);
        if (recovered) return recovered;
        const current = await prisma.sokoBotTurn.findUnique({
          where: { id: duplicate.id },
        });
        if (current) return duplicateResult(current);
      }
      return duplicateResult(duplicate);
    }
    if (bot.status === "PAUSED" || bot.adminPausedAt !== null) {
      throw new SokoBotBusyError("Soko Bot is paused");
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: input.workspaceId,
        OR: [
          { userId: input.userId },
          { organization: { members: { some: { userId: input.userId } } } },
        ],
      },
      select: { id: true },
    });
    if (!workspace) throw new SokoBotNotFoundError("Workspace not found");

    await requireSokoBotTurnFunding(input.userId, bot.id);

    const classifierContext = await this.classificationContext(
      input.userId,
      input.workspaceId,
    );
    const classification: ClassificationResult = await this.classifier.classify(
      message,
      classifierContext,
    );
    if (source === "SCHEDULE" && classification.failed) {
      throw new SokoBotRetryableStartError(
        "Soko Bot classifier unavailable for scheduled turn",
      );
    }
    const requestedByTeammate =
      input.chat?.askedByBot === true ||
      (!!input.chat?.requestedByUserId &&
        input.chat.requestedByUserId !== input.userId);
    // A teammate may ask the owner's bot questions but never spend the owner's
    // credits, create work in their name, or read the owner's private surfaces:
    // the answer is published back into the shared room.
    const version = await resolveSokoBotVersion(
      input.versionId ?? bot.versionId,
    );
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
    const routeCapabilities = SOKO_BOT_ROUTE_CAPABILITIES[
      classification.classification.route
    ] as readonly SokoBotCapability[];
    const capabilities = applyVersionCapabilities(
      version,
      (input.chat?.askedByBot
        ? [...SOKO_BOT_BOT_TO_BOT_CAPABILITIES]
        : requestedByTeammate
          ? [...SOKO_BOT_TEAMMATE_CAPABILITIES]
          : routeCapabilities) as readonly SokoBotCapability[],
    ) as readonly SokoBotCapability[];
    const deadlineAt = new Date(Date.now() + TURN_DEADLINE_MS);
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + TURN_LEASE_MS);
    // Eve only offers create-operation idempotency. A fresh session per Core
    // turn makes ambiguous retries exactly-once; Context carries bounded prior
    // conversation and durable memory supplies continuity across sessions.
    const sessionIdForTurn = null;
    // Build fallible context before publishing a durable STARTING turn. The
    // snapshot is then committed with the turn, leaving no crash window where
    // a recovery worker lacks the immutable packet needed for exact replay.
    const context = await this.contextBuilder.build({
      userId: input.userId,
      sokoBotId: bot.id,
      workspaceId: input.workspaceId,
      source: input.source ?? "CHAT",
      classification: classification.classification,
      audience: requestedByTeammate ? "TEAMMATE" : "OWNER",
      askedByKind: input.chat?.askedByBot
        ? "ASSISTANT"
        : requestedByTeammate
          ? "TEAMMATE"
          : "OWNER",
      askedByUserId: input.chat?.requestedByUserId ?? null,
    });
    const contextSnapshotId = randomUUID();

    let turn;
    try {
      const reservation = await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "orchestrator"
          WHERE "id" = ${bot.id}::uuid
          FOR UPDATE
        `;
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
                gte: localDayStart(new Date(), currentBot.ingestTimezone),
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
        const active = await tx.sokoBotTurn.findFirst({
          where: {
            sokoBotId: bot.id,
            status: { in: [...ACTIVE_TURN_STATUSES] },
          },
          select: { id: true },
        });
        if (active) throw new SokoBotBusyError("Soko Bot is already working");
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
        const created = await tx.sokoBotTurn.create({
          data: {
            sokoBotId: bot.id,
            userId: input.userId,
            workspaceId: input.workspaceId,
            source,
            status: "STARTING",
            route: classification.classification.route,
            clientTurnId,
            versionId: version.id,
            userMessage: message,
            chatMentionId: input.chat?.mentionId,
            chatResponseMessageId: input.chat?.responseMessageId,
            requestedByUserId: requestedByTeammate
              ? input.chat?.requestedByUserId
              : null,
            chainDepth: input.chat?.chainDepth ?? 0,
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
            leaseExpiresAt,
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
        await this.bindTurnReservation(tx, input, bot.id, created.id, message);
        const acquired = await tx.sokoBot.updateMany({
          where: {
            id: bot.id,
            archivedAt: null,
            adminPausedAt: null,
            status: { not: "PAUSED" },
          },
          data: {
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
          racedDuplicate.userMessage !== message ||
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
          message,
        );
        return duplicateResult(racedDuplicate);
      }
      throw error;
    }

    let acceptedRuntime:
      | { sessionId: string; createdSession: boolean }
      | undefined;
    try {
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
      });
      acceptedRuntime = {
        sessionId: runtimeTurn.sessionId,
        createdSession: true,
      };
      await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "orchestrator"
          WHERE "id" = ${bot.id}::uuid
          FOR UPDATE
        `;
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
            startedAt: new Date(runtimeTurn.acceptedAt),
            reconcilerHeartbeatAt: new Date(),
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
          data: {
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
      }, "Soko Bot acknowledgement collided with pause or cancellation");
      acceptedRuntime = undefined;
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
      if (acceptedRuntime) {
        currentAfterAcknowledgementFailure =
          await prisma.sokoBotTurn.findUnique({
            where: { id: turn.id },
          });
        if (
          currentAfterAcknowledgementFailure?.eveSessionId ===
          acceptedRuntime.sessionId
        ) {
          return duplicateResult(currentAfterAcknowledgementFailure);
        }
        if (
          currentAfterAcknowledgementFailure?.leaseToken !== leaseToken ||
          !(await this.retainStartLease(turn.id, leaseToken))
        ) {
          throw error;
        }
      }
      if (acceptedRuntime?.createdSession) {
        try {
          await this.runtime.resetSession({
            sessionId: acceptedRuntime.sessionId,
            reason: "Soko Bot start acknowledgement failed",
          });
          acceptedSessionWasReset = true;
        } catch (cleanupError) {
          console.warn("Soko Bot unacknowledged runtime cleanup failed", {
            turnId: turn.id,
            error:
              cleanupError instanceof Error ? cleanupError.message : "unknown",
          });
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
              eveSessionId: acceptedRuntime?.sessionId,
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
        (acceptedRuntime !== undefined &&
          (!acceptedRuntime.createdSession || !acceptedSessionWasReset))
      ) {
        await prisma.sokoBotTurn.updateMany({
          where: { id: turn.id, status: "STARTING", leaseToken },
          data: {
            errorKind: "runtime_start_ambiguous",
            errorDetail:
              error instanceof Error
                ? safeRuntimeDiagnostic(error.message)
                : "Eve acceptance response was lost",
            reconcilerHeartbeatAt: null,
          },
        });
      } else {
        await this.failStartedTurn(turn.id, error, leaseToken);
      }
      throw error;
    }
  }

  async reconcileTurn(
    turnId: string,
    signal?: AbortSignal,
    expectedLeaseToken?: string,
  ): Promise<void> {
    const turn = await prisma.sokoBotTurn.findUnique({ where: { id: turnId } });
    if (!turn?.eveSessionId || !turn.leaseToken) {
      throw new SokoBotNotFoundError("Runtime turn not found");
    }
    const eveSessionId = turn.eveSessionId;
    const leaseToken = expectedLeaseToken ?? turn.leaseToken;
    if (turn.leaseToken !== leaseToken) {
      throw new SokoBotReconciliationLeaseLostError(
        "Soko Bot reconciliation lease was replaced",
      );
    }

    let aggregateUsage = parseTurnUsage(turn.usage);
    let aggregateCostUsdMicros = turn.costUsdMicros ?? 0n;
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
    let pendingErrorKind = turn.errorKind ?? undefined;
    let pendingErrorDetail = turn.errorDetail ?? undefined;
    let boundEveTurnId = turn.eveTurnId;
    let candidateTurnStarted: IndexedRuntimeEvent | null = null;

    const deliverBoundCancellation = async (): Promise<void> => {
      if (!boundEveTurnId) return;
      const current = await prisma.sokoBotTurn.findUnique({
        where: { id: turn.id },
        select: { status: true },
      });
      if (current?.status !== "CANCEL_REQUESTED") return;
      try {
        await this.runtime.cancelTurn({
          sessionId: eveSessionId,
          eveTurnId: boundEveTurnId,
        });
      } catch (error) {
        console.warn("Soko Bot cancellation redelivery failed", {
          turnId: turn.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    };

    const heartbeat = async (): Promise<void> => {
      const updated = await prisma.sokoBotTurn.updateMany({
        where: {
          id: turn.id,
          leaseToken,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        data: {
          reconcilerHeartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + TURN_LEASE_MS),
        },
      });
      if (updated.count === 0) {
        throw new SokoBotReconciliationLeaseLostError(
          "Soko Bot reconciliation lease was lost",
        );
      }
    };

    const persistEvent = async (
      indexed: IndexedRuntimeEvent,
      data: Prisma.SokoBotTurnUpdateManyMutationInput = {},
    ): Promise<boolean> => {
      return prisma.$transaction(async (tx) => {
        const projection = safeEventProjection(
          indexed.event.type,
          indexed.event.data,
        );
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
              summary: projection.summary,
              payload: projection.payload,
              toolName: projection.toolName,
              toolCallId: projection.toolCallId,
              toolStatus: projection.toolStatus,
              providerAt: new Date(indexed.event.meta.at),
            },
          ],
          skipDuplicates: true,
        });
        const updated = await tx.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            leaseToken,
            status: { in: [...ACTIVE_TURN_STATUSES] },
          },
          data: {
            ...(persisted.count === 1 ? data : {}),
            eveStreamIndex: indexed.startIndex,
            reconcilerHeartbeatAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + TURN_LEASE_MS),
          },
        });
        if (updated.count === 0) {
          throw new SokoBotReconciliationLeaseLostError(
            "Soko Bot reconciliation lease was lost",
          );
        }
        return persisted.count === 1;
      });
    };

    const advancePastUnownedEvent = async (streamIndex: number) => {
      const updated = await prisma.sokoBotTurn.updateMany({
        where: {
          id: turn.id,
          leaseToken,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        data: {
          eveStreamIndex: streamIndex,
          reconcilerHeartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + TURN_LEASE_MS),
        },
      });
      if (updated.count === 0) {
        throw new SokoBotReconciliationLeaseLostError(
          "Soko Bot reconciliation lease was lost",
        );
      }
    };

    const heartbeatTimer = setInterval(() => {
      void heartbeat().catch(() => {
        // Fenced writes below remain authoritative. Timer failures surface on
        // next event or watchdog takeover without creating an unhandled task.
      });
    }, RECONCILER_HEARTBEAT_MS);
    heartbeatTimer.unref();

    try {
      await heartbeat();
      await deliverBoundCancellation();
      for await (const indexed of this.runtime.streamEvents({
        sessionId: turn.eveSessionId,
        startIndex: turn.eveStreamIndex + 1,
        signal,
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

        const turnData: Prisma.SokoBotTurnUpdateManyMutationInput = {};
        let nextAggregateUsage: SokoBotTurnUsage | null = null;
        let nextAggregateCostUsdMicros: bigint | null = null;
        if (
          indexed.event.type === "step.started" &&
          typeof indexed.event.data.modelId === "string"
        ) {
          turnData.modelId = indexed.event.data.modelId.slice(0, 240);
        } else if (indexed.event.type === "step.completed") {
          const nextUsage = addTurnUsage(
            aggregateUsage,
            indexed.event.data.usage,
          );
          if (nextUsage) {
            nextAggregateUsage = nextUsage;
            nextAggregateCostUsdMicros =
              aggregateCostUsdMicros +
              BigInt(
                Math.round(
                  nonnegativeNumber(
                    (indexed.event.data.usage as Record<string, unknown>)
                      .costUsd,
                  ) * 1_000_000,
                ),
              );
            turnData.usage = jsonInput(nextAggregateUsage);
            turnData.costUsdMicros = nextAggregateCostUsdMicros;
          }
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
            typeof indexed.event.data.code === "string"
              ? safeRuntimeDiagnostic(indexed.event.data.code, 120)
              : "runtime_failed";
          pendingErrorDetail =
            typeof indexed.event.data.message === "string"
              ? safeRuntimeDiagnostic(indexed.event.data.message)
              : undefined;
          turnData.errorKind = pendingErrorKind;
          turnData.errorDetail = pendingErrorDetail;
        }
        const eventWasNew = await persistEvent(indexed, turnData);
        if (
          eventWasNew &&
          turn.chatResponseMessageId &&
          (indexed.event.type === "actions.requested" ||
            indexed.event.type === "action.result")
        ) {
          const { publishSokoBotChatProgress } = await import(
            "@/services/soko-bot-chat.service"
          );
          await publishSokoBotChatProgress(turn.id).catch((error) => {
            console.warn("Soko Bot chat progress publish failed", {
              turnId: turn.id,
              error: error instanceof Error ? error.message : "unknown",
            });
          });
        }
        if (
          eventWasNew &&
          nextAggregateUsage &&
          nextAggregateCostUsdMicros !== null
        ) {
          aggregateUsage = nextAggregateUsage;
          aggregateCostUsdMicros = nextAggregateCostUsdMicros;
        }

        if (indexed.event.type === "input.requested") {
          try {
            await this.runtime.cancelTurn({
              sessionId: turn.eveSessionId,
              eveTurnId: boundEveTurnId ?? undefined,
            });
          } catch (error) {
            console.warn("Soko Bot unsupported input cancellation failed", {
              turnId: turn.id,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
          await this.settleTurn({
            turnId: turn.id,
            status: "FAILED",
            errorKind: "runtime_input_unsupported",
            errorDetail:
              "Eve requested interactive input outside the Soko Bot decision protocol",
            clearSession: true,
            leaseToken,
          });
          break;
        }

        if (indexed.event.type === "session.waiting") {
          await this.settleTurn({
            turnId: turn.id,
            status: pendingStatus ?? "COMPLETED",
            errorKind: pendingErrorKind,
            errorDetail: pendingErrorDetail,
            providerCompletedAt: pendingCompletedAt,
            leaseToken,
          });
          break;
        }
        if (
          indexed.event.type === "session.failed" ||
          indexed.event.type === "session.completed"
        ) {
          await this.settleTurn({
            turnId: turn.id,
            status:
              indexed.event.type === "session.failed"
                ? "FAILED"
                : (pendingStatus ?? "COMPLETED"),
            errorKind: pendingErrorKind,
            errorDetail: pendingErrorDetail,
            providerCompletedAt: pendingCompletedAt,
            clearSession: true,
            leaseToken,
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
      const expired = turn.deadlineAt.getTime() <= Date.now();
      if (expired) {
        await this.expireTurn(turn.id);
      } else {
        await prisma.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            leaseToken,
            status: { in: [...ACTIVE_TURN_STATUSES] },
          },
          data: {
            errorKind: "runtime_stream_interrupted",
            errorDetail: detail,
            reconcilerHeartbeatAt: new Date(),
          },
        });
      }
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  async cancelTurn(userId: string, turnId: string): Promise<void> {
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { id: turnId, userId },
    });
    if (!turn) throw new SokoBotNotFoundError("Active turn not found");
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

  async resetMemory(userId: string, workspaceId: string) {
    const markdown = renderSokoBotMemory(createEmptySokoBotMemory());
    const hash = memoryHash(markdown);
    return serializableTransaction(async (tx) => {
      const bot = await tx.sokoBot.findFirst({
        where: { userId, workspaceId, archivedAt: null },
      });
      if (!bot) throw new SokoBotNotFoundError("Soko Bot not found");
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
  ) {
    // Built-in or console-authored; both share one id namespace. Authored
    // versions are selectable only once promoted, except from the admin lab.
    const known = options.allowUnpromoted
      ? await isKnownSokoBotVersionId(versionId)
      : await isSelectableSokoBotVersionId(versionId, userId);
    if (!known) {
      throw new SokoBotValidationError("Unknown Soko Bot version");
    }
    const updated = await prisma.sokoBot.updateMany({
      where: { userId, workspaceId, archivedAt: null },
      data: { versionId },
    });
    if (updated.count === 0)
      throw new SokoBotNotFoundError("Soko Bot not found");
  }

  /**
   * How many live bots run each version, counted across the whole fleet.
   *
   * The fleet page lists one page of bots; deriving the counts from that page
   * would tell an operator they are about to move twenty when the migration
   * moves every matching bot in the database.
   */
  async versionUsage(): Promise<{ versionId: string; count: number }[]> {
    const rows = await prisma.sokoBot.groupBy({
      by: ["versionId"],
      where: { archivedAt: null, versionId: { not: null } },
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
    requestId?: string;
    traceId?: string;
  }): Promise<{
    total: number;
    moved: number;
    alreadyOnVersion: number;
    failed: number;
    failures: { sokoBotId: string; message: string }[];
  }> {
    if (!(await isKnownSokoBotVersionId(input.toVersionId))) {
      throw new SokoBotValidationError(
        `Unknown Soko Bot version ${input.toVersionId}`,
      );
    }
    const bots = await prisma.sokoBot.findMany({
      where: {
        archivedAt: null,
        ...(input.fromVersionId ? { versionId: input.fromVersionId } : {}),
      },
      select: { id: true, versionId: true },
      orderBy: { id: "asc" },
    });
    // One base per run, not one supplied by the caller. A caller-supplied id
    // would make a retry replay each bot's recorded outcome, which is exactly
    // backwards: the bots worth retrying are the ones that failed.
    const runId = randomUUID();
    const failures: { sokoBotId: string; message: string }[] = [];
    let moved = 0;
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
      }
    }
    return {
      total: bots.length,
      moved,
      alreadyOnVersion,
      failed,
      failures,
    };
  }

  async createSchedule(input: CreateSokoBotScheduleInput) {
    return translateScheduleErrors(() => createSokoBotSchedule(input));
  }

  async updateSchedule(input: UpdateSokoBotScheduleInput) {
    return translateScheduleErrors(() => updateSokoBotSchedule(input));
  }

  async deleteSchedule(userId: string, scheduleId: string): Promise<void> {
    await translateScheduleErrors(() =>
      deleteSokoBotSchedule(userId, { scheduleId }),
    );
  }

  async listForAdmin(
    query: string | undefined,
    options: { cursor?: string; take?: number } = {},
  ) {
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
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
    const where: Prisma.SokoBotWhereInput = term
      ? {
          deletedAt: null,
          OR: [
            ...(idTerm ? [{ id: idTerm }] : []),
            { name: { contains: term, mode: "insensitive" } },
            { user: { name: { contains: term, mode: "insensitive" } } },
            { user: { email: { contains: term, mode: "insensitive" } } },
          ],
        }
      : { deletedAt: null };
    const [items, total] = await prisma.$transaction([
      prisma.sokoBot.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(options.cursor
          ? { cursor: { id: options.cursor }, skip: 1 }
          : undefined),
        include: {
          user: { select: { id: true, name: true, email: true } },
          _count: {
            select: { turns: true, pendingDecisions: true, schedules: true },
          },
        },
      }),
      prisma.sokoBot.count({ where }),
    ]);
    const hasMore = items.length > take;
    if (hasMore) items.pop();
    return { items, total, hasMore };
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
            delegations: true,
            pendingDecisions: true,
            contextSnapshot: true,
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
      if (!(await isKnownSokoBotVersionId(input.versionId))) {
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
      userId: bot.userId,
      operatorId: input.operatorId,
      action: input.action,
      targetId: resolvedTargetId,
      reason,
    };

    if (!existing) {
      try {
        await prisma.sokoBotAdminAction.create({
          data: {
            operationId,
            status: "ATTEMPTED",
            ...intent,
            before: jsonInput(before),
            requestId,
            traceId,
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
            after: after ? jsonInput(after) : undefined,
            ...failure,
            requestId,
            traceId,
          },
        });
      } catch (auditError) {
        if (!isPrismaUniqueViolation(auditError)) {
          console.error("Failed to append Soko Bot admin action outcome", {
            operationId,
            sokoBotId: bot.id,
          });
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
        userId: string;
        sokoBotId: string;
        workspaceId: string;
        eveSessionId: string | null;
        eveTurnId: string | null;
      } | null = null;
      try {
        active = await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "orchestrator"
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
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              userId: true,
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
              requestId,
              traceId,
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
        } catch {
          console.warn("Soko Bot runtime cancellation failed during pause", {
            sokoBotId: bot.id,
            turnId: active.id,
          });
        }
      }
    } else if (input.action === "RESUME") {
      try {
        await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "orchestrator"
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
              requestId,
              traceId,
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
              requestId,
              traceId,
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
        await serializableTransaction(async (tx) => {
          const current = await tx.sokoBot.findUnique({
            where: { id: bot.id },
          });
          if (!current || current.archivedAt) {
            throw new SokoBotNotFoundError("Soko Bot not found");
          }
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
              requestId,
              traceId,
            },
          });
        }, "Soko Bot version changed concurrently");
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
            FROM "orchestrator"
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
              status: { in: [...ACTIVE_TURN_STATUSES] },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, eveSessionId: true },
          });
          const resetLeaseToken = activeTurn ? randomUUID() : null;
          if (activeTurn && resetLeaseToken) {
            const fenced = await tx.sokoBotTurn.updateMany({
              where: {
                id: activeTurn.id,
                status: activeTurn.status,
              },
              data: {
                status: "CANCEL_REQUESTED",
                cancellationRequestedAt:
                  activeTurn.status === "CANCEL_REQUESTED"
                    ? undefined
                    : new Date(),
                leaseToken: resetLeaseToken,
              },
            });
            if (fenced.count === 0) {
              throw new SokoBotBusyError(
                "Active Soko Bot turn changed while reset was being prepared",
              );
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
        await recordFailure(error);
        throw error;
      }

      if (intent.targetId && resetPreparation.sessionTurn) {
        const resetTurn = resetPreparation.sessionTurn;
        // RESET_SESSION is idempotent. Any failure leaves ATTEMPTED open and
        // the bot fenced PAUSED; exact operation replay resumes it.
        await this.runtime.resetSession({
          sessionId: resetTurn.eveSessionId,
          reason,
        });
      }

      if (resetPreparation.activeTurn) {
        await this.settleTurn({
          turnId: resetPreparation.activeTurn.id,
          status: "CANCELLED",
          errorKind: "session_reset",
          errorDetail: "Runtime session was reset by an administrator",
          clearSession: true,
          leaseToken: resetPreparation.activeTurn.leaseToken,
        });
      }

      try {
        await serializableTransaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "orchestrator"
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
              requestId,
              traceId,
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
              requestId,
              traceId,
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
      const scheduleRun = await prisma.sokoBotScheduleRun.findFirst({
        where: {
          id: input.targetId,
          schedule: { sokoBotId: bot.id },
        },
        include: {
          schedule: true,
          turn: {
            select: {
              id: true,
              source: true,
              clientTurnId: true,
              status: true,
            },
          },
        },
      });
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
        const occurrencePrompt =
          scheduleRun.prompt ?? scheduleRun.schedule.prompt;
        retry = await this.startTurn({
          userId: bot.userId,
          workspaceId: scheduleRun.schedule.workspaceId,
          clientTurnId: retryClientTurnId,
          message: occurrencePrompt,
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
            requestId,
            traceId,
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
        retry = await this.startTurn({
          userId: bot.userId,
          workspaceId: failed.workspaceId,
          clientTurnId: `admin-retry:${failed.id}:${adminRetryOperationKey(operationId)}`,
          message: failed.userMessage,
          source: "ADMIN_RETRY",
          // A retry replays untrusted text, so it must not replay it with a
          // wider grant than the turn that failed. Dropping these turned a
          // failed depth-1 turn another assistant asked for — read-only, and
          // its message written by that assistant — into an owner-audience
          // turn holding the whole route ceiling.
          ...(failed.chainDepth > 0 || failed.requestedByUserId
            ? {
                chat: {
                  mentionId: failed.chatMentionId ?? "",
                  responseMessageId: failed.chatResponseMessageId ?? "",
                  requestedByUserId: failed.requestedByUserId,
                  askedByBot: failed.chainDepth > 0,
                  chainDepth: failed.chainDepth,
                },
              }
            : {}),
        });
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
          requestId,
          traceId,
        },
      });
    }
  }

  /** One bot, with its refreshed diagnostics for the operator screen. */
  async performAdminAction(
    input: Parameters<SokoBotControlPlane["applyAdminAction"]>[0],
  ) {
    await this.applyAdminAction(input);
    return this.getForAdmin(input.sokoBotId);
  }

  async archive(userId: string, workspaceId: string): Promise<void> {
    const archived = await serializableTransaction(async (tx) => {
      const bot = await tx.sokoBot.findFirst({
        where: { userId, workspaceId, archivedAt: null },
      });
      if (!bot) return null;
      await tx.$queryRaw`
        SELECT "id"
        FROM "orchestrator"
        WHERE "id" = ${bot.id}::uuid
        FOR UPDATE
      `;
      const activeTurn = await tx.sokoBotTurn.findFirst({
        where: {
          sokoBotId: bot.id,
          status: { in: [...ACTIVE_TURN_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
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
          where: { orchestratorId: bot.id },
          error: "Personal assistant is no longer a member of this room",
        },
        tx,
      );
      await tx.chatRoomOrchestratorMember.deleteMany({
        where: { orchestratorId: bot.id },
      });
      return { activeTurn, mentionMessageIds };
    }, "Soko Bot archive collided with active work");
    if (!archived) return;
    await publishChatRoomMentionStatuses(archived.mentionMessageIds);
    if (!archived.activeTurn) return;
    try {
      await this.deliverRuntimeCancellation(archived.activeTurn);
    } catch (error) {
      console.warn("Soko Bot runtime cancellation failed during archive", {
        sokoBotId: archived.activeTurn.sokoBotId,
        turnId: archived.activeTurn.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

export const sokoBotControlPlane = new SokoBotControlPlane();

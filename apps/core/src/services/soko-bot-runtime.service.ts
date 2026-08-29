import { createHash, randomUUID } from "node:crypto";
import {
  AgentJobStatus,
  Channel,
  type Prisma,
  TaskStatus,
} from "@sokosumi/database";
import { createAgentClient } from "@sokosumi/masumi";
import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import {
  sokoBotAgentIdInputSchema as agentIdInputSchema,
  composeSystemPrompt,
  sokoBotCreateScheduleInputSchema as createScheduleInputSchema,
  sokoBotDecisionInputSchema as decisionInputSchema,
  exceedsUnattendedHireBudget,
  hasSokoBotNegatedMutationIntent,
  sokoBotHireAgentInputSchema as hireAgentInputSchema,
  isSokoBotCapability,
  isSokoBotDecisionTarget,
  isSokoBotNegatableWrite,
  sokoBotJobIdInputSchema as jobIdInputSchema,
  sokoBotLinkTasksInputSchema as linkTasksInputSchema,
  sokoBotMemoryUpdateInputSchema as memoryUpdateInputSchema,
  parseSokoBotMemory,
  sokoBotProvideJobInputSchema as provideJobInputSchema,
  redactSokoBotSensitiveText,
  renderSokoBotMemory,
  sokoBotReplyToTaskInputSchema as replyToTaskInputSchema,
  type SokoBotCapability,
  type SokoBotDecisionTarget,
  type SokoBotTurnGrantClaims,
  sanitizeSokoBotMemoryMarkdown,
  sokoBotScheduleIdInputSchema as scheduleIdInputSchema,
  sokoBotSearchInputSchema as searchInputSchema,
  sokoBotListCalendarEventsInputSchema,
  sokoBotListFilesInputSchema,
  sokoBotListIntegrationToolsInputSchema,
  sokoBotPostChatInputSchema,
  sokoBotReadChatInputSchema,
  sokoBotReadEmailInputSchema,
  sokoBotRunIntegrationToolInputSchema,
  sokoBotSearchInboxInputSchema,
  sokoBotUploadFileInputSchema,
  sokoBotAssignTaskInputSchema as taskAssignInputSchema,
  sokoBotCreateTaskInputSchema as taskCreateInputSchema,
  sokoBotTaskIdInputSchema as taskIdInputSchema,
  sokoBotUpdateTaskInputSchema as taskUpdateInputSchema,
  sokoBotUpdateAssignedTaskInputSchema as updateAssignedTaskInputSchema,
  sokoBotUpdateScheduleInputSchema as updateScheduleInputSchema,
} from "@sokosumi/soko-bot";
import {
  buildUserDriveFilePathname,
  buildUserDriveFilePrefix,
} from "@sokosumi/utils";
import { list, put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/config/env";
import { toMasumiAgent } from "@/helpers/agent";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { createAgentJobForUser } from "@/helpers/job";
import { applyGuardedTaskStatusUpdate } from "@/helpers/task-event-charge";
import { mapTaskLinkRelationToWriteData } from "@/helpers/task-link";
import prisma from "@/lib/db/prisma";
import {
  chatChainMayWake,
  MAX_CHAT_CHAIN_DEPTH,
  nextChatChainDepth,
  ROOM_BOT_MESSAGE_WINDOW_MS,
  ROOM_BOT_MESSAGES_PER_HOUR,
} from "@/lib/soko-bot/chat-chain";
import { sanitizePersistedValue } from "@/lib/soko-bot/persisted-value";
import { resolveMentionedCoworkerIds } from "@/routes/v1/chats/rooms/helpers";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";

const MAX_BOT_COMMENTS_PER_TASK_PER_DAY = 3;

import { serializableTransaction } from "@/lib/db/transaction";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessage,
  fetchInboxMessages,
  listIntegrationTools,
  listSokoBotIntegrations,
  runIntegrationTool,
} from "@/services/soko-bot-integrations.service";
import {
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  listSokoBotSchedules,
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  createTaskForActor,
  updateTaskForActor,
} from "@/services/task-domain.service";

const ACTIVE_STATUSES = ["STARTING", "RUNNING", "CANCEL_REQUESTED"] as const;
const DECISION_TTL_MS = 24 * 60 * 60 * 1_000;
const DECISION_PENDING_MESSAGE =
  "Owner approval requested. Do not call this tool again with the same input; tell the owner what is pending and finish the turn.";
const TOOL_CALL_STALE_MS = 2 * 60 * 1_000;
const TOOL_CALL_LIMIT_PER_TURN = 64;
const TOOL_RESULT_MAX_BYTES = 16_384;
const ERROR_DETAIL_MAX_BYTES = 1_000;
const SELLER_RESERVATION_MARKER_VERSION = 1;

interface SellerReservationMarker {
  version: typeof SELLER_RESERVATION_MARKER_VERSION;
  attemptId: string;
  reservedAt: string;
  proposalHash: string;
  error?: string;
}

function parseHireAgentInput(input: unknown) {
  const parsed = hireAgentInputSchema.parse(input);
  return {
    ...parsed,
    inputSchema: inputSchemaSchema.parse(parsed.inputSchema),
  };
}

function parseDecisionProposal(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
) {
  switch (toolName) {
    case "create_task":
      return taskCreateInputSchema.parse(proposal);
    case "update_task":
      return taskUpdateInputSchema.parse(proposal);
    case "assign_task":
      return taskAssignInputSchema.parse(proposal);
    case "hire_agent":
      return parseHireAgentInput(proposal);
    case "provide_job_input":
      return provideJobInputSchema.parse(proposal);
  }
}

function decisionReason(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
): string {
  switch (toolName) {
    case "create_task": {
      const input = taskCreateInputSchema.parse(proposal);
      return `Create ${input.status} Task`;
    }
    case "update_task": {
      const input = taskUpdateInputSchema.parse(proposal);
      return `Update Task ${input.taskId}`;
    }
    case "assign_task": {
      const input = taskAssignInputSchema.parse(proposal);
      return `Assign Task ${input.taskId} to Coworker ${input.coworkerId}`;
    }
    case "hire_agent": {
      const input = parseHireAgentInput(proposal);
      return `Hire Agent ${input.agentId} with a maximum of ${input.maxCredits} credits`;
    }
    case "provide_job_input": {
      const input = provideJobInputSchema.parse(proposal);
      return `Send approved input to Agent Job ${input.jobId}`;
    }
  }
}

/**
 * Owner-facing approval text: names instead of ids where they resolve, and
 * the plain id otherwise. Names are display data, never authorization.
 */
async function describeDecision(
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
): Promise<string> {
  const quote = (name: string | null | undefined, id: string) =>
    name?.trim() ? `"${name.trim()}"` : id;
  try {
    switch (toolName) {
      case "assign_task": {
        const input = taskAssignInputSchema.parse(proposal);
        const [task, coworker] = await Promise.all([
          prisma.task.findUnique({
            where: { id: input.taskId },
            select: { name: true },
          }),
          prisma.coworker.findUnique({
            where: { id: input.coworkerId },
            select: { name: true },
          }),
        ]);
        return `Assign Task ${quote(task?.name, input.taskId)} to Coworker ${quote(coworker?.name, input.coworkerId)}${input.ready ? " and start it" : ""}`;
      }
      case "update_task": {
        const input = taskUpdateInputSchema.parse(proposal);
        const task = await prisma.task.findUnique({
          where: { id: input.taskId },
          select: { name: true },
        });
        return `Update Task ${quote(task?.name, input.taskId)}`;
      }
      case "hire_agent": {
        const input = parseHireAgentInput(proposal);
        const agent = await prisma.agent.findUnique({
          where: { id: input.agentId },
          select: { name: true },
        });
        return `Hire Agent ${quote(agent?.name, input.agentId)} with a maximum of ${input.maxCredits} credits`;
      }
      default:
        return decisionReason(toolName, proposal);
    }
  } catch {
    return decisionReason(toolName, proposal);
  }
}

export interface RuntimeAuthorizationInput {
  sessionId: string;
  turnId: string;
  capability?: SokoBotCapability;
}

export interface SokoBotActionContext {
  turn: {
    id: string;
    sokoBotId: string;
    userId: string;
    workspaceId: string;
    eveSessionId: string | null;
    // Required, not optional: both were silently dropped from authorize()'s
    // return once, which made every turn resolve the default version and
    // disabled the DRAFT-only rule for self-started work.
    versionId: string | null;
    source: string | null;
    /** Bot-to-bot hops behind this turn; see lib/soko-bot/chat-chain.ts. */
    chainDepth: number;
  };
  classificationConfidence: number;
  hasNegatedMutationIntent: boolean;
}

export interface AuthorizedSokoBotRuntime extends SokoBotActionContext {
  grant: SokoBotTurnGrantClaims;
}

export interface ExecuteSokoBotToolInput extends RuntimeAuthorizationInput {
  capability: SokoBotCapability;
  toolCallId: string;
  input: unknown;
}

export class SokoBotRuntimeAuthorizationError extends Error {}
export class SokoBotRuntimeConflictError extends Error {}
export class SokoBotRuntimeValidationError extends Error {}

/** Schedule tools never need approval; their domain errors become tool errors the model can read. */
async function runScheduleTool<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SokoBotScheduleNotFoundError ||
      error instanceof SokoBotScheduleValidationError
    ) {
      throw new SokoBotRuntimeValidationError(error.message);
    }
    throw error;
  }
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sellerProposalHash(
  toolName: "hire_agent" | "provide_job_input",
  proposal: unknown,
): string {
  return createHash("sha256")
    .update(`${toolName}:${canonicalJson(proposal)}`)
    .digest("hex");
}

function createSellerReservationMarker(
  toolName: "hire_agent" | "provide_job_input",
  proposal: unknown,
): SellerReservationMarker {
  return {
    version: SELLER_RESERVATION_MARKER_VERSION,
    attemptId: randomUUID(),
    reservedAt: new Date().toISOString(),
    proposalHash: sellerProposalHash(toolName, proposal),
  };
}

function serializeSellerReservationMarker(
  marker: SellerReservationMarker,
  error?: unknown,
): string {
  return JSON.stringify({
    ...marker,
    ...(error === undefined ? {} : { error: persistedErrorDetail(error) }),
  });
}

function persistedToolResult(value: unknown): Prisma.InputJsonValue {
  const sanitized = sanitizePersistedValue(value);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, "utf8") <= TOOL_RESULT_MAX_BYTES) {
    return jsonInput(sanitized);
  }
  const emptyWrapper = JSON.stringify({ truncated: true, preview: "" });
  let preview = truncateUtf8(
    serialized,
    TOOL_RESULT_MAX_BYTES - Buffer.byteLength(emptyWrapper, "utf8"),
  );
  let wrapper = { truncated: true, preview };
  while (
    Buffer.byteLength(JSON.stringify(wrapper), "utf8") > TOOL_RESULT_MAX_BYTES
  ) {
    const excess =
      Buffer.byteLength(JSON.stringify(wrapper), "utf8") -
      TOOL_RESULT_MAX_BYTES;
    preview = truncateUtf8(
      preview,
      Math.max(0, Buffer.byteLength(preview, "utf8") - excess - 1),
    );
    wrapper = { truncated: true, preview };
  }
  return jsonInput(wrapper);
}

function persistedErrorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown error";
  return truncateUtf8(
    redactSokoBotSensitiveText(detail),
    ERROR_DETAIL_MAX_BYTES,
  );
}

function hashMemory(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

/**
 * The runtime executes inside Core, so a turn's scope is read from the row the
 * control plane wrote rather than from a signed grant carried across a network
 * hop. The claims shape is unchanged: capability scoping, the context snapshot
 * a turn is pinned to, and the memory version it was handed all still gate what
 * a tool call may do.
 */
function buildTurnGrant(
  turn: {
    id: string;
    sokoBotId: string;
    userId: string;
    workspaceId: string;
    capabilityNames: string[];
    contextSnapshot: { id: string; packet: Prisma.JsonValue } | null;
  },
  sessionId: string,
): SokoBotTurnGrantClaims {
  if (!turn.contextSnapshot) {
    throw new SokoBotRuntimeAuthorizationError(
      "Context snapshot is unavailable",
    );
  }
  const packet = turn.contextSnapshot.packet;
  const memory =
    packet && typeof packet === "object" && !Array.isArray(packet)
      ? (packet as Record<string, unknown>).memory
      : null;
  const memoryVersion =
    memory && typeof memory === "object" && !Array.isArray(memory)
      ? (memory as Record<string, unknown>).version
      : null;
  return {
    issuer: "sokosumi-core",
    audience: "soko-bot-core",
    subject: turn.sokoBotId,
    jwtId: `in-process:${turn.id}`,
    sessionId,
    turnId: turn.id,
    sokoBotId: turn.sokoBotId,
    userId: turn.userId,
    workspaceId: turn.workspaceId,
    contextSnapshotId: turn.contextSnapshot.id,
    memoryRevisionId: null,
    memoryVersion: typeof memoryVersion === "number" ? memoryVersion : 0,
    capabilities: turn.capabilityNames.filter(isSokoBotCapability),
    issuedAt: 0,
    expiresAt: 0,
  };
}

function sokoBotWorkspaceAccessWhere(
  userId: string,
  workspaceId: string,
): Prisma.WorkspaceWhereInput {
  return {
    id: workspaceId,
    OR: [{ userId }, { organization: { members: { some: { userId } } } }],
  };
}

async function requireSokoBotWorkspaceAccess(
  client: Pick<Prisma.TransactionClient, "workspace">,
  userId: string,
  workspaceId: string,
) {
  const workspace = await client.workspace.findFirst({
    where: sokoBotWorkspaceAccessWhere(userId, workspaceId),
    select: { id: true, organizationId: true },
  });
  if (!workspace) {
    throw new SokoBotRuntimeAuthorizationError(
      "Workspace access is no longer available",
    );
  }
  return workspace;
}

export function isSokoBotDecisionTargetAllowed(
  toolName: string,
  capabilities: readonly string[],
): boolean {
  return (
    isSokoBotDecisionTarget(toolName) &&
    isSokoBotCapability(toolName) &&
    capabilities.includes(toolName)
  );
}

export class SokoBotRuntimeService {
  async authorize(
    input: RuntimeAuthorizationInput,
  ): Promise<AuthorizedSokoBotRuntime> {
    const env = getEnv();
    if (!env.SOKO_BOT_ENABLED) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot is not enabled");
    }
    // Re-checked on every tool call, so a turn already running when an
    // administrator threw the switch stops at its next action instead of
    // finishing its work.
    if ((await getSokoBotAvailability()).disabled) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot is temporarily disabled by an administrator",
      );
    }
    const turn = await prisma.sokoBotTurn.findUnique({
      where: { id: input.turnId },
      select: {
        id: true,
        sokoBotId: true,
        userId: true,
        workspaceId: true,
        eveSessionId: true,
        status: true,
        classification: true,
        userMessage: true,
        versionId: true,
        source: true,
        chainDepth: true,
        deadlineAt: true,
        leaseExpiresAt: true,
        capabilityNames: true,
        contextSnapshot: { select: { id: true, packet: true } },
        sokoBot: {
          select: {
            adminPausedAt: true,
            archivedAt: true,
            status: true,
          },
        },
      },
    });
    if (!turn || turn.sokoBot.archivedAt) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot turn is unavailable",
      );
    }
    if (
      !ACTIVE_STATUSES.includes(turn.status as (typeof ACTIVE_STATUSES)[number])
    ) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot turn is not active");
    }
    if (turn.status === "CANCEL_REQUESTED") {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot turn cancellation is pending",
      );
    }
    if (turn.sokoBot.status === "PAUSED" || turn.sokoBot.adminPausedAt) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot is paused");
    }
    const now = Date.now();
    if (
      turn.deadlineAt.getTime() <= now ||
      !turn.leaseExpiresAt ||
      turn.leaseExpiresAt.getTime() <= now
    ) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot turn lease expired");
    }
    const grant = buildTurnGrant(turn, input.sessionId);
    if (input.capability && !grant.capabilities.includes(input.capability)) {
      throw new SokoBotRuntimeAuthorizationError(
        "Capability is not granted for this turn",
      );
    }
    let storedSessionId = turn.eveSessionId;
    if (storedSessionId === null) {
      storedSessionId = await serializableTransaction(async (tx) => {
        // Same bot-row-first order as administrator PAUSE. Session attachment
        // either commits before PAUSE or reloads its paused state and fails.
        await tx.$queryRaw`
          SELECT "id"
          FROM "orchestrator"
          WHERE "id" = ${turn.sokoBotId}::uuid
          FOR UPDATE
        `;
        await tx.$queryRaw`
          SELECT "id"
          FROM "soko_bot_turn"
          WHERE "id" = ${turn.id}::uuid
          FOR UPDATE
        `;
        const attachedAt = new Date();
        const attachable = await tx.sokoBotTurn.findFirst({
          where: {
            id: turn.id,
            sokoBotId: turn.sokoBotId,
            userId: turn.userId,
            workspaceId: turn.workspaceId,
            OR: [{ eveSessionId: null }, { eveSessionId: input.sessionId }],
            status: { in: ["STARTING", "RUNNING"] },
            deadlineAt: { gt: attachedAt },
            leaseExpiresAt: { gt: attachedAt },
            sokoBot: {
              adminPausedAt: null,
              archivedAt: null,
              status: { not: "PAUSED" },
            },
          },
          select: { eveSessionId: true, id: true, source: true },
        });
        if (!attachable) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot turn is no longer eligible for session attachment",
          );
        }
        if (
          attachable.eveSessionId !== null &&
          attachable.eveSessionId !== input.sessionId
        ) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot turn session attachment became stale",
          );
        }
        await requireSokoBotWorkspaceAccess(tx, turn.userId, turn.workspaceId);
        if (attachable.eveSessionId === null) {
          const boundTurn = await tx.sokoBotTurn.updateMany({
            where: {
              id: turn.id,
              eveSessionId: null,
              status: { in: ["STARTING", "RUNNING"] },
              deadlineAt: { gt: attachedAt },
              leaseExpiresAt: { gt: attachedAt },
              sokoBot: {
                adminPausedAt: null,
                archivedAt: null,
                status: { not: "PAUSED" },
              },
            },
            data: { eveSessionId: input.sessionId },
          });
          if (boundTurn.count !== 1) {
            throw new SokoBotRuntimeAuthorizationError(
              "Soko Bot turn session attachment became stale",
            );
          }
        }
        const boundBot = await tx.sokoBot.updateMany({
          where: {
            id: turn.sokoBotId,
            userId: turn.userId,
            adminPausedAt: null,
            archivedAt: null,
            status: { not: "PAUSED" },
          },
          // The bot retains the prior completed turn's session for diagnostics.
          // Bot + turn locks and the attachable active-turn check above provide
          // the single-flight fence, so the new turn safely replaces that id.
          data: { eveSessionId: input.sessionId },
        });
        if (boundBot.count !== 1) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot runtime session attachment became stale",
          );
        }
        return input.sessionId;
      }, "Soko Bot session attachment collided with administrator control");
    } else {
      await requireSokoBotWorkspaceAccess(
        prisma,
        turn.userId,
        turn.workspaceId,
      );
    }
    if (storedSessionId !== input.sessionId) {
      throw new SokoBotRuntimeAuthorizationError("Runtime session mismatch");
    }

    return {
      grant,
      turn: {
        id: turn.id,
        sokoBotId: turn.sokoBotId,
        userId: turn.userId,
        workspaceId: turn.workspaceId,
        eveSessionId: storedSessionId,
        versionId: turn.versionId,
        source: turn.source,
        chainDepth: turn.chainDepth,
      },
      classificationConfidence:
        typeof turn.classification === "object" &&
        turn.classification !== null &&
        "confidence" in turn.classification &&
        typeof turn.classification.confidence === "number"
          ? turn.classification.confidence
          : 1,
      hasNegatedMutationIntent: hasSokoBotNegatedMutationIntent(
        turn.userMessage,
      ),
    };
  }

  /** Owner-installed skills, advertised by Eve as load-on-demand skills. */
  async getInstalledSkills(input: RuntimeAuthorizationInput) {
    const authorized = await this.authorize(input);
    const skills = await prisma.sokoBotInstalledSkill.findMany({
      where: { sokoBotId: authorized.turn.sokoBotId },
      orderBy: { createdAt: "asc" },
      select: { name: true, description: true, markdown: true },
    });
    return { skills };
  }

  async getContext(input: RuntimeAuthorizationInput) {
    const authorized = await this.authorize(input);
    const snapshot = await prisma.sokoBotContextSnapshot.findFirst({
      where: {
        id: authorized.grant.contextSnapshotId,
        turnId: authorized.turn.id,
      },
      select: {
        packet: true,
        hash: true,
        schemaVersion: true,
        generatedAt: true,
      },
    });
    if (!snapshot) {
      throw new SokoBotRuntimeAuthorizationError(
        "Context snapshot is unavailable",
      );
    }
    const version = await resolveSokoBotVersion(authorized.turn.versionId);
    const bot = await prisma.sokoBot.findUnique({
      where: { id: authorized.turn.sokoBotId },
      select: { name: true, user: { select: { name: true } } },
    });
    return {
      ...snapshot,
      version: {
        id: version.id,
        name: version.name,
        model: version.model,
        systemPrompt: composeSystemPrompt(version, {
          name: bot?.name ?? null,
          ownerName: bot?.user.name ?? null,
        }),
        skills: [...version.skills],
      },
    };
  }

  /**
   * Nothing waits for an owner: the proposal is recorded as a decision the
   * owner's policy accepts on the spot, then executed through the same
   * fenced, idempotent path an accepted approval uses.
   */
  private async executeAsAccepted(
    authorized: AuthorizedSokoBotRuntime,
    toolName: SokoBotDecisionTarget,
    proposal: unknown,
    toolCallId: string,
  ) {
    const decision = await this.createDecision(
      authorized,
      toolName,
      proposal,
      toolCallId,
      false,
    );
    const resolved = await this.resolveDecision(
      authorized.turn.userId,
      decision.id,
      true,
    );
    return {
      executed: resolved.status === "ACCEPTED",
      decisionId: resolved.id,
      status: resolved.status,
      resultingEntityId: resolved.resultingEntityId,
    };
  }

  /** Everything a project manager needs to act on a Task without opening it. */
  /**
   * Rooms the bot itself belongs to. Membership is the whole authorization
   * boundary here: the bot is a Coworker in chat, so it sees exactly the rooms
   * a person added it to and nothing else in the workspace.
   */
  private async listChats(authorized: AuthorizedSokoBotRuntime) {
    const coworkerId = await this.chatCoworkerId(authorized);
    if (!coworkerId) return { rooms: [] };
    const rooms = await prisma.chatRoom.findMany({
      where: await this.chatRoomScope(authorized, coworkerId),
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        kind: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    return {
      rooms: rooms.map((room) => ({
        roomId: room.id,
        name: room.name,
        kind: room.kind,
        messages: room._count.messages,
        lastActivityAt: room.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Rooms the bot may touch: its own coworker's memberships, bounded to the
   * workspace the turn runs in. Membership alone is not enough — a coworker
   * could in principle be added to a room in another organization, and a turn
   * must never reach outside its own workspace.
   */
  private async chatRoomScope(
    authorized: AuthorizedSokoBotRuntime,
    coworkerId: string,
  ): Promise<Prisma.ChatRoomWhereInput> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: authorized.turn.workspaceId },
      select: { organizationId: true },
    });
    return {
      archivedAt: null,
      coworkerMembers: { some: { coworkerId } },
      organizationId: workspace?.organizationId ?? null,
    };
  }

  /** The bot's chat identity; absent until it has a coworker row. */
  private async chatCoworkerId(
    authorized: AuthorizedSokoBotRuntime,
  ): Promise<string | null> {
    const bot = await prisma.sokoBot.findUnique({
      where: { id: authorized.turn.sokoBotId },
      select: { coworker: { select: { id: true } } },
    });
    return bot?.coworker?.id ?? null;
  }

  /**
   * The single authorization boundary for chat: the bot may only touch rooms
   * its coworker belongs to, in its own workspace. Re-checked on every call
   * because the room id comes from the model, so removal takes effect at once.
   */
  private async requireChatMembership(
    authorized: AuthorizedSokoBotRuntime,
    roomId: string,
  ): Promise<{ id: string; name: string; coworkerId: string }> {
    const coworkerId = await this.chatCoworkerId(authorized);
    const room = coworkerId
      ? await prisma.chatRoom.findFirst({
          where: {
            ...(await this.chatRoomScope(authorized, coworkerId)),
            id: roomId,
          },
          select: { id: true, name: true },
        })
      : null;
    if (!room || !coworkerId) {
      throw new SokoBotRuntimeValidationError(
        "You are not a member of that chat room",
      );
    }
    return { id: room.id, name: room.name, coworkerId };
  }

  /** Post into a room the bot belongs to, as the bot's coworker identity. */
  private async postChat(
    authorized: AuthorizedSokoBotRuntime,
    input: { roomId: string; content: string },
  ) {
    // A turn another assistant started may answer only where it was asked.
    // post_chat otherwise takes any room id the caller supplies, so text from
    // the requesting bot could name a room its own owner cannot see and have
    // this bot post — and summon coworkers — there on its behalf.
    if (authorized.turn.chainDepth > 0) {
      const origin = await prisma.sokoBotTurn.findUnique({
        where: { id: authorized.turn.id },
        select: {
          chatMention: { select: { message: { select: { roomId: true } } } },
        },
      });
      const originRoomId = origin?.chatMention?.message.roomId;
      if (!originRoomId || originRoomId !== input.roomId) {
        throw new SokoBotRuntimeAuthorizationError(
          "You may only reply in the room you were asked in",
        );
      }
    }
    const room = await this.requireChatMembership(authorized, input.roomId);
    // Who this post summons. A bot may address another bot, but every hop is
    // counted: past the ceiling the message still posts and simply stops being
    // a summons, so an unattended exchange cannot run for ever.
    const chainDepth = nextChatChainDepth(authorized.turn.chainDepth);
    // Backstop the hop counter cannot provide: it reasons pairwise, so three
    // bots in a triangle could defeat it. This does not care who produced the
    // traffic, only how much of it a room has taken lately.
    const roomCoworkers = chatChainMayWake(chainDepth)
      ? await prisma.chatRoomCoworkerMember.findMany({
          where: { roomId: room.id, coworkerId: { not: room.coworkerId } },
          select: {
            coworker: { select: { id: true, name: true, slug: true } },
          },
        })
      : [];
    const mentionedCoworkerIds = resolveMentionedCoworkerIds({
      content: input.content,
      roomCoworkers: roomCoworkers.map(({ coworker }) => coworker),
    });
    // Written inside the transaction, dispatched after it commits — the same
    // handoff the human message route performs. Without it the rows sit
    // `pending` for ever: reclaim only rescues `sent`, so nobody ever wakes.
    const mentionIds: string[] = [];
    const message = await serializableTransaction(async (tx) => {
      // Counted inside the transaction: read outside it, two bots posting at
      // once both see room for one more and the room takes both.
      const botMessagesThisHour = await tx.chatRoomMessage.count({
        where: {
          roomId: room.id,
          senderCoworkerId: { not: null },
          deletedAt: null,
          createdAt: {
            gte: new Date(Date.now() - ROOM_BOT_MESSAGE_WINDOW_MS),
          },
        },
      });
      if (botMessagesThisHour >= ROOM_BOT_MESSAGES_PER_HOUR) {
        throw new SokoBotRuntimeValidationError(
          `This room has taken ${botMessagesThisHour} assistant messages in the last hour and is rate limited. Say nothing further here for now.`,
        );
      }
      const created = await tx.chatRoomMessage.create({
        data: {
          roomId: room.id,
          senderCoworkerId: room.coworkerId,
          content: input.content,
          // Lets the reader see, on hover, that this is part of an assistant
          // exchange and how close it is to the point where it stops.
          metadata: {
            soko_bot_chain: {
              depth: chainDepth,
              max_depth: MAX_CHAT_CHAIN_DEPTH,
              room_messages_this_hour: botMessagesThisHour + 1,
              room_messages_per_hour: ROOM_BOT_MESSAGES_PER_HOUR,
            },
          },
        },
        select: { id: true, createdAt: true },
      });
      if (mentionedCoworkerIds.length > 0) {
        await tx.chatRoomMention.createMany({
          data: mentionedCoworkerIds.map((coworkerId) => ({
            messageId: created.id,
            coworkerId,
            chainDepth,
          })),
          skipDuplicates: true,
        });
        mentionIds.push(
          ...(
            await tx.chatRoomMention.findMany({
              where: { messageId: created.id },
              select: { id: true },
            })
          ).map((mention) => mention.id),
        );
      }
      await tx.chatRoom.update({
        where: { id: room.id },
        data: { updatedAt: new Date() },
      });
      return created;
    }, "Another assistant posted into this room at the same moment");
    // Every other message-create site publishes; without this the bot's post
    // only appears after a refresh, which reads as the tool having failed.
    await publishChatRoomMessageRealtimeById(message.id, "create");
    for (const mentionId of mentionIds) {
      const { dispatchChatRoomMention } = await import(
        "@/services/chat-room-coworker-dispatch.service"
      );
      waitUntil(dispatchChatRoomMention(mentionId));
    }
    return {
      messageId: message.id,
      roomId: room.id,
      postedAt: message.createdAt.toISOString(),
      /** Coworkers this post woke; empty once the chain hits its ceiling. */
      summoned: mentionedCoworkerIds.length,
    };
  }

  /** Files in the owner's Drive. Blob-backed, listed by the owner's prefix. */
  private async listFiles(
    authorized: AuthorizedSokoBotRuntime,
    input: { query?: string; limit?: number },
  ) {
    const prefix = buildUserDriveFilePrefix(authorized.turn.userId);
    const { blobs } = await list({ prefix, limit: input.limit ?? 50 });
    const needle = input.query?.toLowerCase();
    return {
      files: blobs
        .map((blob) => ({
          filename: blob.pathname.slice(prefix.length),
          size: blob.size,
          uploadedAt: blob.uploadedAt.toISOString(),
          url: blob.url,
        }))
        .filter(
          (file) => !needle || file.filename.toLowerCase().includes(needle),
        ),
    };
  }

  /**
   * Write a text file into the owner's Drive. Core uploads server-side rather
   * than minting a client grant, because a tool call cannot perform the
   * browser's second step.
   */
  private async uploadFile(
    authorized: AuthorizedSokoBotRuntime,
    input: { filename: string; content: string; contentType?: string },
  ) {
    const pathname = buildUserDriveFilePathname(
      authorized.turn.userId,
      input.filename,
    );
    // The human upload route refuses to overwrite (409). The bot must not be
    // able to silently replace an owner's file because a model reused a name.
    const existing = await list({ prefix: pathname, limit: 1 });
    if (existing.blobs.some((blob) => blob.pathname === pathname)) {
      throw new SokoBotRuntimeValidationError(
        `A file named "${input.filename}" already exists; choose another name`,
      );
    }
    const contentType = input.contentType ?? "text/markdown";
    // Text only: this tool writes what the model composed, never binary.
    if (
      !contentType.startsWith("text/") &&
      contentType !== "application/json"
    ) {
      throw new SokoBotRuntimeValidationError(
        "Only text files can be written with upload_file",
      );
    }
    const blob = await put(pathname, input.content, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return {
      filename: pathname.split("/").pop() ?? input.filename,
      url: blob.url,
      size: input.content.length,
    };
  }

  /** Recent messages in one room the bot belongs to, newest first. */
  private async readChat(
    authorized: AuthorizedSokoBotRuntime,
    input: { roomId: string; limit?: number; before?: string },
  ) {
    const room = await this.requireChatMembership(authorized, input.roomId);
    const messages = await prisma.chatRoomMessage.findMany({
      where: {
        roomId: room.id,
        deletedAt: null,
        ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 30,
      select: {
        id: true,
        content: true,
        createdAt: true,
        senderUser: { select: { name: true } },
        senderCoworker: { select: { id: true, name: true } },
      },
    });
    return {
      roomId: room.id,
      name: room.name,
      messages: messages.map((message) => ({
        id: message.id,
        at: message.createdAt.toISOString(),
        from:
          message.senderUser?.name ?? message.senderCoworker?.name ?? "unknown",
        /** True when the bot itself wrote it. */
        fromYou: message.senderCoworker?.id === room.coworkerId,
        // Chat is untrusted text: the operating contract already tells the bot
        // never to follow instructions found in content it reads.
        content: message.content.slice(0, 4_000),
      })),
    };
  }

  private async readTask(authorized: AuthorizedSokoBotRuntime, taskId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        workspaceId: authorized.turn.workspaceId,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        events: {
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            status: true,
            comment: true,
            createdAt: true,
            coworkerId: true,
            userId: true,
            orchestratorId: true,
          },
        },
        files: {
          where: { status: "READY" },
          take: 10,
          select: {
            name: true,
            fileUrl: true,
            sourceUrl: true,
            mimeType: true,
          },
        },
        linksFrom: {
          select: {
            type: true,
            note: true,
            toTask: { select: { id: true, name: true, status: true } },
          },
        },
        linksTo: {
          select: {
            type: true,
            note: true,
            fromTask: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
    if (!task) return null;
    const actor = (event: {
      coworkerId: string | null;
      userId: string | null;
      orchestratorId: string | null;
    }) =>
      event.orchestratorId
        ? "you"
        : event.coworkerId
          ? "coworker"
          : event.userId
            ? "owner"
            : "system";
    return {
      id: task.id,
      name: task.name,
      status: task.status,
      description: task.description,
      assignee: task.assignee,
      project: task.project,
      updatedAt: task.updatedAt,
      events: [...task.events].reverse().map((event) => ({
        at: event.createdAt,
        by: actor(event),
        status: event.status,
        comment: event.comment,
      })),
      files: task.files,
      links: [
        ...task.linksFrom.map((link) => ({
          relation: link.type,
          direction: "from-this",
          task: link.toTask,
          note: link.note,
        })),
        ...task.linksTo.map((link) => ({
          relation: link.type,
          direction: "to-this",
          task: link.fromTask,
          note: link.note,
        })),
      ],
    };
  }

  /** Progress a Task the bot's coworker is assigned to; no credits involved. */
  private async updateAssignedTask(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
  ) {
    const input = updateAssignedTaskInputSchema.parse(rawInput);
    const allowed: Record<string, TaskStatus[]> = {
      READY: [
        TaskStatus.RUNNING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
      ],
      RUNNING: [
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
      ],
      INPUT_REQUIRED: [
        TaskStatus.RUNNING,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
      ],
      QUEUED: [TaskStatus.RUNNING, TaskStatus.COMPLETED, TaskStatus.FAILED],
    };
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, false);
      const task = await tx.task.findFirst({
        where: {
          id: input.taskId,
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
        },
        select: {
          id: true,
          status: true,
          assignee: { select: { sokoBotId: true } },
        },
      });
      if (!task) throw new SokoBotRuntimeValidationError("Task not found");
      if (task.assignee?.sokoBotId !== authorized.turn.sokoBotId) {
        throw new SokoBotRuntimeValidationError(
          "You are not the assignee of this Task; use reply_to_task to comment",
        );
      }
      const next = TaskStatus[input.status];
      if (!(allowed[task.status] ?? []).includes(next)) {
        throw new SokoBotRuntimeValidationError(
          `Task is ${task.status}; cannot set ${input.status}`,
        );
      }
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          status: next,
          comment: input.comment,
          channel: Channel.SOKOSUMI,
          orchestratorId: authorized.turn.sokoBotId,
        },
      });
      await applyGuardedTaskStatusUpdate({
        tx,
        taskId: task.id,
        expectedStatus: task.status,
        eventStatus: next,
      });
      await tx.sokoBotTaskWatch.upsert({
        where: {
          sokoBotId_taskId: {
            sokoBotId: authorized.turn.sokoBotId,
            taskId: task.id,
          },
        },
        create: {
          sokoBotId: authorized.turn.sokoBotId,
          taskId: task.id,
          lastSeenEventAt: new Date(),
          lastSeenStatus: next,
        },
        update: { lastSeenEventAt: new Date(), lastSeenStatus: next },
      });
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "update_assigned_task",
          outcome: next,
          lastSeenStatus: next,
          taskId: task.id,
        },
      });
      return { taskId: task.id, status: next };
    }, "Soko Bot task update collided with another request");
  }

  /** Comment on a Task, optionally resuming it (INPUT_REQUIRED/FAILED/… → READY). */
  private async replyToTask(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
  ) {
    const input = replyToTaskInputSchema.parse(rawInput);
    const resumable: TaskStatus[] = [
      TaskStatus.INPUT_REQUIRED,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
      TaskStatus.COMPLETED,
      TaskStatus.APPROVAL_REQUIRED,
      TaskStatus.AWAITING_EXTERNAL,
    ];
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, false);
      const task = await tx.task.findFirst({
        where: {
          id: input.taskId,
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
        },
        select: { id: true, name: true, status: true, assigneeId: true },
      });
      if (!task) throw new SokoBotRuntimeValidationError("Task not found");
      if (!input.status) {
        const recent = await tx.taskEvent.count({
          where: {
            taskId: task.id,
            orchestratorId: authorized.turn.sokoBotId,
            status: null,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
          },
        });
        if (recent >= MAX_BOT_COMMENTS_PER_TASK_PER_DAY) {
          throw new SokoBotRuntimeValidationError(
            `You already commented ${recent} times on this Task today; hold further comments unless they are urgent`,
          );
        }
      }
      if (input.status === "READY") {
        if (!resumable.includes(task.status)) {
          throw new SokoBotRuntimeValidationError(
            `Task is ${task.status}; only ${resumable.join(", ")} can be set READY. To leave a comment without changing the status, omit \`status\`.`,
          );
        }
        if (!task.assigneeId) {
          throw new SokoBotRuntimeValidationError(
            "Task has no assignee; use assign_task instead",
          );
        }
      }
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          status: input.status ?? null,
          comment: input.comment,
          channel: Channel.SOKOSUMI,
          orchestratorId: authorized.turn.sokoBotId,
        },
      });
      if (input.status === "READY") {
        await applyGuardedTaskStatusUpdate({
          tx,
          taskId: task.id,
          expectedStatus: task.status,
          eventStatus: TaskStatus.READY,
        });
      }
      const status = input.status ?? task.status;
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "reply_to_task",
          outcome: status,
          lastSeenStatus: status,
          taskId: task.id,
        },
      });
      return { id: task.id, name: task.name, status, commented: true };
    }, "Soko Bot task reply collided with another action");
  }

  private async linkTasks(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
  ) {
    const input = linkTasksInputSchema.parse(rawInput);
    if (input.taskId === input.peerTaskId) {
      throw new SokoBotRuntimeValidationError("A task cannot link to itself");
    }
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, false);
      const tasks = await tx.task.findMany({
        where: {
          id: { in: [input.taskId, input.peerTaskId] },
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
        },
        select: { id: true, name: true },
      });
      if (tasks.length !== 2) {
        throw new SokoBotRuntimeValidationError(
          "One of the tasks was not found",
        );
      }
      const data = mapTaskLinkRelationToWriteData(
        input.taskId,
        input.peerTaskId,
        input.relation,
      );
      const existing = await tx.taskLink.findFirst({
        where: {
          OR: [
            { fromTaskId: data.fromTaskId, toTaskId: data.toTaskId },
            { fromTaskId: data.toTaskId, toTaskId: data.fromTaskId },
          ],
        },
        select: { id: true, type: true },
      });
      if (existing) {
        return { linked: true, existing: true, relation: existing.type };
      }
      const link = await tx.taskLink.create({
        data: { ...data, note: input.note ?? null },
        select: { id: true, type: true },
      });
      return {
        linked: true,
        existing: false,
        relation: link.type,
        id: link.id,
      };
    }, "Soko Bot task link collided with another action");
  }

  private async createDecision(
    authorized: AuthorizedSokoBotRuntime,
    toolName: SokoBotDecisionTarget,
    proposal: unknown,
    toolCallId: string,
    approvalRequired: boolean,
  ) {
    const parsedProposal = parseDecisionProposal(toolName, proposal);
    const proposalJson = jsonInput(parsedProposal);
    const reason = await describeDecision(toolName, parsedProposal);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, false);
      // A model that retries an approval-gated call with the same input must
      // not fan out into several identical approvals for the owner.
      const existing = await tx.sokoBotPendingDecision.findFirst({
        where: {
          turnId: authorized.turn.id,
          toolName,
          status: "PENDING",
          proposal: { equals: proposalJson },
        },
        select: { id: true, status: true, expiresAt: true },
      });
      if (existing) {
        const duplicate = {
          approvalRequired: true,
          decision: existing,
          duplicate: true,
          message: DECISION_PENDING_MESSAGE,
        };
        await tx.sokoBotToolCall.update({
          where: {
            turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
          },
          data: { status: "COMPLETED", result: persistedToolResult(duplicate) },
        });
        return existing;
      }
      const decision = await tx.sokoBotPendingDecision.create({
        data: {
          sokoBotId: authorized.turn.sokoBotId,
          turnId: authorized.turn.id,
          userId: authorized.turn.userId,
          workspaceId: authorized.turn.workspaceId,
          toolName,
          reason,
          proposal: proposalJson,
          expiresAt: new Date(Date.now() + DECISION_TTL_MS),
        },
        select: { id: true, status: true, expiresAt: true },
      });
      const result = approvalRequired
        ? {
            approvalRequired: true,
            decision,
            message: DECISION_PENDING_MESSAGE,
          }
        : decision;
      await tx.sokoBotToolCall.update({
        where: {
          turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
        },
        data: { status: "COMPLETED", result: persistedToolResult(result) },
      });
      return decision;
    }, "Soko Bot decision collided with cancellation");
  }

  private async createTask(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    approved = false,
  ) {
    // Self-started turns may start work, not only draft it: an assistant that
    // spots a meeting to prepare for and leaves a DRAFT has not helped. The
    // brakes are the owner's daily cap and pause, plus the version prompt's
    // instruction to weigh cost and ask first when the work looks expensive.
    const input = taskCreateInputSchema.parse(rawInput);
    return serializableTransaction(async (tx) => {
      const workspace = await this.requireMutationAuthority(
        tx,
        authorized,
        approved,
      );
      const task = await createTaskForActor(
        {
          actor: {
            kind: "soko_bot",
            sokoBotId: authorized.turn.sokoBotId,
          },
          ownerId: authorized.turn.userId,
          organizationId: workspace.organizationId,
          workspaceId: authorized.turn.workspaceId,
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          assigneeId: input.coworkerId,
          status: input.status,
          channel: Channel.SOKOSUMI,
        },
        tx,
      );
      const result = {
        id: task.id,
        name: task.name,
        status: task.status,
        assigneeId: task.assigneeId,
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "create_task",
          outcome: result.status,
          lastSeenStatus: result.status,
          taskId: result.id,
        },
      });
      if (!approved) {
        await tx.sokoBotToolCall.update({
          where: {
            turnId_toolCallId: {
              turnId: authorized.turn.id,
              toolCallId,
            },
          },
          data: { status: "COMPLETED", result: persistedToolResult(result) },
        });
      }
      return result;
    }, "Soko Bot Task creation collided with another action");
  }

  private async updateTask(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    approved = false,
  ) {
    const input = taskUpdateInputSchema.parse(rawInput);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, approved);
      const task = await updateTaskForActor(
        {
          actor: {
            kind: "soko_bot",
            sokoBotId: authorized.turn.sokoBotId,
          },
          ownerId: authorized.turn.userId,
          workspaceId: authorized.turn.workspaceId,
          taskId: input.taskId,
          intent: "metadata",
          name: input.name,
          description: input.description,
          status: input.status,
          channel: Channel.SOKOSUMI,
        },
        tx,
      );
      const updated = {
        id: task.id,
        name: task.name,
        status: task.status,
        assigneeId: task.assigneeId,
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "update_task",
          outcome: updated.status,
          lastSeenStatus: updated.status,
          taskId: updated.id,
        },
      });
      if (!approved) {
        await tx.sokoBotToolCall.update({
          where: {
            turnId_toolCallId: {
              turnId: authorized.turn.id,
              toolCallId,
            },
          },
          data: { status: "COMPLETED", result: persistedToolResult(updated) },
        });
      }
      return updated;
    }, "Soko Bot Task update collided with another action");
  }

  private async assignTask(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    approved = false,
  ) {
    const input = taskAssignInputSchema.parse(rawInput);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, approved);
      const status = input.ready ? TaskStatus.READY : TaskStatus.DRAFT;
      const task = await updateTaskForActor(
        {
          actor: {
            kind: "soko_bot",
            sokoBotId: authorized.turn.sokoBotId,
          },
          ownerId: authorized.turn.userId,
          workspaceId: authorized.turn.workspaceId,
          taskId: input.taskId,
          intent: "assignment",
          assigneeId: input.coworkerId,
          status,
          channel: Channel.SOKOSUMI,
        },
        tx,
      );
      const updated = {
        id: task.id,
        name: task.name,
        status: task.status,
        assigneeId: task.assigneeId,
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "assign_task",
          outcome: updated.status,
          lastSeenStatus: updated.status,
          taskId: updated.id,
        },
      });
      if (!approved) {
        await tx.sokoBotToolCall.update({
          where: {
            turnId_toolCallId: {
              turnId: authorized.turn.id,
              toolCallId,
            },
          },
          data: { status: "COMPLETED", result: persistedToolResult(updated) },
        });
      }
      return updated;
    }, "Soko Bot Task assignment collided with another action");
  }

  private async requireMutationAuthority(
    tx: Prisma.TransactionClient,
    authorized: SokoBotActionContext,
    approved: boolean,
  ) {
    const now = new Date();
    if (approved) {
      // Serialize approved decisions with administrator PAUSE. Whichever
      // transaction locks the bot first defines whether this mutation lands
      // before the pause or is rejected after it.
      await tx.$queryRaw`
        SELECT "id"
        FROM "orchestrator"
        WHERE "id" = ${authorized.turn.sokoBotId}::uuid
        FOR UPDATE
      `;
    } else {
      // Serialize runtime writes with cancellation. A plain status read allows
      // Task/memory writes to commit after cancelTurn changes this row.
      await tx.$queryRaw`
        SELECT "id"
        FROM "soko_bot_turn"
        WHERE "id" = ${authorized.turn.id}::uuid
        FOR UPDATE
      `;
    }
    const workspace = await requireSokoBotWorkspaceAccess(
      tx,
      authorized.turn.userId,
      authorized.turn.workspaceId,
    );
    if (approved) {
      const activeBot = await tx.sokoBot.findFirst({
        where: {
          id: authorized.turn.sokoBotId,
          userId: authorized.turn.userId,
          archivedAt: null,
          status: { not: "PAUSED" },
        },
        select: { id: true },
      });
      if (!activeBot) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot is paused or unavailable",
        );
      }
      return workspace;
    }

    const writable = await tx.sokoBotTurn.findFirst({
      where: {
        id: authorized.turn.id,
        sokoBotId: authorized.turn.sokoBotId,
        userId: authorized.turn.userId,
        workspaceId: authorized.turn.workspaceId,
        status: { in: ["STARTING", "RUNNING"] },
        deadlineAt: { gt: now },
        leaseExpiresAt: { gt: now },
        sokoBot: { archivedAt: null, status: { not: "PAUSED" } },
      },
      select: { id: true },
    });
    if (!writable) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot turn is no longer writable",
      );
    }
    return workspace;
  }

  private async updateMemory(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
  ) {
    const input = memoryUpdateInputSchema.parse(rawInput);
    let markdown: string;
    try {
      markdown = renderSokoBotMemory(
        parseSokoBotMemory(input.markdown, { secretHandling: "reject" }),
      );
    } catch (error) {
      throw new SokoBotRuntimeValidationError(
        error instanceof Error ? error.message : "Soko Bot memory is invalid",
      );
    }
    const hash = hashMemory(markdown);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, false);
      const bot = await tx.sokoBot.findUniqueOrThrow({
        where: { id: authorized.turn.sokoBotId },
        select: { memoryVersion: true },
      });
      if (bot.memoryVersion !== authorized.grant.memoryVersion) {
        const latestRevision =
          bot.memoryVersion > authorized.grant.memoryVersion
            ? await tx.sokoBotMemoryRevision.findUnique({
                where: {
                  sokoBotId_version: {
                    sokoBotId: authorized.turn.sokoBotId,
                    version: bot.memoryVersion,
                  },
                },
                select: { sourceTurnId: true },
              })
            : null;
        if (latestRevision?.sourceTurnId !== authorized.turn.id) {
          throw new SokoBotRuntimeConflictError("Memory changed during turn");
        }
      }
      const version = bot.memoryVersion + 1;
      const revision = await tx.sokoBotMemoryRevision.create({
        data: {
          sokoBotId: authorized.turn.sokoBotId,
          sourceTurnId: authorized.turn.id,
          version,
          hash,
          markdown,
          source: "runtime",
        },
        select: { id: true, version: true, hash: true, markdown: true },
      });
      await tx.sokoBot.update({
        where: { id: authorized.turn.sokoBotId },
        data: { memoryVersion: version, memoryHash: hash },
      });
      await tx.sokoBotToolCall.update({
        where: {
          turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
        },
        data: { status: "COMPLETED", result: persistedToolResult(revision) },
      });
      return revision;
    }, "Memory changed during turn");
  }

  async executeTool(input: ExecuteSokoBotToolInput): Promise<unknown> {
    await this.authorize(input);
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input.input ?? null))
      .digest("hex");
    let existing = await prisma.sokoBotToolCall.findUnique({
      where: {
        turnId_toolCallId: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
        },
      },
    });
    if (!existing) {
      existing = await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "soko_bot_turn"
          WHERE "id" = ${input.turnId}::uuid
          FOR UPDATE
        `;
        const raced = await tx.sokoBotToolCall.findUnique({
          where: {
            turnId_toolCallId: {
              turnId: input.turnId,
              toolCallId: input.toolCallId,
            },
          },
        });
        if (raced) return raced;
        const callCount = await tx.sokoBotToolCall.count({
          where: { turnId: input.turnId },
        });
        if (callCount >= TOOL_CALL_LIMIT_PER_TURN) {
          throw new SokoBotRuntimeConflictError(
            "Soko Bot turn tool-call limit reached",
          );
        }
        await tx.sokoBotToolCall.create({
          data: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            capability: input.capability,
            inputHash,
            input: persistedToolResult(input.input ?? null),
          },
        });
        return null;
      }, "Soko Bot tool-call reservation collided with another call");
    }
    if (existing) {
      if (
        existing.inputHash !== inputHash ||
        existing.capability !== input.capability
      ) {
        throw new SokoBotRuntimeAuthorizationError(
          "Tool call id was reused with different input",
        );
      }
      if (existing.status === "COMPLETED") return existing.result;
      if (existing.status === "FAILED") {
        throw new SokoBotRuntimeConflictError("Tool call previously failed");
      }
      const reclaimed = await prisma.sokoBotToolCall.updateMany({
        where: {
          id: existing.id,
          status: "PENDING",
          updatedAt: {
            lt: new Date(Date.now() - TOOL_CALL_STALE_MS),
          },
        },
        data: {
          updatedAt: new Date(),
          errorKind: null,
          errorDetail: null,
        },
      });
      if (reclaimed.count === 0) {
        throw new SokoBotRuntimeConflictError("Tool call is already executing");
      }
    }

    try {
      const result = await this.executeAuthorizedTool(input);
      await prisma.sokoBotToolCall.update({
        where: {
          turnId_toolCallId: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
          },
        },
        data: {
          status: "COMPLETED",
          result: persistedToolResult(result ?? null),
        },
      });
      return result;
    } catch (error) {
      await prisma.sokoBotToolCall.updateMany({
        where: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          status: "PENDING",
        },
        data: {
          status: "FAILED",
          errorKind: error instanceof Error ? error.name : "unknown",
          errorDetail: persistedErrorDetail(error),
        },
      });
      throw error;
    }
  }

  private async executeAuthorizedTool(
    input: ExecuteSokoBotToolInput,
  ): Promise<unknown> {
    const authorized = await this.authorize(input);
    if (
      authorized.hasNegatedMutationIntent &&
      (isSokoBotDecisionTarget(input.capability) ||
        input.capability === "request_user_decision" ||
        isSokoBotNegatableWrite(input.capability))
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "User explicitly asked for this not to happen yet",
      );
    }
    switch (input.capability) {
      case "refresh_context":
        return this.getContext(input);
      case "find_coworkers": {
        const { query } = searchInputSchema.parse(input.input);
        return prisma.coworker.findMany({
          where: {
            archivedAt: null,
            AND: [
              {
                OR: [
                  { isWhitelisted: true },
                  { assignments: { some: { userId: authorized.turn.userId } } },
                  {
                    workspaceAccess: {
                      some: {
                        workspaceId: authorized.turn.workspaceId,
                        status: "GRANTED",
                      },
                    },
                  },
                ],
              },
              ...(query
                ? [
                    {
                      OR: [
                        {
                          name: {
                            contains: query,
                            mode: "insensitive" as const,
                          },
                        },
                        {
                          description: {
                            contains: query,
                            mode: "insensitive" as const,
                          },
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
          take: 20,
          select: {
            id: true,
            name: true,
            caption: true,
            description: true,
            capabilities: true,
          },
        });
      }
      case "create_task":
        return this.createTask(authorized, input.input, input.toolCallId);
      case "update_task":
        return this.updateTask(authorized, input.input, input.toolCallId);
      case "assign_task":
        return this.assignTask(authorized, input.input, input.toolCallId);
      case "get_task_status": {
        const { taskId } = taskIdInputSchema.parse(input.input);
        return this.readTask(authorized, taskId);
      }
      case "update_assigned_task":
        return this.updateAssignedTask(
          authorized,
          input.input,
          input.toolCallId,
        );
      case "reply_to_task":
        return this.replyToTask(authorized, input.input, input.toolCallId);
      case "link_tasks":
        return this.linkTasks(authorized, input.input);
      case "find_agents": {
        const { query } = searchInputSchema.parse(input.input);
        return prisma.agent.findMany({
          where: {
            isShown: true,
            status: "ONLINE",
            apiBaseUrl: { not: null },
            ...(query
              ? {
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { description: { contains: query, mode: "insensitive" } },
                    {
                      capabilityName: { contains: query, mode: "insensitive" },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ jobCount: "desc" }, { id: "desc" }],
          take: 20,
          select: {
            id: true,
            name: true,
            summary: true,
            description: true,
            capabilityName: true,
            paymentType: true,
            riskClassification: true,
          },
        });
      }
      case "get_agent_input_schema": {
        const { agentId } = agentIdInputSchema.parse(input.input);
        const agent = await prisma.agent.findFirst({
          where: {
            id: agentId,
            isShown: true,
            status: "ONLINE",
            apiBaseUrl: { not: null },
          },
          select: {
            id: true,
            name: true,
            blockchainIdentifier: true,
            apiBaseUrl: true,
            metadataOverride: { select: { apiBaseUrl: true } },
          },
        });
        if (!agent) throw new SokoBotRuntimeValidationError("Agent not found");
        const result = await createAgentClient().fetchAgentInputSchema(
          toMasumiAgent(agent),
        );
        if (result.isErr())
          throw new SokoBotRuntimeValidationError(result.error);
        return inputSchemaSchema.parse(result.value);
      }
      case "hire_agent": {
        const hire = parseHireAgentInput(input.input);
        // A turn with no owner message is composed from untrusted material —
        // mail subjects, calendar titles, task comments. Hiring is the one
        // tool that buys from a marketplace outright, so text that talks its
        // way onto this route must not be able to commit the whole balance in
        // a single unattended turn. The owner asking for a hire themselves is
        // unaffected.
        const ceiling = getEnv().SOKO_BOT_UNATTENDED_MAX_HIRE_CREDITS;
        if (
          exceedsUnattendedHireBudget({
            source: authorized.turn.source,
            chainDepth: authorized.turn.chainDepth,
            maxCredits: hire.maxCredits,
            ceiling,
          })
        ) {
          throw new SokoBotRuntimeValidationError(
            `An unattended turn may commit at most ${ceiling} credits per hire; this one asked for ${hire.maxCredits}. Ask the owner in their chat instead.`,
          );
        }
        return this.executeAsAccepted(
          authorized,
          input.capability,
          input.input,
          input.toolCallId,
        );
      }
      case "get_job_status": {
        const { jobId } = jobIdInputSchema.parse(input.input);
        return prisma.job.findFirst({
          where: {
            id: jobId,
            ownerId: authorized.turn.userId,
            workspaceId: authorized.turn.workspaceId,
          },
          select: {
            id: true,
            name: true,
            agentId: true,
            jobType: true,
            updatedAt: true,
            events: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                result: true,
                inputSchema: true,
              },
            },
          },
        });
      }
      case "provide_job_input":
        provideJobInputSchema.parse(input.input);
        return this.executeAsAccepted(
          authorized,
          input.capability,
          input.input,
          input.toolCallId,
        );
      case "request_user_decision": {
        const decision = decisionInputSchema.parse(input.input);
        if (
          !isSokoBotDecisionTargetAllowed(
            decision.toolName,
            authorized.grant.capabilities,
          )
        ) {
          throw new SokoBotRuntimeAuthorizationError(
            "Decision target is not granted for this turn",
          );
        }
        return this.createDecision(
          authorized,
          decision.toolName,
          decision.proposal,
          input.toolCallId,
          false,
        );
      }
      case "read_memory":
        return prisma.sokoBotMemoryRevision
          .findFirst({
            where: { sokoBotId: authorized.turn.sokoBotId },
            orderBy: { version: "desc" },
            select: { id: true, version: true, hash: true, markdown: true },
          })
          .then((revision) => {
            if (!revision) return null;
            const markdown = sanitizeSokoBotMemoryMarkdown(revision.markdown);
            return { ...revision, markdown, hash: hashMemory(markdown) };
          });
      case "update_memory":
        return this.updateMemory(authorized, input.input, input.toolCallId);
      case "list_schedules":
        return listSokoBotSchedules(authorized.turn.sokoBotId);
      case "list_chats":
        return this.listChats(authorized);
      case "read_chat": {
        const parsed = sokoBotReadChatInputSchema.parse(input.input);
        return this.readChat(authorized, parsed);
      }
      case "post_chat": {
        const parsed = sokoBotPostChatInputSchema.parse(input.input);
        return this.postChat(authorized, parsed);
      }
      case "list_files": {
        const parsed = sokoBotListFilesInputSchema.parse(input.input);
        return this.listFiles(authorized, parsed);
      }
      case "upload_file": {
        const parsed = sokoBotUploadFileInputSchema.parse(input.input);
        return this.uploadFile(authorized, parsed);
      }
      case "list_integrations":
        return listSokoBotIntegrations(
          authorized.turn.userId,
          authorized.turn.workspaceId,
        ).then((result) =>
          result.integrations.filter((i) => i.status !== "DISCONNECTED"),
        );
      case "search_inbox": {
        const parsed = sokoBotSearchInboxInputSchema.parse(input.input);
        const integrations = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "email",
          parsed.provider,
        );
        if (integrations.length === 0) {
          return { messages: [], note: "No mailbox is connected." };
        }
        const limit = parsed.limit ?? 20;
        const results = await Promise.all(
          integrations.map((integration) =>
            fetchInboxMessages(integration, {
              query: parsed.query,
              since: parsed.since ? new Date(parsed.since) : undefined,
              unreadOnly: parsed.unreadOnly,
              limit,
            }),
          ),
        );
        return {
          messages: results
            .flat()
            .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
            .slice(0, limit),
        };
      }
      case "read_email": {
        const parsed = sokoBotReadEmailInputSchema.parse(input.input);
        const [integration] = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "email",
          parsed.provider,
        );
        if (!integration) {
          throw new SokoBotRuntimeValidationError(
            `No connected mailbox for provider ${parsed.provider}`,
          );
        }
        return fetchInboxMessage(integration, parsed.messageId);
      }
      case "list_integration_tools": {
        const parsed = sokoBotListIntegrationToolsInputSchema.parse(
          input.input,
        );
        const [integration] = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "generic",
          parsed.provider.toLowerCase(),
        );
        if (!integration) {
          throw new SokoBotRuntimeValidationError(
            `No connected account for provider ${parsed.provider} (mailboxes use search_inbox)`,
          );
        }
        return {
          tools: await listIntegrationTools(integration, {
            query: parsed.query,
            limit: parsed.limit ?? 20,
          }),
        };
      }
      case "run_integration_tool": {
        const parsed = sokoBotRunIntegrationToolInputSchema.parse(input.input);
        const [integration] = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "generic",
          parsed.provider.toLowerCase(),
        );
        if (!integration) {
          throw new SokoBotRuntimeValidationError(
            `No connected account for provider ${parsed.provider}`,
          );
        }
        return runIntegrationTool(
          integration,
          parsed.tool,
          parsed.arguments ?? {},
        );
      }
      case "list_calendar_events": {
        const parsed = sokoBotListCalendarEventsInputSchema.parse(input.input);
        const from = parsed.from ? new Date(parsed.from) : new Date();
        const to = parsed.to
          ? new Date(parsed.to)
          : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1_000);
        const integrations = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "calendar",
          parsed.provider,
        );
        if (integrations.length === 0) {
          return { events: [], note: "No calendar is connected." };
        }
        const limit = parsed.limit ?? 50;
        const results = await Promise.all(
          integrations.map((integration) =>
            fetchCalendarEvents(integration, { from, to, limit }),
          ),
        );
        const tzRow = await prisma.sokoBot.findUnique({
          where: { id: authorized.turn.sokoBotId },
          select: { ingestTimezone: true },
        });
        const timeZone = tzRow?.ingestTimezone ?? "UTC";
        const local = (iso: string | null) =>
          iso
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone,
                weekday: "short",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(iso))
            : null;
        return {
          timeZone,
          events: results
            .flat()
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            .slice(0, limit)
            .map((event) => ({
              ...event,
              startsAtLocal: local(event.startsAt),
              endsAtLocal: local(event.endsAt),
            })),
        };
      }
      case "create_schedule":
        return runScheduleTool(() =>
          createSokoBotSchedule({
            userId: authorized.turn.userId,
            workspaceId: authorized.turn.workspaceId,
            ...createScheduleInputSchema.parse(input.input),
          }),
        );
      case "update_schedule":
        return runScheduleTool(() =>
          updateSokoBotSchedule({
            userId: authorized.turn.userId,
            ...updateScheduleInputSchema.parse(input.input),
          }),
        );
      case "delete_schedule": {
        const ref = scheduleIdInputSchema.parse(input.input);
        return runScheduleTool(async () => {
          const deleted = await deleteSokoBotSchedule(
            authorized.turn.userId,
            ref,
          );
          return { deleted: true, ...deleted };
        });
      }
    }
  }

  async resolveDecision(userId: string, decisionId: string, accepted: boolean) {
    const decision = await prisma.sokoBotPendingDecision.findFirst({
      where: {
        id: decisionId,
        userId,
        status: accepted ? { in: ["PENDING", "PROCESSING"] } : "PENDING",
      },
      include: { turn: true },
    });
    if (!decision)
      throw new SokoBotRuntimeValidationError("Pending decision not found");
    if (
      decision.status === "PENDING" &&
      decision.expiresAt.getTime() <= Date.now()
    ) {
      await prisma.sokoBotPendingDecision.update({
        where: { id: decision.id },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      throw new SokoBotRuntimeConflictError("Pending decision expired");
    }
    if (!accepted) {
      const rejected = await prisma.sokoBotPendingDecision.updateMany({
        where: { id: decision.id, status: "PENDING" },
        data: {
          status: "REJECTED",
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      });
      if (rejected.count === 0) {
        throw new SokoBotRuntimeConflictError(
          "Pending decision was already resolved",
        );
      }
      return prisma.sokoBotPendingDecision.findUniqueOrThrow({
        where: { id: decision.id },
      });
    }

    const decisionToolCallId = `decision:${decision.id}`;
    let resumeProcessing = false;
    if (decision.status === "PROCESSING") {
      const existingDelegation = await prisma.sokoBotDelegation.findUnique({
        where: {
          turnId_toolCallId: {
            turnId: decision.turnId,
            toolCallId: decisionToolCallId,
          },
        },
        select: {
          action: true,
          outcome: true,
          taskId: true,
          jobId: true,
        },
      });
      let recoveredEntityId = existingDelegation?.taskId ?? null;
      if (decision.toolName === "hire_agent") {
        recoveredEntityId = existingDelegation?.jobId ?? null;
      } else if (decision.toolName === "provide_job_input") {
        const proposal = provideJobInputSchema.parse(decision.proposal);
        const existingInput = await prisma.jobInput.findUnique({
          where: { eventId: proposal.eventId },
          select: { id: true },
        });
        recoveredEntityId = existingInput?.id ?? null;
      }
      if (recoveredEntityId) {
        const [, recoveredDecision] = await prisma.$transaction([
          prisma.sokoBotDelegation.updateMany({
            where: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
            },
            data: {
              outcome: "accepted",
              error: null,
              ...(decision.toolName === "hire_agent"
                ? { jobId: recoveredEntityId }
                : {}),
            },
          }),
          prisma.sokoBotPendingDecision.update({
            where: { id: decision.id },
            data: {
              status: "ACCEPTED",
              resolvedAt: new Date(),
              resolvedByUserId: userId,
              resultingEntityId: recoveredEntityId,
            },
          }),
        ]);
        return recoveredDecision;
      }
      const taskTarget = ["create_task", "update_task", "assign_task"].includes(
        decision.toolName,
      );
      const safelyRetryableJobReservation =
        (decision.toolName === "hire_agent" ||
          decision.toolName === "provide_job_input") &&
        (!existingDelegation || existingDelegation.outcome === "failed");
      if (
        (taskTarget && !existingDelegation) ||
        safelyRetryableJobReservation
      ) {
        resumeProcessing = true;
      } else {
        throw new SokoBotRuntimeConflictError(
          "Pending decision processing outcome is ambiguous",
        );
      }
    }

    if (
      !isSokoBotDecisionTargetAllowed(
        decision.toolName,
        decision.turn.capabilityNames,
      )
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "Decision target was not granted for its turn",
      );
    }

    if (!resumeProcessing) {
      const claimed = await prisma.sokoBotPendingDecision.updateMany({
        where: { id: decision.id, status: "PENDING" },
        data: { status: "PROCESSING", resolvedByUserId: userId },
      });
      if (claimed.count === 0) {
        throw new SokoBotRuntimeConflictError(
          "Pending decision was already resolved",
        );
      }
    }

    let failureDisposition: "restore" | "retain" = "restore";
    let sellerReservationMarker: SellerReservationMarker | null = null;
    try {
      const [activeBot, workspace] = await prisma.$transaction([
        prisma.sokoBot.findFirst({
          where: {
            id: decision.sokoBotId,
            userId,
            archivedAt: null,
            status: { not: "PAUSED" },
          },
          select: { id: true },
        }),
        prisma.workspace.findFirst({
          where: sokoBotWorkspaceAccessWhere(userId, decision.workspaceId),
          select: { id: true, organizationId: true },
        }),
      ]);
      if (!activeBot) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot is paused or unavailable",
        );
      }
      if (!workspace) {
        throw new SokoBotRuntimeAuthorizationError(
          "Workspace access is no longer available",
        );
      }

      const proposal = decision.proposal as Record<string, unknown>;
      let resultingEntityId: string | null = null;
      if (decision.toolName === "hire_agent") {
        const hire = parseHireAgentInput(proposal);
        const existingDelegation = await prisma.sokoBotDelegation.findUnique({
          where: {
            turnId_toolCallId: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
            },
          },
          select: { jobId: true, outcome: true, error: true },
        });
        if (existingDelegation?.jobId) {
          return prisma.sokoBotPendingDecision.update({
            where: { id: decision.id },
            data: {
              status: "ACCEPTED",
              resolvedAt: new Date(),
              resolvedByUserId: userId,
              resultingEntityId: existingDelegation.jobId,
            },
          });
        }
        if (existingDelegation && existingDelegation.outcome !== "failed") {
          failureDisposition = "retain";
          throw new SokoBotRuntimeConflictError(
            "Agent hire is already processing",
          );
        }
        const job = await createAgentJobForUser({
          owner: {
            ownerId: userId,
            organizationId: workspace.organizationId,
            workspaceId: decision.workspaceId,
          },
          agentInput: hire,
          beforeSellerStart: async () => {
            sellerReservationMarker = createSellerReservationMarker(
              "hire_agent",
              decision.proposal,
            );
            const marker = serializeSellerReservationMarker(
              sellerReservationMarker,
            );
            await serializableTransaction(async (tx) => {
              // Same bot-row-first order as administrator PAUSE. Whichever
              // transaction wins determines whether seller dispatch may start.
              await tx.$queryRaw`
                SELECT "id"
                FROM "orchestrator"
                WHERE "id" = ${decision.sokoBotId}::uuid
                FOR UPDATE
              `;
              const activeBot = await tx.sokoBot.findFirst({
                where: {
                  id: decision.sokoBotId,
                  userId,
                  archivedAt: null,
                  status: { not: "PAUSED" },
                },
                select: { id: true },
              });
              if (!activeBot) {
                throw new SokoBotRuntimeAuthorizationError(
                  "Soko Bot is paused or unavailable",
                );
              }
              if (existingDelegation?.outcome === "failed") {
                const reserved = await tx.sokoBotDelegation.updateMany({
                  where: {
                    turnId: decision.turnId,
                    toolCallId: decisionToolCallId,
                    outcome: "failed",
                    error: existingDelegation.error ?? null,
                  },
                  data: { outcome: "processing", error: marker },
                });
                if (reserved.count !== 1) {
                  failureDisposition = "retain";
                  throw new SokoBotRuntimeConflictError(
                    "Agent hire retry was already reserved",
                  );
                }
              } else {
                await tx.sokoBotDelegation.create({
                  data: {
                    turnId: decision.turnId,
                    toolCallId: decisionToolCallId,
                    kind: "JOB",
                    action: "hire_agent",
                    outcome: "processing",
                    error: marker,
                  },
                });
              }
            }, "Soko Bot hire reservation collided with administrator control");
            // Reservation is durable. Never return this decision to PENDING
            // after crossing into seller-side execution: a retry could create
            // and charge a second Job if the first response was lost.
            failureDisposition = "retain";
          },
          afterSellerStartFailure: async (failure) => {
            const marker = sellerReservationMarker;
            await prisma.sokoBotDelegation.update({
              where: {
                turnId_toolCallId: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                },
              },
              data: {
                outcome:
                  failure.kind === "unreachable" ? "failed" : "ambiguous",
                error: marker
                  ? serializeSellerReservationMarker(
                      marker,
                      new Error(failure.message),
                    )
                  : persistedErrorDetail(new Error(failure.message)),
              },
            });
            // Explicit pre-acceptance rejection is safe to retry. Unknown or
            // invalid-success outcomes may already have seller work running.
            failureDisposition =
              failure.kind === "unreachable" ? "restore" : "retain";
          },
          afterLocalJobCreate: async (job, tx) => {
            const marker = sellerReservationMarker;
            if (!marker) {
              throw new SokoBotRuntimeConflictError(
                "Agent hire reservation is missing",
              );
            }
            const attached = await tx.sokoBotDelegation.updateMany({
              where: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
                outcome: "processing",
                error: serializeSellerReservationMarker(marker),
              },
              data: { outcome: "accepted", jobId: job.id, error: null },
            });
            if (attached.count !== 1) {
              throw new SokoBotRuntimeConflictError(
                "Agent hire reservation changed before local commit",
              );
            }
          },
        });
        resultingEntityId = job.id;
      } else if (decision.toolName === "provide_job_input") {
        const input = provideJobInputSchema.parse(proposal);
        const durableInput = await prisma.jobInput.findUnique({
          where: { eventId: input.eventId },
          select: { id: true },
        });
        if (durableInput) {
          resultingEntityId = durableInput.id;
        } else {
          const event = await prisma.jobEvent.findFirst({
            where: {
              id: input.eventId,
              jobId: input.jobId,
              status: AgentJobStatus.AWAITING_INPUT,
              job: { ownerId: userId, workspaceId: decision.workspaceId },
            },
            include: {
              input: true,
              job: {
                include: { agent: { include: { metadataOverride: true } } },
              },
            },
          });
          if (!event || event.input || !event.inputSchema) {
            throw new SokoBotRuntimeConflictError(
              "Job no longer awaits this input",
            );
          }
          const existingDelegation = await prisma.sokoBotDelegation.findUnique({
            where: {
              turnId_toolCallId: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
            },
            select: { outcome: true, error: true },
          });
          if (existingDelegation && existingDelegation.outcome !== "failed") {
            failureDisposition = "retain";
            throw new SokoBotRuntimeConflictError(
              "Agent Job input is already processing",
            );
          }
          sellerReservationMarker = createSellerReservationMarker(
            "provide_job_input",
            decision.proposal,
          );
          const marker = serializeSellerReservationMarker(
            sellerReservationMarker,
          );
          await serializableTransaction(async (tx) => {
            await tx.$queryRaw`
              SELECT "id"
              FROM "orchestrator"
              WHERE "id" = ${decision.sokoBotId}::uuid
              FOR UPDATE
            `;
            const activeBot = await tx.sokoBot.findFirst({
              where: {
                id: decision.sokoBotId,
                userId,
                archivedAt: null,
                status: { not: "PAUSED" },
              },
              select: { id: true },
            });
            if (!activeBot) {
              throw new SokoBotRuntimeAuthorizationError(
                "Soko Bot is paused or unavailable",
              );
            }
            if (existingDelegation?.outcome === "failed") {
              const reserved = await tx.sokoBotDelegation.updateMany({
                where: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                  outcome: "failed",
                  error: existingDelegation.error ?? null,
                },
                data: { outcome: "processing", error: marker },
              });
              if (reserved.count !== 1) {
                failureDisposition = "retain";
                throw new SokoBotRuntimeConflictError(
                  "Agent Job input retry was already reserved",
                );
              }
            } else {
              await tx.sokoBotDelegation.create({
                data: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                  kind: "JOB",
                  action: "provide_job_input",
                  outcome: "processing",
                  jobId: event.job.id,
                  error: marker,
                },
              });
            }
          }, "Soko Bot input reservation collided with administrator control");
          // provide_input has no idempotency key. Only explicit rejection may
          // reopen the decision; every other failure remains durably fenced.
          failureDisposition = "retain";
          const result = await createAgentClient().provideJobInput(
            {
              id: event.job.agent.id,
              name: event.job.agent.name,
              blockchainIdentifier:
                event.job.agentBlockchainIdentifier ??
                event.job.agent.blockchainIdentifier,
              apiBaseUrl:
                event.job.agentApiBaseUrl ?? event.job.agent.apiBaseUrl ?? "",
            },
            event.job.agentJobId,
            event.inputSchema,
            input.inputData,
          );
          if (result.isErr()) {
            await prisma.sokoBotDelegation.update({
              where: {
                turnId_toolCallId: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                },
              },
              data: {
                outcome:
                  result.error.kind === "unreachable" ? "failed" : "ambiguous",
                error: serializeSellerReservationMarker(
                  sellerReservationMarker,
                  new Error(result.error.message),
                ),
              },
            });
            failureDisposition =
              result.error.kind === "unreachable" ? "restore" : "retain";
            throw new SokoBotRuntimeValidationError(result.error.message);
          }
          try {
            const jobInput = await prisma.jobInput.create({
              data: {
                eventId: event.id,
                input: JSON.stringify(input.inputData),
                inputHash: result.value.input_hash,
                signature: result.value.signature,
              },
            });
            resultingEntityId = jobInput.id;
          } catch (error) {
            const recoveredInput = await prisma.jobInput.findUnique({
              where: { eventId: event.id },
              select: { id: true },
            });
            if (recoveredInput) {
              resultingEntityId = recoveredInput.id;
            } else {
              await prisma.sokoBotDelegation.update({
                where: {
                  turnId_toolCallId: {
                    turnId: decision.turnId,
                    toolCallId: decisionToolCallId,
                  },
                },
                data: {
                  outcome: "ambiguous",
                  error: serializeSellerReservationMarker(
                    sellerReservationMarker,
                    error,
                  ),
                },
              });
              throw error;
            }
          }
          await prisma.sokoBotDelegation.update({
            where: {
              turnId_toolCallId: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
            },
            data: { outcome: "accepted", error: null },
          });
        }
      } else if (decision.toolName === "create_task") {
        const authorized: SokoBotActionContext = {
          turn: {
            id: decision.turnId,
            sokoBotId: decision.sokoBotId,
            userId,
            workspaceId: decision.workspaceId,
            eveSessionId: decision.turn.eveSessionId,
            versionId: decision.turn.versionId,
            source: decision.turn.source,
            chainDepth: decision.turn.chainDepth,
          },
          classificationConfidence: 1,
          hasNegatedMutationIntent: false,
        };
        const task = await this.createTask(
          authorized,
          proposal,
          `decision:${decision.id}`,
          true,
        );
        resultingEntityId = task.id;
      } else if (decision.toolName === "update_task") {
        const updated = await this.updateTask(
          {
            turn: {
              id: decision.turnId,
              sokoBotId: decision.sokoBotId,
              userId,
              workspaceId: decision.workspaceId,
              eveSessionId: decision.turn.eveSessionId,
              versionId: decision.turn.versionId,
              source: decision.turn.source,
              chainDepth: decision.turn.chainDepth,
            },
            classificationConfidence: 1,
            hasNegatedMutationIntent: false,
          },
          proposal,
          `decision:${decision.id}`,
          true,
        );
        resultingEntityId = updated.id;
      } else if (decision.toolName === "assign_task") {
        const updated = await this.assignTask(
          {
            turn: {
              id: decision.turnId,
              sokoBotId: decision.sokoBotId,
              userId,
              workspaceId: decision.workspaceId,
              eveSessionId: decision.turn.eveSessionId,
              versionId: decision.turn.versionId,
              source: decision.turn.source,
              chainDepth: decision.turn.chainDepth,
            },
            classificationConfidence: 1,
            hasNegatedMutationIntent: false,
          },
          proposal,
          `decision:${decision.id}`,
          true,
        );
        resultingEntityId = updated.id;
      }

      return await prisma.sokoBotPendingDecision.update({
        where: { id: decision.id },
        data: {
          status: "ACCEPTED",
          resolvedAt: new Date(),
          resolvedByUserId: userId,
          resultingEntityId,
        },
      });
    } catch (error) {
      if (failureDisposition === "restore") {
        await prisma.sokoBotPendingDecision.updateMany({
          where: { id: decision.id, status: "PROCESSING" },
          data: { status: "PENDING", resolvedByUserId: null },
        });
      } else {
        await prisma.sokoBotDelegation.updateMany({
          where: {
            turnId: decision.turnId,
            toolCallId: decisionToolCallId,
            outcome: "processing",
          },
          data: {
            outcome: "ambiguous",
            error: sellerReservationMarker
              ? serializeSellerReservationMarker(sellerReservationMarker, error)
              : persistedErrorDetail(error),
          },
        });
      }
      throw error;
    }
  }
}

export const sokoBotRuntimeService = new SokoBotRuntimeService();

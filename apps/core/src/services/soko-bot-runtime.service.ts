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
  containsSokoBotSensitiveMaterial,
  sokoBotDecisionInputSchema as decisionInputSchema,
  hasSokoBotNegatedMutationIntent,
  sokoBotHireAgentInputSchema as hireAgentInputSchema,
  isSokoBotCapability,
  isSokoBotDecisionTarget,
  sokoBotJobIdInputSchema as jobIdInputSchema,
  sokoBotMemoryUpdateInputSchema as memoryUpdateInputSchema,
  parseSokoBotMemory,
  sokoBotProvideJobInputSchema as provideJobInputSchema,
  redactSokoBotSensitiveText,
  renderSokoBotMemory,
  type SokoBotCapability,
  type SokoBotDecisionTarget,
  type SokoBotTurnGrantClaims,
  sanitizeSokoBotMemoryMarkdown,
  sokoBotSearchInputSchema as searchInputSchema,
  sokoBotAssignTaskInputSchema as taskAssignInputSchema,
  sokoBotCreateTaskInputSchema as taskCreateInputSchema,
  sokoBotTaskIdInputSchema as taskIdInputSchema,
  sokoBotUpdateTaskInputSchema as taskUpdateInputSchema,
} from "@sokosumi/soko-bot";
import { verifyVercelOidcToken } from "@vercel/oidc";
import { getEnv } from "@/config/env";
import { toMasumiAgent } from "@/helpers/agent";
import { createAgentJobForUser } from "@/helpers/job";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { getSokoBotTokenService } from "@/lib/soko-bot/factory";
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
const MUTATION_CONFIDENCE_THRESHOLD = 0.65;
const PERSISTED_VALUE_MAX_DEPTH = 8;
const PERSISTED_COLLECTION_MAX_ITEMS = 100;
const SELLER_RESERVATION_MARKER_VERSION = 1;
type SokoBotAutonomyLevel = "LOW" | "MEDIUM" | "HIGH";

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

export interface RuntimeAuthorizationInput {
  oidcToken: string;
  turnGrant: string;
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
  };
  autonomyLevel: SokoBotAutonomyLevel;
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

function sanitizePersistedValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactSokoBotSensitiveText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (depth >= PERSISTED_VALUE_MAX_DEPTH || seen.has(value)) {
    return "[Truncated]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, PERSISTED_COLLECTION_MAX_ITEMS)
      .map((item) => sanitizePersistedValue(item, depth + 1, seen));
    if (value.length > items.length) items.push("[Truncated]");
    return items;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(
    0,
    PERSISTED_COLLECTION_MAX_ITEMS,
  );
  for (const [key, entry] of entries) {
    const safeKey = redactSokoBotSensitiveText(key);
    result[safeKey] = containsSokoBotSensitiveMaterial(`${key}: value`)
      ? redactSokoBotSensitiveText(`${key}: value`)
      : sanitizePersistedValue(entry, depth + 1, seen);
  }
  if (Object.keys(value).length > entries.length) result._truncated = true;
  return result;
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

function assertSameScope(
  grant: SokoBotTurnGrantClaims,
  input: RuntimeAuthorizationInput,
): void {
  if (grant.turnId !== input.turnId) {
    throw new SokoBotRuntimeAuthorizationError(
      "Turn grant does not match turn",
    );
  }
  if (input.capability && !grant.capabilities.includes(input.capability)) {
    throw new SokoBotRuntimeAuthorizationError("Capability is not granted");
  }
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

function requiresDecision(
  authorized: SokoBotActionContext,
  capability: SokoBotCapability,
  input: unknown,
): boolean {
  if (capability === "hire_agent" || capability === "provide_job_input")
    return true;
  if (capability === "request_user_decision") return false;
  if (
    isSokoBotDecisionTarget(capability) &&
    authorized.classificationConfidence < MUTATION_CONFIDENCE_THRESHOLD
  ) {
    return true;
  }
  if (authorized.autonomyLevel === "LOW") {
    return ["create_task", "update_task", "assign_task"].includes(capability);
  }
  if (authorized.autonomyLevel === "MEDIUM") {
    if (capability === "assign_task") return true;
    if (capability === "create_task") {
      return taskCreateInputSchema.parse(input).status === "READY";
    }
    if (capability === "update_task") {
      return taskUpdateInputSchema.parse(input).status === "READY";
    }
  }
  return false;
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
    if (!env.SOKO_BOT_EVE_PROJECT_ID || !env.SOKO_BOT_EVE_ENVIRONMENT) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot Eve OIDC allowlist is not configured",
      );
    }
    try {
      await verifyVercelOidcToken(input.oidcToken, {
        projectId: env.SOKO_BOT_EVE_PROJECT_ID,
        environment: env.SOKO_BOT_EVE_ENVIRONMENT,
      });
    } catch {
      throw new SokoBotRuntimeAuthorizationError(
        "Invalid Eve deployment identity",
      );
    }

    let grant: SokoBotTurnGrantClaims;
    try {
      grant = await (await getSokoBotTokenService()).verifyTurnGrant(
        input.turnGrant,
      );
    } catch {
      throw new SokoBotRuntimeAuthorizationError(
        "Invalid or expired turn grant",
      );
    }
    assertSameScope(grant, input);

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
        deadlineAt: true,
        leaseExpiresAt: true,
        sokoBot: {
          select: {
            autonomyLevel: true,
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
    if (
      turn.sokoBotId !== grant.sokoBotId ||
      turn.userId !== grant.userId ||
      turn.workspaceId !== grant.workspaceId
    ) {
      throw new SokoBotRuntimeAuthorizationError("Turn grant scope mismatch");
    }
    let storedSessionId = turn.eveSessionId;
    if (grant.sessionId === `pending:${turn.id}` && storedSessionId === null) {
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
          select: { eveSessionId: true, id: true },
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
    const sessionMatches =
      grant.sessionId === input.sessionId ||
      (grant.sessionId === `pending:${turn.id}` &&
        storedSessionId === input.sessionId);
    if (!sessionMatches || storedSessionId !== input.sessionId) {
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
      },
      autonomyLevel: turn.sokoBot.autonomyLevel,
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
    return snapshot;
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
          reason: decisionReason(toolName, parsedProposal),
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
        input.capability === "request_user_decision")
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "User explicitly asked not to create, assign, or hire work",
      );
    }
    if (requiresDecision(authorized, input.capability, input.input)) {
      if (!isSokoBotDecisionTarget(input.capability)) {
        throw new SokoBotRuntimeValidationError(
          "Capability cannot create an approval decision",
        );
      }
      const decision = await this.createDecision(
        authorized,
        input.capability,
        input.input,
        input.toolCallId,
        true,
      );
      return {
        approvalRequired: true,
        decision,
        message: DECISION_PENDING_MESSAGE,
      };
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
        return prisma.task.findFirst({
          where: { id: taskId, workspaceId: authorized.turn.workspaceId },
          select: {
            id: true,
            name: true,
            status: true,
            assigneeId: true,
            updatedAt: true,
          },
        });
      }
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
      case "hire_agent":
        parseHireAgentInput(input.input);
        return this.createDecision(
          authorized,
          input.capability,
          input.input,
          input.toolCallId,
          false,
        );
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
        return this.createDecision(
          authorized,
          input.capability,
          input.input,
          input.toolCallId,
          false,
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
      case "scratch_read":
      case "scratch_write":
      case "scratch_list":
        throw new SokoBotRuntimeValidationError(
          "Scratch capabilities execute inside Eve sandbox only",
        );
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
          },
          autonomyLevel: "HIGH",
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
            },
            autonomyLevel: "HIGH",
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
            },
            autonomyLevel: "HIGH",
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

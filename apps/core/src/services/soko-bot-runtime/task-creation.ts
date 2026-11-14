import { randomUUID } from "node:crypto";
import { Channel } from "@sokosumi/database";
import {
  type SokoBotDecisionTarget,
  sokoBotCreateTaskInputSchema as taskCreateInputSchema,
} from "@sokosumi/soko-bot";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  actionInputHash,
  actionOperationKey,
  commitActionReceipt,
} from "@/lib/soko-bot/action-receipts";
import {
  decisionProposalTargets,
  describeDecision,
  parseDecisionProposal,
} from "@/lib/soko-bot/decision-proposal";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { claimTaskEventAction } from "@/services/soko-bot-event-action.service";
import { createTaskForActor } from "@/services/task-domain.service";
import {
  type AuthorizedSokoBotRuntime,
  personAssignee,
  type SokoBotActionContext,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import { actionPrincipalId } from "./acting-scope";
import { DECISION_TTL_MS } from "./execution-limits";
import { type RuntimeOperations } from "./operations";
import { onlyEventTask, toolAssigneeFields } from "./task-policy";

/**
 * Nothing waits for an owner: the proposal is recorded as a decision the
 * owner's policy accepts on the spot, then executed through the same
 * fenced, idempotent path an accepted approval uses.
 */
export async function executeAsAccepted(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
  toolCallId: string,
) {
  const decision = await runtime.createDecision(
    authorized,
    toolName,
    proposal,
    toolCallId,
  );
  const resolved = await runtime
    .resolveDecision(authorized.turn.actingUserId, decision.id, true, false)
    .catch(async (error: unknown) => {
      // Nobody will answer a card, so one that failed must not linger as
      // "approval waiting" or be picked up by a later "yes".
      await runtime.expireDecision(decision.id);
      throw error;
    });
  return {
    executed: resolved.status === "ACCEPTED",
    decisionId: resolved.id,
    status: resolved.status,
    resultingEntityId: resolved.resultingEntityId,
  };
}

export async function expireDecision(
  runtime: RuntimeOperations,
  decisionId: string,
) {
  const expired = await prisma.sokoBotPendingDecision.updateMany({
    where: { id: decisionId, status: "PENDING" },
    data: { status: "EXPIRED", resolvedAt: new Date() },
  });
  if (expired.count === 0) return;
  await prisma.sokoBotIntent.updateMany({
    where: {
      decisions: { some: { id: decisionId } },
      state: "AWAITING_CONFIRMATION",
    },
    data: { state: "CANCELLED", revision: { increment: 1 } },
  });
}

export async function createDecision(
  runtime: RuntimeOperations,
  authorized: SokoBotActionContext,
  toolName: SokoBotDecisionTarget,
  proposal: unknown,
  toolCallId: string,
) {
  const parsedProposal = parseDecisionProposal(toolName, proposal);
  const proposalJson = jsonInput(parsedProposal);
  const reason = await describeDecision(toolName, parsedProposal);
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      toolName,
      decisionProposalTargets(toolName, parsedProposal),
    );
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
    if (existing) return existing;
    const intentTurn = await tx.sokoBotTurn.findFirst({
      where: { id: authorized.turn.id },
      select: { intentId: true },
    });
    if (intentTurn?.intentId) {
      await tx.sokoBotIntent.updateMany({
        where: {
          id: intentTurn.intentId,
          state: { in: ["ACTIVE", "AWAITING_CONFIRMATION"] },
        },
        data: {
          state: "AWAITING_CONFIRMATION",
          desiredOutcome: reason,
          allowedActions: [toolName],
          expiresAt: new Date(Date.now() + DECISION_TTL_MS),
        },
      });
    }
    const decision = await tx.sokoBotPendingDecision.create({
      data: {
        intentId: intentTurn?.intentId,
        sokoBotId: authorized.turn.sokoBotId,
        turnId: authorized.turn.id,
        requestedByUserId: authorized.turn.requestedByUserId,
        workspaceId: authorized.turn.workspaceId,
        toolName,
        reason,
        proposal: proposalJson,
        expiresAt: new Date(Date.now() + DECISION_TTL_MS),
      },
      select: { id: true, status: true, expiresAt: true },
    });
    await tx.sokoBotToolCall.update({
      where: {
        turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
      },
      data: { status: "COMPLETED", result: persistedToolResult(decision) },
    });
    return decision;
  }, "Soko Bot decision collided with cancellation");
}

export async function createTask(
  runtime: RuntimeOperations,
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
    const workspace = await runtime.requireMutationAuthority(
      tx,
      authorized,
      approved,
      "create_task",
      decisionProposalTargets("create_task", input),
    );
    const triggeringTaskId =
      input.triggeringTaskId ??
      (authorized.turn.source === "EVENT"
        ? await onlyEventTask(tx, authorized.turn)
        : undefined);
    const claim = triggeringTaskId
      ? await claimTaskEventAction(
          tx,
          {
            ...authorized.turn,
            turnId: authorized.turn.id,
            source: authorized.turn.source ?? "CHAT",
          },
          triggeringTaskId,
          "CREATE_TASK",
        )
      : { allowed: true, claimId: null };
    if (!claim.allowed)
      throw new SokoBotRuntimeAuthorizationError(
        claim.refusal ?? "This turn may not change this Task",
      );
    if (approved) {
      await tx.sokoBotToolCall.upsert({
        where: {
          turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
        },
        create: {
          turnId: authorized.turn.id,
          toolCallId,
          capability: "create_task",
          operationKey: actionOperationKey({
            workspaceId: authorized.turn.workspaceId,
            principalId: actionPrincipalId(authorized.turn),
            intentRevision: toolCallId,
            capability: "create_task",
            inputHash: actionInputHash(rawInput),
          }),
          inputHash: actionInputHash(rawInput),
          actorBotId: authorized.turn.sokoBotId,
        },
        update: {},
      });
    }
    const effectEventId = randomUUID();
    const task = await createTaskForActor(
      {
        actor: {
          kind: "soko_bot",
          sokoBotId: authorized.turn.sokoBotId,
        },
        ownerId: authorized.turn.actingUserId,
        organizationId: workspace.organizationId,
        workspaceId: authorized.turn.workspaceId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        ...toolAssigneeFields(
          input.coworkerId,
          authorized.turn.sokoBotId,
          personAssignee(input, authorized.turn.actingUserId),
        ),
        status: input.status,
        channel: Channel.SOKOSUMI,
        effectEventId,
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
        followUp: input.followUp,
      },
    });
    {
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: task.id,
        effectEventId,
        claimId: claim.claimId,
        observedVersion: task.updatedAt?.toISOString(),
        result: persistedToolResult(result),
      });
    }
    return result;
  }, "Soko Bot Task creation collided with another action");
}

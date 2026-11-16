import { randomUUID } from "node:crypto";
import { Channel, TaskStatus } from "@sokosumi/database";
import {
  sokoBotArchiveTaskInputSchema as taskArchiveInputSchema,
  sokoBotAssignTaskInputSchema as taskAssignInputSchema,
  sokoBotUpdateTaskInputSchema as taskUpdateInputSchema,
} from "@sokosumi/soko-bot";
import { buildTaskWriteAccessWhere } from "@/helpers/access-control";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  actionInputHash,
  actionOperationKey,
  commitActionReceipt,
} from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { claimTaskEventAction } from "@/services/soko-bot-event-action.service";
import { updateTaskForActor } from "@/services/task-domain.service";
import {
  personAssignee,
  type SokoBotActionContext,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
} from "../soko-bot-runtime.service";
import { actionPrincipalId } from "./acting-scope";
import { type RuntimeOperations } from "./operations";
import { toolAssigneeFields } from "./task-policy";

export async function mutateTask(
  runtime: RuntimeOperations,
  authorized: SokoBotActionContext,
  rawInput: unknown,
  toolCallId: string,
  options: { capability: "update_task" | "archive_task"; approved?: boolean },
) {
  const { capability, approved = false } = options;
  // Archiving is managing the Task (ADR 0057): never for nobody, not even
  // as a no-op on an archived one.
  if (capability === "archive_task" && authorized.turn.actingUserId === null)
    throw new SokoBotRefusedUnsentError(
      "Archiving a Task needs an Organization owner or admin; suggest it in your chat instead",
    );
  const input: ReturnType<typeof taskUpdateInputSchema.parse> & {
    archive: boolean;
  } =
    capability === "archive_task"
      ? { ...taskArchiveInputSchema.parse(rawInput), archive: true }
      : { ...taskUpdateInputSchema.parse(rawInput), archive: false };
  return runtime.applyTaskMutation(
    authorized,
    rawInput,
    toolCallId,
    input,
    capability,
    approved,
  );
}

export async function applyTaskMutation(
  runtime: RuntimeOperations,
  authorized: SokoBotActionContext,
  rawInput: unknown,
  toolCallId: string,
  input: ReturnType<typeof taskUpdateInputSchema.parse> & {
    archive: boolean;
  },
  capability: "update_task" | "archive_task",
  approved: boolean,
) {
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      approved,
      capability,
      {
        taskIds: [input.taskId],
        projectIds: input.projectId === undefined ? [] : [input.projectId],
      },
    );
    const claim = await claimTaskEventAction(
      tx,
      {
        ...authorized.turn,
        turnId: authorized.turn.id,
        source: authorized.turn.source ?? "CHAT",
      },
      input.taskId,
      "TASK_STATE",
    );
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
          capability,
          operationKey: actionOperationKey({
            workspaceId: authorized.turn.workspaceId,
            principalId: actionPrincipalId(authorized.turn),
            intentRevision: toolCallId,
            capability,
            inputHash: actionInputHash(rawInput),
          }),
          inputHash: actionInputHash(rawInput),
          actorBotId: authorized.turn.sokoBotId,
        },
        update: {},
      });
    }
    const before = await tx.task.findFirst({
      where: {
        id: input.taskId,
        workspaceId: authorized.turn.workspaceId,
        // What the owner may change in the app, not only what they created.
        // Acting on its own, a shared bot changes public Tasks only; the
        // write scope check above already bounded them to its scope.
        ...(authorized.turn.actingUserId === null
          ? { visibility: "PUBLIC" as const }
          : buildTaskWriteAccessWhere(authorized.turn.actingUserId)),
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        projectId: true,
        archivedAt: true,
        updatedAt: true,
        assigneeId: true,
        assigneeSokoBotId: true,
        assigneeUserId: true,
      },
    });
    // A Task the bot can see but the owner may not change gets a reason the
    // owner can act on, not a bare "Task not found".
    if (
      !before &&
      (await tx.task.findFirst({
        where: { id: input.taskId, workspaceId: authorized.turn.workspaceId },
        select: { id: true },
      }))
    )
      throw new SokoBotRuntimeAuthorizationError(
        "This Task belongs to someone else and is private, so only its owner can change or archive it",
      );
    const unassign =
      input.unassign === true &&
      Boolean(
        before?.assigneeId ||
          before?.assigneeSokoBotId ||
          before?.assigneeUserId,
      );
    if (input.archive && before?.archivedAt) {
      const event = await tx.taskEvent.create({
        data: {
          taskId: before.id,
          sokoBotId: authorized.turn.sokoBotId,
          comment:
            "Verified that this Task was already archived; history retained",
        },
      });
      const result = {
        id: before.id,
        name: before.name,
        status: before.status,
        assigneeId: before.assigneeId,
        before: {
          projectId: before.projectId,
          archivedAt: before.archivedAt,
        },
        after: { projectId: before.projectId, archivedAt: before.archivedAt },
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: capability,
          outcome: before.status,
          lastSeenStatus: before.status,
          taskId: before.id,
        },
      });
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: before.id,
        effectEventId: event.id,
        claimId: claim.claimId,
        observedVersion: before.updatedAt.toISOString(),
        disposition: "ALREADY_SATISFIED",
        result: persistedToolResult(result),
      });
      return result;
    }
    if (
      before &&
      !input.archive &&
      (input.name === undefined || input.name === before.name) &&
      (input.description === undefined ||
        input.description === before.description) &&
      (input.status === undefined || input.status === before.status) &&
      (input.projectId === undefined || input.projectId === before.projectId) &&
      !unassign
    ) {
      if (
        input.expectedUpdatedAt &&
        before.updatedAt.toISOString() !== input.expectedUpdatedAt
      )
        throw new SokoBotRuntimeConflictError("Task changed; read it again");
      const unchanged = {
        id: before.id,
        name: before.name,
        status: before.status,
        assigneeId: before.assigneeId,
        before: {
          projectId: before.projectId,
          archivedAt: before.archivedAt,
        },
        after: { projectId: before.projectId, archivedAt: before.archivedAt },
      };
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: before.id,
        claimId: claim.claimId,
        observedVersion: before.updatedAt?.toISOString(),
        disposition: "ALREADY_SATISFIED",
        result: persistedToolResult(unchanged),
      });
      return unchanged;
    }
    const effectEventId = randomUUID();
    const task = await updateTaskForActor(
      {
        actor: {
          kind: "soko_bot",
          sokoBotId: authorized.turn.sokoBotId,
        },
        userId: authorized.turn.actingUserId,
        workspaceId: authorized.turn.workspaceId,
        taskId: input.taskId,
        intent: "metadata",
        name: input.name,
        description: input.description,
        projectId: input.projectId,
        ...(unassign ? { assigneeId: null } : {}),
        expectedUpdatedAt: input.expectedUpdatedAt
          ? new Date(input.expectedUpdatedAt)
          : undefined,
        archive: input.archive,
        status: input.status,
        channel: Channel.SOKOSUMI,
        effectEventId,
      },
      tx,
    );
    const updated = {
      id: task.id,
      name: task.name,
      status: task.status,
      assigneeId: task.assigneeId,
      before: {
        projectId: before?.projectId ?? null,
        archivedAt: before?.archivedAt ?? null,
      },
      after: { projectId: task.projectId, archivedAt: task.archivedAt },
    };
    await tx.sokoBotDelegation.create({
      data: {
        turnId: authorized.turn.id,
        toolCallId,
        kind: "TASK",
        action: capability,
        outcome: updated.status,
        lastSeenStatus: updated.status,
        taskId: updated.id,
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
        result: persistedToolResult(updated),
      });
    }
    return updated;
  }, "Soko Bot Task update collided with another action");
}

export async function assignTask(
  runtime: RuntimeOperations,
  authorized: SokoBotActionContext,
  rawInput: unknown,
  toolCallId: string,
  approved = false,
) {
  const input = taskAssignInputSchema.parse(rawInput);
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      approved,
      "assign_task",
      { taskIds: [input.taskId] },
    );
    const status = input.ready ? TaskStatus.READY : TaskStatus.DRAFT;
    const claim = await claimTaskEventAction(
      tx,
      {
        ...authorized.turn,
        turnId: authorized.turn.id,
        source: authorized.turn.source ?? "CHAT",
      },
      input.taskId,
      "TASK_STATE",
    );
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
          capability: "assign_task",
          operationKey: actionOperationKey({
            workspaceId: authorized.turn.workspaceId,
            principalId: actionPrincipalId(authorized.turn),
            intentRevision: toolCallId,
            capability: "assign_task",
            inputHash: actionInputHash(rawInput),
          }),
          inputHash: actionInputHash(rawInput),
          actorBotId: authorized.turn.sokoBotId,
        },
        update: {},
      });
    }
    const effectEventId = randomUUID();
    const task = await updateTaskForActor(
      {
        actor: {
          kind: "soko_bot",
          sokoBotId: authorized.turn.sokoBotId,
        },
        userId: authorized.turn.actingUserId,
        workspaceId: authorized.turn.workspaceId,
        taskId: input.taskId,
        intent: "assignment",
        ...toolAssigneeFields(
          input.coworkerId,
          authorized.turn.sokoBotId,
          personAssignee(input, authorized.turn.actingUserId),
        ),
        status,
        channel: Channel.SOKOSUMI,
        effectEventId,
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
        result: persistedToolResult(updated),
      });
    }
    return updated;
  }, "Soko Bot Task assignment collided with another action");
}

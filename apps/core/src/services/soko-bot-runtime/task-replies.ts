import { Channel, type Prisma, TaskStatus } from "@sokosumi/database";
import {
  sokoBotLinkTasksInputSchema as linkTasksInputSchema,
  sokoBotReplyToTaskInputSchema as replyToTaskInputSchema,
  sokoBotUpdateAssignedTaskInputSchema as updateAssignedTaskInputSchema,
} from "@sokosumi/soko-bot";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { applyGuardedTaskStatusUpdate } from "@/helpers/task-event-charge";
import { mapTaskLinkRelationToWriteData } from "@/helpers/task-link";
import { buildSokoBotReaderTaskWhere } from "@/helpers/task-visibility";
import { serializableTransaction } from "@/lib/db/transaction";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { claimTaskEventAction } from "@/services/soko-bot-event-action.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";
import { MAX_BOT_COMMENTS_PER_TASK_PER_DAY } from "./task-policy";

/** Progress a Task this Soko Bot is assigned to; no credits involved. */
export async function updateAssignedTask(
  runtime: RuntimeOperations,
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
  const persisted = await serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      "update_assigned_task",
      { taskIds: [input.taskId] },
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
    const task = await tx.task.findFirst({
      where: {
        id: input.taskId,
        workspaceId: authorized.turn.workspaceId,
        archivedAt: null,
      },
      select: {
        id: true,
        ownerId: true,
        status: true,
        assigneeSokoBotId: true,
      },
    });
    if (!task)
      throw new SokoBotRuntimeValidationError(
        "Task not found; copy its id exactly from list_tasks or get_task_status",
      );
    if (task.assigneeSokoBotId !== authorized.turn.sokoBotId) {
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
    const event = await tx.taskEvent.create({
      data: {
        taskId: task.id,
        status: next,
        comment: input.comment,
        channel: Channel.SOKOSUMI,
        sokoBotId: authorized.turn.sokoBotId,
      },
      select: { id: true },
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
    const result = { taskId: task.id, status: next, eventId: event.id };
    const receipt = await commitActionReceipt(tx, {
      turnId: authorized.turn.id,
      toolCallId,
      actorBotId: authorized.turn.sokoBotId,
      targetId: task.id,
      effectEventId: event.id,
      result: persistedToolResult(result),
    });
    if (claim.claimId)
      await tx.sokoBotTaskActionClaim.update({
        where: { id: claim.claimId },
        data: { receiptId: receipt.id },
      });
    return {
      result,
      eventId: event.id,
      ownerId: task.ownerId,
    };
  }, "Soko Bot task update collided with another request");
  return persisted.result;
}

/** Comment on a Task, optionally resuming it (INPUT_REQUIRED/FAILED/… → READY). */
export async function replyToTask(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  rawInput: unknown,
  toolCallId: string,
  options?: { transaction: Prisma.TransactionClient; publicationId: string },
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
  const persist = async (tx: Prisma.TransactionClient) => {
    await runtime.requireMutationAuthority(
      tx,
      authorized,
      false,
      "reply_to_task",
    );
    const claim = input.status
      ? await claimTaskEventAction(
          tx,
          {
            ...authorized.turn,
            turnId: authorized.turn.id,
            source: authorized.turn.source ?? "CHAT",
          },
          input.taskId,
          "TASK_STATE",
        )
      : { allowed: true, claimId: null };
    if (!claim.allowed)
      throw new SokoBotRuntimeAuthorizationError(
        claim.refusal ?? "This turn may not change this Task",
      );
    const task = await tx.task.findFirst({
      where: {
        id: input.taskId,
        workspaceId: authorized.turn.workspaceId,
        archivedAt: null,
        ...buildSokoBotReaderTaskWhere(authorized.reader),
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        status: true,
        assigneeId: true,
        assigneeSokoBotId: true,
        assigneeUserId: true,
      },
    });
    if (!task)
      throw new SokoBotRuntimeValidationError(
        "Task not found; copy its id exactly from list_tasks or get_task_status",
      );
    if (!input.status && !options?.publicationId) {
      const events = await tx.taskEvent.findMany({
        where: {
          taskId: task.id,
          sokoBotId: authorized.turn.sokoBotId,
          status: null,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
        },
        select: { id: true, comment: true },
      });
      const recent = events.filter((event) => {
        const match = /^\[Open table\]\(\/drive\/tables\/([0-9a-f-]+)\)$/.exec(
          event.comment ?? "",
        );
        const tableId = z.uuid().safeParse(match?.[1]);
        return (
          !tableId.success ||
          event.comment !== `[Open table](/drive/tables/${tableId.data})` ||
          event.id !==
            uuidv5(
              `table-created:task:${task.id}:${authorized.turn.sokoBotId}`,
              tableId.data,
            )
        );
      }).length;
      if (recent >= MAX_BOT_COMMENTS_PER_TASK_PER_DAY) {
        throw new SokoBotRuntimeValidationError(
          `You already commented ${recent} times on this Task today; hold further comments unless they are urgent`,
        );
      }
    }
    const close =
      (input.status === "CANCELED" || input.status === "COMPLETED") &&
      task.status !== input.status
        ? TaskStatus[input.status]
        : null;
    // Cancelling or completing ends the work for good, so it is the owner's
    // call and only on the owner's own Tasks, as in the app's status picker;
    // commenting stays open to any visible one. A turn for nobody has no
    // owner, so it closes nothing.
    const { actingUserId } = authorized.turn;
    if (close && (actingUserId === null || task.ownerId !== actingUserId))
      throw new SokoBotRuntimeValidationError(
        "Only the owner's own Tasks can be canceled or completed; comment instead",
      );
    const changeStatus =
      input.status === "READY" &&
      task.status !== TaskStatus.READY &&
      task.status !== TaskStatus.RUNNING;
    const nextStatus = changeStatus ? TaskStatus.READY : close;
    if (changeStatus) {
      if (!resumable.includes(task.status)) {
        throw new SokoBotRuntimeValidationError(
          `Task is ${task.status}; only ${resumable.join(", ")} can be set READY. To leave a comment without changing the status, omit \`status\`.`,
        );
      }
      if (!task.assigneeId && !task.assigneeSokoBotId && !task.assigneeUserId) {
        throw new SokoBotRuntimeValidationError(
          "Task has no assignee; use assign_task instead",
        );
      }
    }
    const previous = options?.publicationId
      ? await tx.taskEvent.findFirst({
          where: {
            id: options.publicationId,
            taskId: task.id,
            sokoBotId: authorized.turn.sokoBotId,
          },
          select: { id: true },
        })
      : null;
    const event =
      previous ??
      (await tx.taskEvent.create({
        data: {
          ...(options?.publicationId ? { id: options.publicationId } : {}),
          taskId: task.id,
          status: nextStatus,
          comment: input.comment,
          channel: Channel.SOKOSUMI,
          sokoBotId: authorized.turn.sokoBotId,
        },
        select: { id: true },
      }));
    if (nextStatus) {
      await applyGuardedTaskStatusUpdate({
        tx,
        taskId: task.id,
        expectedStatus: task.status,
        eventStatus: nextStatus,
      });
    }
    const status = nextStatus ?? task.status;
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
    const result = {
      id: task.id,
      name: task.name,
      status,
      commented: true,
      eventId: event.id,
      statusChanged: nextStatus !== null,
    };
    const receipt = await commitActionReceipt(tx, {
      turnId: authorized.turn.id,
      toolCallId,
      actorBotId: authorized.turn.sokoBotId,
      targetId: task.id,
      effectEventId: event.id,
      result: persistedToolResult(result),
    });
    if (claim.claimId)
      await tx.sokoBotTaskActionClaim.update({
        where: { id: claim.claimId },
        data: { receiptId: receipt.id },
      });
    return {
      result,
      eventId: event.id,
      ownerId: task.ownerId,
      eventStatus: nextStatus,
    };
  };
  const persisted = options?.transaction
    ? await persist(options.transaction)
    : await serializableTransaction(
        persist,
        "Soko Bot task reply collided with another action",
      );
  return persisted.result;
}

export async function linkTasks(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  rawInput: unknown,
  toolCallId: string,
) {
  const input = linkTasksInputSchema.parse(rawInput);
  if (input.taskId === input.peerTaskId) {
    throw new SokoBotRuntimeValidationError("A task cannot link to itself");
  }
  return serializableTransaction(async (tx) => {
    await runtime.requireMutationAuthority(tx, authorized, false, "link_tasks");
    const tasks = await tx.task.findMany({
      where: {
        id: { in: [input.taskId, input.peerTaskId] },
        workspaceId: authorized.turn.workspaceId,
        archivedAt: null,
        ...buildSokoBotReaderTaskWhere(authorized.reader),
      },
      select: { id: true, name: true },
    });
    if (tasks.length !== 2) {
      throw new SokoBotRuntimeValidationError("One of the tasks was not found");
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
      const result = {
        linked: true,
        existing: true,
        relation: existing.type,
        id: existing.id,
      };
      if (existing.type !== data.type)
        throw new SokoBotRuntimeValidationError(
          "A different relationship already exists",
        );
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: existing.id,
        disposition: "ALREADY_SATISFIED",
        result: persistedToolResult(result),
      });
      return result;
    }
    const link = await tx.taskLink.create({
      data: { ...data, note: input.note ?? null },
      select: { id: true, type: true },
    });
    const result = {
      linked: true,
      existing: false,
      relation: link.type,
      id: link.id,
    };
    await commitActionReceipt(tx, {
      turnId: authorized.turn.id,
      toolCallId,
      actorBotId: authorized.turn.sokoBotId,
      targetId: link.id,
      result: persistedToolResult(result),
    });
    return result;
  }, "Soko Bot task link collided with another action");
}

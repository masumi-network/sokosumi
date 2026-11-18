import { sokoBotSetTaskParentInputSchema as setTaskParentInputSchema } from "@sokosumi/soko-bot";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { moveTask } from "@/helpers/task-subtask-move";
import { buildSokoBotReaderTaskWhere } from "@/helpers/task-visibility";
import { serializableTransaction } from "@/lib/db/transaction";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { claimTaskEventAction } from "@/services/soko-bot-event-action.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

/**
 * Attaches a Task under a parent, moves it to another parent, or detaches it.
 * It runs the move route's `moveTask`, so the same locks and tree rules apply.
 */
export async function setTaskParent(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  rawInput: unknown,
  toolCallId: string,
) {
  const input = setTaskParentInputSchema.parse(rawInput);
  // moveTask checks write access as a person. A shared bot acting for
  // nobody has none to check.
  const userId = authorized.turn.actingUserId;
  if (userId === null)
    throw new SokoBotRefusedUnsentError(
      "Changing a Task's parent needs a person on this turn; suggest it in your chat instead",
    );
  if (input.afterTaskId && input.parentTaskId === null)
    throw new SokoBotRuntimeValidationError("afterTaskId needs parentTaskId");
  const taskIds = [
    ...new Set([
      input.taskId,
      ...(input.parentTaskId ? [input.parentTaskId] : []),
    ]),
  ];
  const { result, projectChanged, workspaceId } = await serializableTransaction(
    async (tx) => {
      await runtime.requireMutationAuthority(
        tx,
        authorized,
        false,
        "set_task_parent",
        { taskIds },
      );
      // The turn must read both Tasks, as create_task requires of a parent.
      const visible = await tx.task.count({
        where: {
          id: { in: taskIds },
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
          ...buildSokoBotReaderTaskWhere(authorized.reader),
        },
      });
      if (visible !== taskIds.length)
        throw new SokoBotRuntimeValidationError("Task not found");
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
      const moved = await moveTask(
        tx,
        { source: "context", userId, organizationId: null },
        {
          taskId: input.taskId,
          parentTaskId: input.parentTaskId,
          afterTaskId: input.afterTaskId,
        },
      );
      const result = {
        id: moved.task.id,
        name: moved.task.name,
        parentTaskId: moved.task.parentTaskId,
        projectId: moved.task.projectId,
        projectChanged: moved.projectChanged,
      };
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: moved.task.id,
        claimId: claim.claimId,
        observedVersion: moved.task.updatedAt?.toISOString(),
        result: persistedToolResult(result),
      });
      return {
        result,
        projectChanged: moved.projectChanged,
        workspaceId: moved.task.workspaceId,
      };
    },
    "Soko Bot sub-task move collided with another action",
  );
  // As the move route does: a Project change moves calendar entries.
  if (projectChanged) await deliverCalendarInvalidationsNow(workspaceId);
  return result;
}

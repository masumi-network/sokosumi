import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { formatTaskIdentifier } from "@sokosumi/utils";
import { buildSokoBotReaderTaskWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { ownerDirectReader } from "./acting-scope";
import { type RuntimeOperations } from "./operations";
import { calendarDay } from "./task-reads";

const FOLLOWED_TASKS_LIMIT = 50;

/**
 * Following is the owner's own setting, like their Directs: only a personal
 * bot on its owner's turns reads or changes it.
 */
function followerOf(authorized: AuthorizedSokoBotRuntime): string {
  const userId = authorized.turn.actingUserId;
  if (!ownerDirectReader(authorized) || userId === null)
    throw new SokoBotRefusedUnsentError(
      "Followed Tasks belong to your owner; only they can see or change them, in their own chat with you.",
    );
  return userId;
}

export async function dispatchTaskInterestTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_followed_tasks": {
      const userId = followerOf(authorized);
      const rows = await prisma.taskFollower.findMany({
        where: {
          userId,
          task: {
            workspaceId: authorized.turn.workspaceId,
            archivedAt: null,
            ...buildSokoBotReaderTaskWhere(authorized.reader),
          },
        },
        orderBy: { createdAt: "desc" },
        take: FOLLOWED_TASKS_LIMIT,
        select: {
          task: {
            select: {
              id: true,
              name: true,
              status: true,
              dueOn: true,
              number: true,
              project: { select: { identifier: true } },
            },
          },
        },
      });
      return {
        tasks: rows.map(({ task }) => ({
          id: task.id,
          identifier: formatTaskIdentifier(
            task.project?.identifier,
            task.number,
          ),
          name: task.name,
          status: task.status,
          dueOn: calendarDay(task.dueOn),
        })),
      };
    }

    case "stop_following_task": {
      const userId = followerOf(authorized);
      const { taskId } = SOKO_BOT_TOOL_INPUT_SCHEMAS.stop_following_task.parse(
        input.input,
      );
      return serializableTransaction(async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          "stop_following_task",
        );
        const task = await tx.task.findFirst({
          where: {
            id: taskId,
            workspaceId: authorized.turn.workspaceId,
            ...buildSokoBotReaderTaskWhere(authorized.reader),
          },
          select: { id: true },
        });
        if (!task)
          throw new SokoBotRuntimeValidationError("The task was not found");
        const { count } = await tx.taskFollower.deleteMany({
          where: { taskId, userId },
        });
        const result = { taskId, following: false };
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: taskId,
          disposition: count > 0 ? "APPLIED" : "ALREADY_SATISFIED",
          result: persistedToolResult(result),
        });
        return result;
      }, "Soko Bot stop following collided with another action");
    }

    default:
      throw new SokoBotRuntimeValidationError(
        `Unsupported Soko Bot capability: ${input.capability}`,
      );
  }
}

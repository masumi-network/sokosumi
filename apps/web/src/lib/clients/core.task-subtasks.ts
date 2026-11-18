import {
  postTasksByIdMove as corePostTasksByIdMove,
  type MoveTaskRequest,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** Reordering a sub-task, and attaching, re-parenting or detaching a Task. */
export function createTaskSubtasksClient(getClient: GetCoreClient) {
  return {
    moveSubtask(id: string, body: MoveTaskRequest) {
      return executeCoreOperation(
        getClient,
        (client) =>
          corePostTasksByIdMove({
            client,
            path: { id },
            body,
          }),
        "Failed to move sub-task",
      );
    },
  };
}

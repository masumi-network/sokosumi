import { postTasksByIdMove as corePostTasksByIdMove } from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** Reordering a sub-task among its siblings. */
export function createTaskSubtasksClient(getClient: GetCoreClient) {
  return {
    moveSubtask(id: string, afterTaskId: string | null) {
      return executeCoreOperation(
        getClient,
        (client) =>
          corePostTasksByIdMove({
            client,
            path: { id },
            body: { afterTaskId },
          }),
        "Failed to move sub-task",
      );
    },
  };
}

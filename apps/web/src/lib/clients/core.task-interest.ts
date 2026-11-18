import {
  deleteTasksByIdFollow as coreDeleteTasksByIdFollow,
  postTasksByIdFollow as corePostTasksByIdFollow,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** Following a Task with your Soko Bot; separate from taking part. */
export function createTaskInterestClient(getClient: GetCoreClient) {
  return {
    followTask(id: string) {
      return executeCoreOperation(
        getClient,
        (client) => corePostTasksByIdFollow({ client, path: { id } }),
        "Failed to follow task",
      );
    },
    unfollowTask(id: string) {
      return executeCoreOperation(
        getClient,
        (client) => coreDeleteTasksByIdFollow({ client, path: { id } }),
        "Failed to stop following task",
      );
    },
  };
}

import { deleteTasksByIdSubscription as coreDeleteTasksByIdSubscription } from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** Following a Task with your Soko Bot; subscribing is `subscribeTaskParticipant`. */
export function createTaskInterestClient(getClient: GetCoreClient) {
  return {
    unsubscribeTask(id: string) {
      return executeCoreOperation(
        getClient,
        (client) => coreDeleteTasksByIdSubscription({ client, path: { id } }),
        "Failed to stop following task",
      );
    },
  };
}

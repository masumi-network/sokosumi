import {
  getTasksView as coreGetTasksView,
  putTasksView as corePutTasksView,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** The Tasks page view a person last chose in the active workspace. */
export function createTaskViewClient(getClient: GetCoreClient) {
  return {
    getTasksView() {
      return executeCoreOperation(
        getClient,
        (client) => coreGetTasksView({ client }),
        "Failed to load the saved Tasks view",
      );
    },
    putTasksView(query: string) {
      return executeCoreOperation(
        getClient,
        (client) => corePutTasksView({ client, body: { query } }),
        "Failed to save the Tasks view",
      );
    },
  };
}

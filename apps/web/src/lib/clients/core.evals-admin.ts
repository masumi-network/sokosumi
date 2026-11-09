import type { CreateEvalRunBody } from "@sokosumi/core-client";
import {
  cancelAdminEvalRun as coreCancelAdminEvalRun,
  createAdminEvalRun as coreCreateAdminEvalRun,
  getAdminEvalCaseBaseline as coreGetAdminEvalCaseBaseline,
  getAdminEvalRun as coreGetAdminEvalRun,
  listAdminEvalCases as coreListAdminEvalCases,
  listAdminEvalRuns as coreListAdminEvalRuns,
  tickAdminEvalRuns as coreTickAdminEvalRuns,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** Operator wrappers for eval runs: the daily run on main and runs started by hand. */
export function createEvalsAdminClient(getClient: GetCoreClient) {
  return {
    listAdminEvalRuns(query?: { limit?: number }) {
      return executeCoreOperation(
        getClient,
        (client) => coreListAdminEvalRuns({ client, query, cache: "no-store" }),
        "Failed to fetch eval runs",
      );
    },
    getAdminEvalRun(id: string) {
      return executeCoreOperation(
        getClient,
        (client) =>
          coreGetAdminEvalRun({ client, path: { id }, cache: "no-store" }),
        "Failed to fetch eval run",
      );
    },
    getAdminEvalCaseBaseline(id: string, caseId: string) {
      return executeCoreOperation(
        getClient,
        (client) =>
          coreGetAdminEvalCaseBaseline({
            client,
            path: { id, caseId },
            cache: "no-store",
          }),
        "Failed to fetch eval baseline",
      );
    },
    listAdminEvalCases() {
      return executeCoreOperation(
        getClient,
        (client) => coreListAdminEvalCases({ client, cache: "no-store" }),
        "Failed to fetch eval cases",
      );
    },
    createAdminEvalRun(body: CreateEvalRunBody) {
      return executeCoreOperation(
        getClient,
        (client) => coreCreateAdminEvalRun({ client, body }),
        "Failed to start eval run",
      );
    },
    cancelAdminEvalRun(id: string) {
      return executeCoreOperation(
        getClient,
        (client) => coreCancelAdminEvalRun({ client, path: { id } }),
        "Failed to cancel eval run",
      );
    },
    tickAdminEvalRuns() {
      return executeCoreOperation(
        getClient,
        (client) => coreTickAdminEvalRuns({ client }),
        "Failed to advance eval run",
      );
    },
  };
}

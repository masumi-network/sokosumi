import "server-only";

import { type Orchestrator } from "@sokosumi/database";

import { type CoreApiResponse, coreClient } from "@/lib/clients/core.client";

export const orchestratorService = (() => {
  async function listOrchestrators(): Promise<Orchestrator[]> {
    const json: CoreApiResponse<Orchestrator[]> = await coreClient.request(
      "/v1/orchestrators",
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return json.data ?? [];
  }

  return {
    listOrchestrators,
  };
})();

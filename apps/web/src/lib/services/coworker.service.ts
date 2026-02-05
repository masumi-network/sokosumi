import "server-only";

import { type Coworker } from "@sokosumi/database";

import { type CoreApiResponse, coreClient } from "@/lib/clients/core.client";

export const coworkerService = (() => {
  async function listCoworkers(): Promise<Coworker[]> {
    const json: CoreApiResponse<Coworker[]> = await coreClient.request(
      "/v1/coworkers",
      {
        method: "GET",
        cache: "no-store",
      },
    );

    return json.data ?? [];
  }

  return {
    listCoworkers,
  };
})();

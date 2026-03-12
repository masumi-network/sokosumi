import "server-only";

import { type Coworker } from "@sokosumi/database";

import { coreClient } from "@/lib/clients/core.client";

export const coworkerService = (() => {
  async function listCoworkers(): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({
      scope: "whitelisted",
    });
    return (response.data ?? []) as unknown as Coworker[];
  }

  return {
    listCoworkers,
  };
})();

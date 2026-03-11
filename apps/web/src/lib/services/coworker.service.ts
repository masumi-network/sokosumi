import "server-only";

import { type Coworker } from "@sokosumi/database";

import { coreClient } from "@/lib/clients/core.client";

export const coworkerService = (() => {
  async function listCoworkers(options?: {
    capability?: "chat" | "tasks";
  }): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({
      scope: "whitelisted",
      ...(options?.capability && { capability: options.capability }),
    });
    return (response.data ?? []) as unknown as Coworker[];
  }

  return {
    listCoworkers,
  };
})();

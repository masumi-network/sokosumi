import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { Coworker, GetCoworkersData } from "@/lib/clients/generated/core";

export type CoworkerCapability = NonNullable<
  NonNullable<GetCoworkersData["query"]>["capability"]
>[number];

export const coworkerService = (() => {
  async function listCoworkers(
    capability?: CoworkerCapability,
  ): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({
      scope: "whitelisted",
      ...(capability && {
        capability: [capability],
      }),
    });
    return response.data ?? [];
  }

  return {
    listCoworkers,
  };
})();

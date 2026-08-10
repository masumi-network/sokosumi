import "server-only";

import {
  type CoworkerCapability,
  coworkerCanChat,
} from "@/app/chat/utils/coworker-utils";
import { coreClient } from "@/lib/clients/core.client";
import type { Coworker } from "@/lib/clients/generated/core";

export const coworkerService = (() => {
  async function listCoworkers(
    capability?: CoworkerCapability,
  ): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({
      // Product pickers: whitelist ∪ GRANTED for active workspace.
      // Admin/developer owned|all scopes use other services.
      scope: "available",
      ...(capability && {
        capability: [capability],
      }),
    });
    const coworkers = response.data ?? [];

    if (capability === "chat") {
      return coworkers.filter(coworkerCanChat);
    }

    return coworkers;
  }

  return {
    listCoworkers,
  };
})();

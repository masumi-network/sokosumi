import "server-only";

import type { Coworker } from "@sokosumi/core-client";
import {
  type CoworkerCapability,
  coworkerCanChat,
} from "@/app/chat/utils/coworker-utils";
import { coreClient } from "@/lib/clients/core.client";

export const coworkerService = (() => {
  async function listCoworkers(
    capability?: CoworkerCapability,
  ): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({
      // Product pickers: whitelist ∪ GRANTED for active workspace, then
      // chat-capable + runnable endpoint (`coworkerCanChat`).
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

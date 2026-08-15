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
    options?: { scope?: "all" | "available" },
  ): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({
      // Product pickers default: whitelist ∪ GRANTED for active workspace.
      // Landing catalog uses scope=all so the slider is the full chat roster.
      scope: options?.scope ?? "available",
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

import "server-only";

import type { CoworkerCapability } from "@/app/chat/utils/coworker-utils";
import { coreClient } from "@/lib/clients/core.client";
import type { Coworker } from "@/lib/clients/generated/core";
import { filterCoworkersForUiListing } from "@/lib/coworkers/ui-restricted-slugs";

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
    return filterCoworkersForUiListing(response.data ?? []);
  }

  /**
   * Coworker metadata is supplementary for page shells. When Core is briefly
   * unavailable, degrade to an empty list instead of failing the render
   * (SOKOSUMI-Q3 on `/tasks` and `/tasks/[taskId]`).
   */
  async function listCoworkersForUi(
    capability?: CoworkerCapability,
  ): Promise<Coworker[]> {
    try {
      return await listCoworkers(capability);
    } catch {
      return [];
    }
  }

  return {
    listCoworkers,
    listCoworkersForUi,
  };
})();

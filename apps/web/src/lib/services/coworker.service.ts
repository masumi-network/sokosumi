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

  return {
    listCoworkers,
  };
})();

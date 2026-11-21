import "server-only";

import {
  getOrganizationStandup,
  type UpdateTeamStandup,
  updateOrganizationStandup,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export const teamStandupService = {
  async get(organizationId: string) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        getOrganizationStandup({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to load the stand-up settings",
    );
    return response.data;
  },

  async update(organizationId: string, body: UpdateTeamStandup) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        updateOrganizationStandup({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to save the stand-up settings",
    );
    return response.data;
  },
};

import "server-only";

import {
  getWorkspaceAdDataConsent,
  putWorkspaceAdDataConsent,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export const adDataConsentService = {
  async get(workspaceId: string) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        getWorkspaceAdDataConsent({
          client,
          path: { id: workspaceId },
          cache: "no-store",
        }),
      "Failed to load ad data consent",
    );
    return response.data;
  },

  async save(
    workspaceId: string,
    shareForImprovement: boolean,
    allowTraining: boolean,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        putWorkspaceAdDataConsent({
          client,
          path: { id: workspaceId },
          body: { shareForImprovement, allowTraining },
        }),
      "Failed to save ad data consent",
    );
    return response.data;
  },
};

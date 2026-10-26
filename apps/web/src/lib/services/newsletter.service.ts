import "server-only";

import type { Newsletter, PutNewsletterRequest } from "@sokosumi/core-client";
import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const newsletterService = {
  isEnabled: cache(async (): Promise<boolean> => {
    const response = await coreClient.getNewsletterAvailability();
    return response.data.enabled;
  }),

  async getSettings(projectId: string): Promise<Newsletter | null> {
    try {
      const response = await coreClient.getProjectsByIdNewsletter(projectId);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  async saveSettings(
    projectId: string,
    input: PutNewsletterRequest,
  ): Promise<Newsletter> {
    const response = await coreClient.putProjectsByIdNewsletter(
      projectId,
      input,
    );
    return response.data;
  },
};

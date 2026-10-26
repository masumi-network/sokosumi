import "server-only";

import type {
  AddNewsletterSubscriberRequest,
  GetProjectsByIdNewsletterSubscribersData,
  ImportNewsletterSubscribersRequest,
  Newsletter,
  PatchNewsletterSubscriberRequest,
  PutNewsletterRequest,
} from "@sokosumi/core-client";
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

  async listSubscribers(
    projectId: string,
    query: GetProjectsByIdNewsletterSubscribersData["query"],
  ) {
    return coreClient.getProjectsByIdNewsletterSubscribers(projectId, query);
  },

  async addSubscriber(
    projectId: string,
    input: AddNewsletterSubscriberRequest,
  ) {
    const response = await coreClient.postProjectsByIdNewsletterSubscribers(
      projectId,
      input,
    );
    return response.data;
  },

  async importSubscribers(
    projectId: string,
    input: ImportNewsletterSubscribersRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterSubscribersImport(
        projectId,
        input,
      );
    return response.data;
  },

  async updateSubscriber(
    projectId: string,
    subscriberId: string,
    input: PatchNewsletterSubscriberRequest,
  ) {
    const response =
      await coreClient.patchProjectsByIdNewsletterSubscribersBySubscriberId(
        projectId,
        subscriberId,
        input,
      );
    return response.data;
  },

  async removeSubscriber(projectId: string, subscriberId: string) {
    await coreClient.deleteProjectsByIdNewsletterSubscribersBySubscriberId(
      projectId,
      subscriberId,
    );
  },
};

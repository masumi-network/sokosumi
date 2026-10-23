import "server-only";

import type {
  AddNewsletterSubscriberRequest,
  CreateNewsletterIssueRequest,
  GetProjectsByIdNewsletterIssuesData,
  GetProjectsByIdNewsletterSubscribersData,
  ImportNewsletterSubscribersRequest,
  Newsletter,
  NewsletterIssue,
  NewsletterIssueRevisionRequest,
  PatchNewsletterIssueRequest,
  PatchNewsletterSubscriberRequest,
  PutNewsletterRequest,
  ScheduleNewsletterIssueRequest,
} from "@sokosumi/core-client";
import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const newsletterService = {
  async listIssues(
    projectId: string,
    query: GetProjectsByIdNewsletterIssuesData["query"],
  ) {
    return coreClient.getProjectsByIdNewsletterIssues(projectId, query);
  },

  async getIssue(
    projectId: string,
    issueId: string,
  ): Promise<NewsletterIssue | null> {
    try {
      const response =
        await coreClient.getProjectsByIdNewsletterIssuesByIssueId(
          projectId,
          issueId,
        );
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404)
        return null;
      throw error;
    }
  },

  async createIssue(projectId: string, input: CreateNewsletterIssueRequest) {
    const response = await coreClient.postProjectsByIdNewsletterIssues(
      projectId,
      input,
    );
    return response.data;
  },

  async saveIssue(
    projectId: string,
    issueId: string,
    input: PatchNewsletterIssueRequest,
  ) {
    const response =
      await coreClient.patchProjectsByIdNewsletterIssuesByIssueId(
        projectId,
        issueId,
        input,
      );
    return response.data;
  },

  async deleteIssue(projectId: string, issueId: string) {
    await coreClient.deleteProjectsByIdNewsletterIssuesByIssueId(
      projectId,
      issueId,
    );
  },

  async submitIssue(
    projectId: string,
    issueId: string,
    input: NewsletterIssueRevisionRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterIssuesByIssueIdSubmit(
        projectId,
        issueId,
        input,
      );
    return response.data;
  },

  async approveIssue(
    projectId: string,
    issueId: string,
    input: NewsletterIssueRevisionRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterIssuesByIssueIdApprove(
        projectId,
        issueId,
        input,
      );
    return response.data;
  },

  async scheduleIssue(
    projectId: string,
    issueId: string,
    input: ScheduleNewsletterIssueRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterIssuesByIssueIdSchedule(
        projectId,
        issueId,
        input,
      );
    return response.data;
  },

  async sendIssueNow(
    projectId: string,
    issueId: string,
    input: NewsletterIssueRevisionRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterIssuesByIssueIdSendNow(
        projectId,
        issueId,
        input,
      );
    return response.data;
  },

  async cancelIssue(
    projectId: string,
    issueId: string,
    input: NewsletterIssueRevisionRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterIssuesByIssueIdCancel(
        projectId,
        issueId,
        input,
      );
    return response.data;
  },

  async previewIssue(projectId: string, input: CreateNewsletterIssueRequest) {
    const response = await coreClient.postProjectsByIdNewsletterIssuesPreview(
      projectId,
      input,
    );
    return response.data;
  },

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

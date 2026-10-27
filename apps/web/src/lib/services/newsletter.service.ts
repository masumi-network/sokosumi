import "server-only";

import type {
  AddNewsletterSubscriberRequest,
  AddNewsletterSubscribersFromContactsRequest,
  CreateNewsletterIssueRequest,
  DraftNewsletterIssueRequest,
  GetProjectsByIdNewsletterAnalyticsData,
  GetProjectsByIdNewsletterIssuesData,
  GetProjectsByIdNewsletterSubscribersData,
  GetPublicNewslettersByPublicSlugIssuesData,
  ImportNewsletterSubscribersRequest,
  Newsletter,
  NewsletterIssue,
  NewsletterIssueRevisionRequest,
  PatchNewsletterIssueRequest,
  PatchNewsletterSubscriberRequest,
  PutNewsletterRequest,
  ScheduleNewsletterIssueRequest,
  SubscribeNewsletterRequest,
} from "@sokosumi/core-client";
import { DEFAULT_LOCALE, parseLocalePreference } from "@sokosumi/utils";
import { headers } from "next/headers";
import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const newsletterService = {
  async draftIssue(projectId: string, input: DraftNewsletterIssueRequest) {
    const response =
      await coreClient.postProjectsByIdNewsletterIssuesDraftWithAi(
        projectId,
        input,
      );
    return response.data;
  },
  async getAnalytics(
    projectId: string,
    query: GetProjectsByIdNewsletterAnalyticsData["query"],
  ) {
    const response = await coreClient.getProjectsByIdNewsletterAnalytics(
      projectId,
      query,
    );
    return response.data;
  },

  async getIssueAnalytics(projectId: string, issueId: string) {
    const response =
      await coreClient.getProjectsByIdNewsletterIssuesByIssueIdAnalytics(
        projectId,
        issueId,
      );
    return response.data;
  },

  async subscribe(publicSlug: string, input: SubscribeNewsletterRequest) {
    const requestHeaders = await headers();
    const ip =
      requestHeaders.get("x-vercel-forwarded-for") ??
      requestHeaders.get("x-forwarded-for");
    // Preserve Core's per-visitor signup limit across the server-action hop.
    return coreClient.postPublicNewslettersByPublicSlugSubscribe(
      publicSlug,
      input,
      ip ? { "x-vercel-forwarded-for": ip, "x-forwarded-for": ip } : {},
    );
  },

  getPublicNewsletter: cache(async (publicSlug: string) => {
    try {
      const response =
        await coreClient.getPublicNewslettersByPublicSlug(publicSlug);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404)
        return null;
      throw error;
    }
  }),

  async listPublicIssues(
    publicSlug: string,
    query: GetPublicNewslettersByPublicSlugIssuesData["query"],
  ) {
    try {
      return await coreClient.getPublicNewslettersByPublicSlugIssues(
        publicSlug,
        query,
      );
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404)
        return null;
      throw error;
    }
  },

  getPublicIssue: cache(
    async (publicSlug: string, issueSlug: string, locale: string) => {
      try {
        const response =
          await coreClient.getPublicNewslettersByPublicSlugIssuesByIssueSlug(
            publicSlug,
            issueSlug,
            parseLocalePreference(locale) ?? DEFAULT_LOCALE,
          );
        return response.data;
      } catch (error) {
        if (error instanceof CoreApiRequestError && error.status === 404)
          return null;
        throw error;
      }
    },
  ),

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

  async addSubscribersFromContacts(
    projectId: string,
    input: AddNewsletterSubscribersFromContactsRequest,
  ) {
    const response =
      await coreClient.postProjectsByIdNewsletterSubscribersFromContacts(
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

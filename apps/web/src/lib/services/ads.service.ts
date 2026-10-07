import "server-only";

import type {
  AdRange,
  CreateAdCampaignRequest,
  CreateAdCampaignResponse,
  FinalizeProjectAdConnectionResponse,
  GetAdMarketProfileResponse,
  InitiateProjectSocialConnectionResponse,
  ListAdCampaignsResponse,
  ListAdMarketAdsResponse,
  ListAdMarketKeywordsResponse,
  ProjectAdAccount,
  ProjectAdProvider,
  PutAdMarketProfileRequest,
  PutAdMarketProfileResponse,
  UpdateAdCampaignRequest,
} from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

/** Every Core ads call, so the Ads tabs share one place to read and write. */
export const adsService = (() => {
  async function listAccounts(projectId: string): Promise<ProjectAdAccount[]> {
    const result = await coreClient.getProjectsByIdAdsAccounts(projectId);
    return result.data;
  }

  async function initiateConnection(
    projectId: string,
    provider: ProjectAdProvider,
  ): Promise<InitiateProjectSocialConnectionResponse> {
    const result = await coreClient.postProjectsByIdAdsConnectionsInitiate(
      projectId,
      { provider },
    );
    return result.data;
  }

  async function finalizeConnection(
    projectId: string,
    connectionId: string,
  ): Promise<FinalizeProjectAdConnectionResponse> {
    const result = await coreClient.postProjectsByIdAdsConnectionsFinalize(
      projectId,
      { connectionId },
    );
    return result.data;
  }

  async function attachAccounts(
    projectId: string,
    adConnectionId: string,
    externalAccountIds: string[],
  ): Promise<ProjectAdAccount[]> {
    const result = await coreClient.postProjectsByIdAdsAccounts(projectId, {
      adConnectionId,
      externalAccountIds,
    });
    return result.data;
  }

  async function disconnectAccount(
    projectId: string,
    accountId: string,
  ): Promise<void> {
    await coreClient.deleteProjectsByIdAdsAccountsByAccountId({
      id: projectId,
      accountId,
    });
  }

  /** Drops a connection nothing was attached to; Core refuses one in use. */
  async function discardConnection(
    projectId: string,
    adConnectionId: string,
  ): Promise<void> {
    await coreClient.deleteProjectsByIdAdsConnectionsByAdConnectionId({
      id: projectId,
      adConnectionId,
    });
  }

  async function listCampaigns(
    projectId: string,
    accountId: string,
    range: AdRange,
  ): Promise<ListAdCampaignsResponse> {
    const result =
      await coreClient.getProjectsByIdAdsAccountsByAccountIdCampaigns(
        { id: projectId, accountId },
        { range },
      );
    return result.data;
  }

  async function updateCampaign(
    projectId: string,
    accountId: string,
    campaignId: string,
    changes: UpdateAdCampaignRequest,
  ): Promise<void> {
    await coreClient.patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId(
      { id: projectId, accountId, campaignId },
      changes,
    );
  }

  async function createCampaign(
    projectId: string,
    accountId: string,
    campaign: CreateAdCampaignRequest,
  ): Promise<CreateAdCampaignResponse> {
    const result =
      await coreClient.postProjectsByIdAdsAccountsByAccountIdCampaigns(
        { id: projectId, accountId },
        campaign,
      );
    return result.data;
  }

  async function getMarketProfile(
    projectId: string,
  ): Promise<GetAdMarketProfileResponse> {
    const result = await coreClient.getProjectsByIdAdsMarket(projectId);
    return result.data;
  }

  async function saveMarketProfile(
    projectId: string,
    profile: PutAdMarketProfileRequest,
  ): Promise<PutAdMarketProfileResponse> {
    const result = await coreClient.putProjectsByIdAdsMarket(
      projectId,
      profile,
    );
    return result.data;
  }

  async function listMarketKeywords(
    projectId: string,
  ): Promise<ListAdMarketKeywordsResponse> {
    const result = await coreClient.getProjectsByIdAdsMarketKeywords(projectId);
    return result.data;
  }

  async function listMarketAds(
    projectId: string,
  ): Promise<ListAdMarketAdsResponse> {
    const result = await coreClient.getProjectsByIdAdsMarketAds(projectId);
    return result.data;
  }

  return {
    listAccounts,
    initiateConnection,
    finalizeConnection,
    attachAccounts,
    disconnectAccount,
    discardConnection,
    listCampaigns,
    updateCampaign,
    createCampaign,
    getMarketProfile,
    saveMarketProfile,
    listMarketKeywords,
    listMarketAds,
  };
})();

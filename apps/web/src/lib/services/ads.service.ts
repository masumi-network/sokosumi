import "server-only";

import type {
  FinalizeProjectAdConnectionResponse,
  InitiateProjectSocialConnectionResponse,
  ProjectAdAccount,
  ProjectAdProvider,
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

  return {
    listAccounts,
    initiateConnection,
    finalizeConnection,
    attachAccounts,
    disconnectAccount,
    discardConnection,
  };
})();

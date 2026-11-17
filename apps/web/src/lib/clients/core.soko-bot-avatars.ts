import {
  claimMySokoBotAvatar as coreClaimMySokoBotAvatar,
  listSokoBotAvatars as coreListSokoBotAvatars,
  setMySokoBotAvatarCode as coreSetMySokoBotAvatarCode,
  setSokoBotAvatarCode as coreSetSokoBotAvatarCode,
  topUpSokoBotAvatars as coreTopUpSokoBotAvatars,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

export function createSokoBotAvatarClient(getClient: GetCoreClient) {
  async function listSokoBotAvatars(query?: {
    take?: number;
    exclude?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreListSokoBotAvatars({ client, query, cache: "no-store" }),
      "Failed to fetch Soko Bot avatars",
    );
  }

  async function topUpSokoBotAvatars(body: {
    take?: number;
    excludeIds?: string[];
    fresh?: boolean;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreTopUpSokoBotAvatars({ client, body }),
      "Failed to top up Soko Bot avatars",
    );
  }

  async function claimMySokoBotAvatar(body: { avatarId: string }) {
    return executeCoreOperation(
      getClient,
      (client) => coreClaimMySokoBotAvatar({ client, body }),
      "Failed to update Soko Bot avatar",
    );
  }

  /** Your own bot, or a shared one by id. */
  async function setSokoBotAvatarCode(code: string, sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreSetSokoBotAvatarCode({
              client,
              path: { sokoBotId },
              body: { code },
            })
          : coreSetMySokoBotAvatarCode({ client, body: { code } }),
      "Failed to update Soko Bot avatar look",
    );
  }

  return {
    listSokoBotAvatars,
    topUpSokoBotAvatars,
    claimMySokoBotAvatar,
    setSokoBotAvatarCode,
  };
}

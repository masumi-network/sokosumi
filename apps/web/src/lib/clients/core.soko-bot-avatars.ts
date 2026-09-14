import {
  claimMySokoBotAvatar as coreClaimMySokoBotAvatar,
  listSokoBotAvatars as coreListSokoBotAvatars,
  topUpSokoBotAvatars as coreTopUpSokoBotAvatars,
} from "@/lib/clients/generated/core";
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
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreTopUpSokoBotAvatars({ client, body }),
      "Failed to fetch Soko Bot avatars",
    );
  }

  async function claimMySokoBotAvatar(body: { avatarId: string }) {
    return executeCoreOperation(
      getClient,
      (client) => coreClaimMySokoBotAvatar({ client, body }),
      "Failed to update Soko Bot avatar",
    );
  }

  return { listSokoBotAvatars, topUpSokoBotAvatars, claimMySokoBotAvatar };
}

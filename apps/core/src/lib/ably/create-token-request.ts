import { Rest, type TokenRequest } from "ably";

import { getEnv } from "@/config/env";

import { buildAblySubscribeCapability } from "./subscribe-capability";

let subscribeRestClient: Rest | null = null;

function getSubscribeRestClient(): Rest {
  if (!subscribeRestClient) {
    subscribeRestClient = new Rest({
      key: getEnv().ABLY_SUBSCRIBE_ONLY_KEY,
    });
  }
  return subscribeRestClient;
}

/**
 * Mint a subscribe-only Ably TokenRequest for the user and their room memberships.
 */
export async function createAblySubscribeTokenRequest(
  userId: string,
  roomIds: readonly string[],
): Promise<TokenRequest> {
  const client = getSubscribeRestClient();
  const capability = buildAblySubscribeCapability(userId, roomIds);
  return client.auth.createTokenRequest({
    clientId: userId,
    capability,
  });
}

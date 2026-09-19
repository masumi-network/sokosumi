import {
  buildAblyPresenceClientId,
  isValidAblyClientInstanceId,
} from "@sokosumi/utils";
import { Rest, type TokenRequest } from "ably";

import { getEnv } from "@/config/env";

import { getNotificationChannelEnvironment } from "./notification-channel-environment";
import { buildAblyClientCapability } from "./subscribe-capability";

/**
 * Capabilities are a snapshot of membership at mint time and nothing revokes
 * them (SOK-1023). A short ttl bounds how long a removed member keeps access.
 */
export const ABLY_CLIENT_TOKEN_TTL_MS = 5 * 60 * 1000;

let subscribeRestClient: Rest | null = null;

function getSubscribeRestClient(): Rest {
  if (!subscribeRestClient) {
    subscribeRestClient = new Rest({
      key: getEnv().ABLY_SUBSCRIBE_ONLY_KEY,
    });
  }
  return subscribeRestClient;
}

export interface CreateAblyClientTokenRequestInput {
  userId: string;
  roomIds: readonly string[];
  organizationIds: readonly string[];
  /** Opaque tab/device instance id; becomes clientId suffix for multi-device. */
  clientInstanceId: string;
}

export async function createAblyClientTokenRequest({
  userId,
  roomIds,
  organizationIds,
  clientInstanceId,
}: CreateAblyClientTokenRequestInput): Promise<TokenRequest> {
  if (!isValidAblyClientInstanceId(clientInstanceId)) {
    throw new Error("Invalid Ably client instance id");
  }

  const client = getSubscribeRestClient();
  const capability = buildAblyClientCapability({
    userId,
    roomIds,
    organizationIds,
    notificationChannelEnvironment: getNotificationChannelEnvironment(),
  });

  return client.auth.createTokenRequest({
    clientId: buildAblyPresenceClientId(userId, clientInstanceId),
    capability,
    ttl: ABLY_CLIENT_TOKEN_TTL_MS,
  }) as Promise<TokenRequest>;
}

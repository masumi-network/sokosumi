import {
  buildAblyPresenceClientId,
  isValidAblyClientInstanceId,
} from "@sokosumi/utils";
import type { TokenRequest } from "ably";

import { getSubscribeRestClient } from "./client";
import { getNotificationChannelEnvironment } from "./notification-channel-environment";
import { buildAblyClientCapability } from "./subscribe-capability";

/**
 * Capabilities are a snapshot of membership at mint time and nothing revokes
 * them (SOK-1023). A short ttl bounds how long a removed member keeps access.
 */
export const ABLY_CLIENT_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface CreateAblyClientTokenRequestInput {
  userId: string;
  roomIds: readonly string[];
  organizationIds: readonly string[];
  workspaceIds: readonly string[];
  /** Opaque tab/device instance id; becomes clientId suffix for multi-device. */
  clientInstanceId: string;
}

export async function createAblyClientTokenRequest({
  userId,
  roomIds,
  organizationIds,
  workspaceIds,
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
    workspaceIds,
    notificationChannelEnvironment: getNotificationChannelEnvironment(),
  });

  return client.auth.createTokenRequest({
    clientId: buildAblyPresenceClientId(userId, clientInstanceId),
    capability,
    ttl: ABLY_CLIENT_TOKEN_TTL_MS,
  }) as Promise<TokenRequest>;
}

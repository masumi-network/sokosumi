import {
  buildAblyPresenceClientId,
  isValidAblyClientInstanceId,
} from "@sokosumi/utils";
import { Rest, type TokenRequest } from "ably";

import { getEnv } from "@/config/env";

import { getNotificationChannelEnvironment } from "./notification-channel-environment";
import { buildAblyClientCapability } from "./subscribe-capability";

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
  }) as Promise<TokenRequest>;
}

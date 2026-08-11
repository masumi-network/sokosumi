import {
  buildAblyPresenceClientId,
  isValidAblyClientInstanceId,
} from "@sokosumi/utils";
import { Rest, type TokenRequest } from "ably";

import { getEnv } from "@/config/env";

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

/**
 * Mint an Ably TokenRequest for Realtime (subscribe + org presence).
 * clientId is `{userId}:{clientInstanceId}` so multi-device presence aggregates.
 */
export async function createAblySubscribeTokenRequest(
  userId: string,
  roomIds: readonly string[],
  organizationIds: readonly string[] = [],
  clientInstanceId = "default00",
): Promise<TokenRequest> {
  return createAblyClientTokenRequest({
    userId,
    roomIds,
    organizationIds,
    clientInstanceId,
  });
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
  });

  // Ably TokenParams.capability uses a narrow capabilityOp union; our map is
  // built only from allowed ops (subscribe | presence).
  return client.auth.createTokenRequest({
    clientId: buildAblyPresenceClientId(userId, clientInstanceId),
    capability: capability as {
      [key: string]: Array<"subscribe" | "presence">;
    },
  }) as Promise<TokenRequest>;
}

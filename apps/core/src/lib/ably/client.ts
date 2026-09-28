import { Rest } from "ably";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

function createRest(key: string) {
  return new Rest({
    key,
    // Node defaults to msgpack. A JSON or padded REST body then throws
    // `${n} trailing bytes` from Ably's decoder (SOKOSUMI-CORE-3T).
    useBinaryProtocol: false,
  });
}

let restClient: Rest | null = null;

export function getRestClient() {
  if (!restClient) {
    restClient = createRest(getEnv().ABLY_PUBLISH_ONLY_KEY);
  }
  return restClient;
}

let subscribeRestClient: Rest | null = null;

/**
 * The client signing key: token requests for browsers, and channel occupancy.
 * Despite its legacy env name, it also needs publish + subscribe on
 * chat_typing:* in the dashboard; tokens cannot exceed their signing key.
 *
 * The occupancy read (`channel-occupancy.ts`) needs the `channel-metadata`
 * capability on this key, which the dashboard grants rather than this code.
 */
export function getSubscribeRestClient(): Rest {
  if (!subscribeRestClient) {
    subscribeRestClient = createRest(getEnv().ABLY_SUBSCRIBE_ONLY_KEY);
  }
  return subscribeRestClient;
}

let pushAdminRestClient: Rest | null = null;

/** Separate from the key that signs browser tokens; never granted to browsers. */
export function getPushAdminRestClient(): Rest {
  const key = getEnv().ABLY_PUSH_ADMIN_KEY;
  if (!key) {
    throw serviceUnavailable("Push device listing is not configured");
  }
  pushAdminRestClient ??= createRest(key);
  return pushAdminRestClient;
}

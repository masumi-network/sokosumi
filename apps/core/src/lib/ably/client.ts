import { Rest } from "ably";

import { getEnv } from "@/config/env";

let restClient: Rest | null = null;

export function getRestClient() {
  if (!restClient) {
    restClient = new Rest({
      key: getEnv().ABLY_PUBLISH_ONLY_KEY,
    });
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
    subscribeRestClient = new Rest({
      key: getEnv().ABLY_SUBSCRIBE_ONLY_KEY,
    });
  }
  return subscribeRestClient;
}

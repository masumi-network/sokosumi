import { Rest } from "ably";

import { getEnv } from "@/config/env";

let restClient: Rest | null = null;
let subscribeRestClient: Rest | null = null;

export function getRestClient() {
  if (!restClient) {
    restClient = new Rest({
      key: getEnv().ABLY_PUBLISH_ONLY_KEY,
    });
  }
  return restClient;
}

/**
 * Separate client signed with the subscribe-only key.
 *
 * Deliberately not `getRestClient()`: that singleton holds the publish-only
 * key, and Ably rejects a token request whose capability exceeds the signing
 * key's own capability. Minting subscribe tokens therefore needs its own key.
 */
export function getSubscribeRestClient() {
  if (!subscribeRestClient) {
    subscribeRestClient = new Rest({
      key: getEnv().ABLY_SUBSCRIBE_ONLY_KEY,
    });
  }
  return subscribeRestClient;
}

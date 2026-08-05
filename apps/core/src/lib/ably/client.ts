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
/**
 * Key used to sign subscribe tokens.
 *
 * Prefers a dedicated subscribe key, falling back to the publish key so no new
 * environment configuration is required to serve non-browser clients.
 *
 * The fallback works only if that key's own capability includes `subscribe`:
 * Ably rejects a token request whose capability exceeds the signing key's. A
 * key genuinely restricted to publish will fail here, and the fix is then to
 * provide ABLY_SUBSCRIBE_ONLY_KEY.
 */
function signingKey(): string {
  const env = getEnv();
  return env.ABLY_SUBSCRIBE_ONLY_KEY ?? env.ABLY_PUBLISH_ONLY_KEY;
}

export function isSubscribeClientConfigured(): boolean {
  return Boolean(signingKey());
}

export function getSubscribeRestClient() {
  const key = signingKey();

  if (!key) {
    throw new Error("No Ably key is configured");
  }

  if (!subscribeRestClient) {
    subscribeRestClient = new Rest({ key });
  }
  return subscribeRestClient;
}

import { type Client, createClient } from "@sokosumi/core-client/client";

import { getAuth } from "./auth";
import { readCmoAuthConfig } from "./auth-config";

let coreClient: Client | undefined;

/**
 * Request options that call Core `/v1` as the signed-in person, with the
 * Sokosumi access token from CMO's account cookie (ADR 0045). Pages render
 * after the proxy renewed it; a server action skips the proxy, so Better
 * Auth refreshes it here when it is about to expire.
 */
export async function asSignedInPerson(requestHeaders: Headers) {
  const { accessToken } = await getAuth().api.getAccessToken({
    body: { useAccountCookie: true },
    headers: requestHeaders,
  });
  coreClient ??= createClient({
    baseUrl: `${readCmoAuthConfig().coreBaseUrl}/v1`,
  });
  return {
    client: coreClient,
    headers: { authorization: `Bearer ${accessToken}` },
  };
}

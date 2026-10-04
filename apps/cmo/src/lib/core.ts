import { createClient } from "@sokosumi/core-client/client";
import { headers } from "next/headers";

import { getAuth } from "./auth";
import { readCmoAuthConfig } from "./auth-config";

/**
 * A Core `/v1` client for the signed-in person, server side only: CMO holds
 * no database and reaches Sokosumi with the person's Sign in with Sokosumi
 * token (ADR 0045). Null when there is no usable token.
 */
export async function coreForCurrentUser(): Promise<{
  client: ReturnType<typeof createClient>;
  headers: { authorization: string };
} | null> {
  // Stateless Better Auth keeps the provider tokens in the account cookie.
  const token = await getAuth()
    .api.getAccessToken({
      body: { useAccountCookie: true },
      headers: await headers(),
    })
    .catch(() => null);
  if (!token?.accessToken) return null;
  return {
    client: createClient({
      baseUrl: `${readCmoAuthConfig().coreBaseUrl}/v1`,
    }),
    headers: { authorization: `Bearer ${token.accessToken}` },
  };
}

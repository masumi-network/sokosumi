import "server-only";

import { getOAuthClientPublicPrelogin, getSession } from "./auth.server";
import {
  type AuthRedirectSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  getRedirectQueryString,
  oauthRequestRequiresSignIn,
} from "./auth.utils";

/** The product that sent the person here, as its client row describes it. */
export interface OAuthRequestClient {
  name: string;
  /** Its home page, the way back; https only. */
  uri: string | undefined;
  /** https only. */
  logoUri: string | undefined;
}

export interface OAuthRequest {
  /** The signed query, as Core's OAuth provider issued it. */
  query: string;
  /** The requesting product, when Core could name it. */
  client: OAuthRequestClient | undefined;
  /**
   * The person is signed in and the request does not ask them to sign in
   * again, so it goes back to the provider instead of showing a form.
   */
  canHandBack: boolean;
}

/**
 * Reads the OAuth request a sign-in or sign-up page carries, if any: Core's
 * OAuth provider sends people to these pages with a signed query.
 */
export async function readOAuthRequest(
  searchParams: Promise<AuthRedirectSearchParams>,
): Promise<OAuthRequest | undefined> {
  const params = new URLSearchParams(
    await getRedirectQueryString(searchParams),
  );
  const query = buildSignedOAuthQueryFromSearchParams(params);
  const clientId = params.get("client_id");
  if (!query || !clientId) {
    return undefined;
  }

  const [session, client] = await Promise.all([
    getSession(),
    getOAuthClientPublicPrelogin(clientId, query),
  ]);
  return {
    query,
    client: client?.client_name
      ? {
          name: client.client_name,
          uri: httpsUrl(client.client_uri),
          logoUri: httpsUrl(client.logo_uri),
        }
      : undefined,
    // Handing back a request that asks to sign in again would only return
    // the person to this page.
    canHandBack: session != null && !oauthRequestRequiresSignIn(query),
  };
}

/**
 * The client row is typed in by hand at /developer, so its links are only
 * followed or loaded when they are absolute https URLs.
 */
function httpsUrl(value: string | undefined): string | undefined {
  return value && URL.parse(value)?.protocol === "https:" ? value : undefined;
}

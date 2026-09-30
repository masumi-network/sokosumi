import "server-only";

import { getOAuthClientPublicPrelogin, getSession } from "./auth.server";
import {
  type AuthRedirectSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  getRedirectQueryString,
} from "./auth.utils";

export interface OAuthRequest {
  /** The signed query, as Core's OAuth provider issued it. */
  query: string;
  /** The requesting product's name, when Core could name it. */
  clientName: string | undefined;
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
  // Handing such a request back would only return the person to this page.
  const requiresSignIn =
    params.has("max_age") ||
    (params.get("prompt")?.split(" ").includes("login") ?? false);

  return {
    query,
    clientName: client?.client_name || undefined,
    canHandBack: session != null && !requiresSignIn,
  };
}

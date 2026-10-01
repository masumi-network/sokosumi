import "server-only";

import type { SessionUser } from "@sokosumi/utils";

import { getOAuthClientPublicPrelogin, getSession } from "./auth.server";
import {
  type AuthRedirectSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  getRedirectQueryString,
  oauthRequestAsksForNewAccount,
  oauthRequestRequiresSignIn,
} from "./auth.utils";

/**
 * How long before Core signed the request a session may have started and
 * still count as started for it. A sign-in or sign-up on these pages answers a
 * `prompt=create` request by sending the person back here with the request
 * signed again (`ba_iat`) in the same response that starts the session, so the
 * gap is that response's own processing time.
 */
const SESSION_FOR_REQUEST_GRACE_MS = 5_000;

function sessionStartedForRequest(
  sessionCreatedAt: Date | string,
  oauthQuery: string,
): boolean {
  const signedAt = Number(new URLSearchParams(oauthQuery).get("ba_iat"));
  const startedAt = new Date(sessionCreatedAt).getTime();
  return (
    signedAt > 0 &&
    Math.abs(signedAt - startedAt) <= SESSION_FOR_REQUEST_GRACE_MS
  );
}

export type OAuthRequestAccount = Pick<SessionUser, "id" | "name" | "email">;

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
  /**
   * The signed-in account the person confirms before the request goes back,
   * because the product asked for a new account (`prompt=create`). Without
   * the question, pressing "Create account" would sign them in as whoever is
   * signed in to Sokosumi. Not asked of a person who just signed in or up here
   * for this request: they already chose.
   */
  accountToConfirm: OAuthRequestAccount | undefined;
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
  // Handing back a request that asks to sign in again would only return the
  // person to this page.
  const canHandBack = session != null && !oauthRequestRequiresSignIn(query);
  return {
    query,
    client: client?.client_name
      ? {
          name: client.client_name,
          uri: httpsUrl(client.client_uri),
          logoUri: httpsUrl(client.logo_uri),
        }
      : undefined,
    canHandBack,
    accountToConfirm:
      canHandBack &&
      oauthRequestAsksForNewAccount(query) &&
      !sessionStartedForRequest(session.session.createdAt, query)
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          }
        : undefined,
  };
}

/**
 * The client row is typed in by hand at /developer, so its links are only
 * followed or loaded when they are absolute https URLs.
 */
function httpsUrl(value: string | undefined): string | undefined {
  const url = value ? URL.parse(value) : null;
  return url?.protocol === "https:" ? url.href : undefined;
}

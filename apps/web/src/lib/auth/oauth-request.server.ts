import "server-only";

import type { SessionUser } from "@sokosumi/utils";

import {
  getOAuthClientPublic,
  getOAuthClientPublicPrelogin,
  getSession,
  type OAuthClientPublic,
} from "./auth.server";
import {
  type AuthRedirectSearchParams,
  buildSignedOAuthQueryFromSearchParams,
  getRedirectQueryString,
  oauthRequestAsksForNewAccount,
  oauthRequestHasExpired,
  oauthRequestRequiresSignIn,
} from "./auth.utils";

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
   * signed in to Sokosumi. A person who signs in or up for the request never
   * sees it: Core sends their new session straight to the product.
   */
  accountToConfirm: OAuthRequestAccount | undefined;
  /**
   * Core no longer accepts the request, so the page says so instead of a form
   * whose submission it would refuse.
   */
  hasExpired: boolean;
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
  if (oauthRequestHasExpired(query)) {
    return {
      query,
      client: await getExpiredRequestClient(query),
      canHandBack: false,
      accountToConfirm: undefined,
      hasExpired: true,
    };
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
    client: toRequestClient(client),
    canHandBack,
    accountToConfirm:
      canHandBack && oauthRequestAsksForNewAccount(query)
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          }
        : undefined,
    hasExpired: false,
  };
}

/**
 * Core's pre-sign-in lookup refuses an expired request, but its session lookup
 * still names the client to a person who is signed in.
 */
async function getExpiredRequestClient(
  query: string,
): Promise<OAuthRequestClient | undefined> {
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  // Do not attribute malformed requests or fields outside the signed
  // parameter manifest to a product through the session-only lookup.
  if (
    !clientId ||
    params.getAll("client_id").length !== 1 ||
    !params.get("sig") ||
    params.getAll("sig").length !== 1
  ) {
    return undefined;
  }
  return getSignedInOAuthClient(clientId);
}

/**
 * Names a client to a person who is signed in, through Core's session-only
 * lookup. `undefined` without a session, or when Core cannot name it.
 */
async function getSignedInOAuthClient(
  clientId: string,
): Promise<OAuthRequestClient | undefined> {
  if (!(await getSession())) {
    return undefined;
  }
  const result = await getOAuthClientPublic(clientId);
  return result.isOk() ? toRequestClient(result.value) : undefined;
}

function toRequestClient(
  client: OAuthClientPublic | null,
): OAuthRequestClient | undefined {
  return client?.client_name
    ? {
        name: client.client_name,
        uri: httpsUrl(client.client_uri),
        logoUri: httpsUrl(client.logo_uri),
      }
    : undefined;
}

/**
 * The client row is typed in by hand at /developer, so its links are only
 * followed or loaded when they are absolute https URLs.
 */
function httpsUrl(value: string | undefined): string | undefined {
  const url = value ? URL.parse(value) : null;
  return url?.protocol === "https:" ? url.href : undefined;
}

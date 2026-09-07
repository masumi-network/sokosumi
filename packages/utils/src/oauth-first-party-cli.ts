import {
  buildOAuthClientGrantTypes,
  OAUTH_PROVIDER_SCOPES,
} from "./oauth-scopes.js";

/** Stable public client_id for the first-party Sokosumi CLI. Not a secret. */
export const FIRST_PARTY_CLI_OAUTH_CLIENT_ID = "sokosumi_cli";

export const FIRST_PARTY_CLI_OAUTH_SOFTWARE_ID = "sokosumi-cli";

export const FIRST_PARTY_CLI_OAUTH_CLIENT_NAME = "Sokosumi CLI";

/**
 * Loopback redirects for the native CLI. Better Auth honors RFC 8252 §7.3
 * port variance on 127.0.0.1 and [::1], so the CLI may listen on any port
 * (default 53682) as long as the path stays `/oauth/callback`.
 */
export const FIRST_PARTY_CLI_OAUTH_REDIRECT_URIS = [
  "http://127.0.0.1/oauth/callback",
  "http://[::1]/oauth/callback",
] as const;

export interface FirstPartyCliOAuthClientWrite {
  clientId: string;
  clientSecret: null;
  userId: null;
  name: string;
  softwareId: string;
  applicationType: "native";
  tokenEndpointAuthMethod: "none";
  requirePKCE: true;
  skipConsent: false;
  disabled: false;
  scopes: string[];
  grantTypes: string[];
  responseTypes: ["code"];
  redirectUris: string[];
  contacts: [];
  postLogoutRedirectUris: [];
}

/** Prisma create/update payload for the platform-owned CLI OAuth client. */
export function buildFirstPartyCliOAuthClientWrite(): FirstPartyCliOAuthClientWrite {
  return {
    clientId: FIRST_PARTY_CLI_OAUTH_CLIENT_ID,
    clientSecret: null,
    userId: null,
    name: FIRST_PARTY_CLI_OAUTH_CLIENT_NAME,
    softwareId: FIRST_PARTY_CLI_OAUTH_SOFTWARE_ID,
    applicationType: "native",
    tokenEndpointAuthMethod: "none",
    requirePKCE: true,
    skipConsent: false,
    disabled: false,
    scopes: [...OAUTH_PROVIDER_SCOPES],
    grantTypes: [...buildOAuthClientGrantTypes(true)],
    responseTypes: ["code"],
    redirectUris: [...FIRST_PARTY_CLI_OAUTH_REDIRECT_URIS],
    contacts: [],
    postLogoutRedirectUris: [],
  };
}

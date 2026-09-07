import { describe, expect, it } from "vitest";

import {
  buildFirstPartyCliOAuthClientWrite,
  FIRST_PARTY_CLI_OAUTH_CLIENT_ID,
  FIRST_PARTY_CLI_OAUTH_CLIENT_NAME,
  FIRST_PARTY_CLI_OAUTH_REDIRECT_URIS,
  FIRST_PARTY_CLI_OAUTH_SOFTWARE_ID,
} from "./oauth-first-party-cli";

describe("first-party CLI OAuth client", () => {
  it("uses a stable public native client id and loopback redirects", () => {
    expect(FIRST_PARTY_CLI_OAUTH_CLIENT_ID).toBe("sokosumi_cli");
    expect(FIRST_PARTY_CLI_OAUTH_SOFTWARE_ID).toBe("sokosumi-cli");
    expect(FIRST_PARTY_CLI_OAUTH_CLIENT_NAME).toBe("Sokosumi CLI");
    expect(FIRST_PARTY_CLI_OAUTH_REDIRECT_URIS).toEqual([
      "http://127.0.0.1/oauth/callback",
      "http://[::1]/oauth/callback",
    ]);
  });

  it("builds a platform-owned public native client write", () => {
    expect(buildFirstPartyCliOAuthClientWrite()).toEqual({
      clientId: "sokosumi_cli",
      clientSecret: null,
      userId: null,
      name: "Sokosumi CLI",
      softwareId: "sokosumi-cli",
      applicationType: "native",
      tokenEndpointAuthMethod: "none",
      requirePKCE: true,
      skipConsent: false,
      disabled: false,
      scopes: ["openid", "sokosumi:api", "offline_access"],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      redirectUris: [
        "http://127.0.0.1/oauth/callback",
        "http://[::1]/oauth/callback",
      ],
      contacts: [],
      postLogoutRedirectUris: [],
    });
  });
});

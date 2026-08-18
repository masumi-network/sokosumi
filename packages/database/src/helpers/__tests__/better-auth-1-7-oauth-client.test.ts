import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { mapOauthClientForBetterAuth17 } from "../better-auth-1-7-oauth-client.js";

describe("mapOauthClientForBetterAuth17", () => {
  it("maps a confidential web client", () => {
    assert.deepEqual(
      mapOauthClientForBetterAuth17({
        id: "c1",
        type: "web",
        public: false,
      }),
      {
        status: "ready",
        id: "c1",
        applicationType: "web",
        tokenEndpointAuthMethod: "client_secret_basic",
        clientCredentialsScopes: [],
        clientDiscoveryId: null,
      },
    );
  });

  it("maps a native public client to tokenEndpointAuthMethod none", () => {
    assert.deepEqual(
      mapOauthClientForBetterAuth17({
        id: "c2",
        type: "native",
        public: true,
      }),
      {
        status: "ready",
        id: "c2",
        applicationType: "native",
        tokenEndpointAuthMethod: "none",
        clientCredentialsScopes: [],
        clientDiscoveryId: null,
      },
    );
  });

  it("flags user-agent-based clients for review", () => {
    assert.deepEqual(
      mapOauthClientForBetterAuth17({
        id: "c3",
        type: "user-agent-based",
        public: true,
      }),
      {
        status: "unmapped",
        id: "c3",
        reason: "oauth-client-type-needs-review",
        type: "user-agent-based",
      },
    );
  });
});

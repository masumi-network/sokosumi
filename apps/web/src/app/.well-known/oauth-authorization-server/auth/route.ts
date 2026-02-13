import { NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";

function getOAuthAuthorizationServerMetadata() {
  const { BETTER_AUTH_URL } = getEnvSecrets();
  const issuer = `${BETTER_AUTH_URL}/auth`;
  const oauthBasePath = `${BETTER_AUTH_URL}/api/auth/oauth2`;

  return {
    issuer,
    authorization_endpoint: `${oauthBasePath}/authorize`,
    token_endpoint: `${oauthBasePath}/token`,
    registration_endpoint: `${oauthBasePath}/register`,
    revocation_endpoint: `${oauthBasePath}/revoke`,
    introspection_endpoint: `${oauthBasePath}/introspect`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: ["openid", "offline_access"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["HS256"],
  };
}

export async function GET() {
  return NextResponse.json(getOAuthAuthorizationServerMetadata());
}

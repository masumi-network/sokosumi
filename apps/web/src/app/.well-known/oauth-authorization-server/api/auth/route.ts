import { NextResponse } from "next/server";

import { getBetterAuthPublicBaseUrl } from "@/config/better-auth-public-url";

function getOAuthAuthorizationServerMetadata() {
  const issuer = `${getBetterAuthPublicBaseUrl()}/api/auth`;
  const oauthBasePath = `${issuer}/oauth2`;

  return {
    issuer,
    authorization_endpoint: `${oauthBasePath}/authorize`,
    token_endpoint: `${oauthBasePath}/token`,
    registration_endpoint: `${oauthBasePath}/register`,
    revocation_endpoint: `${oauthBasePath}/revoke`,
    introspection_endpoint: `${oauthBasePath}/introspect`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["HS256"],
  };
}

export async function GET() {
  return NextResponse.json(getOAuthAuthorizationServerMetadata());
}

import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { stripeClient } from "@better-auth/stripe/client";
import {
  betterAuthOrganizationAdditionalFields,
  betterAuthUserAdditionalFields,
  resolveBetterAuthCookieName,
} from "@sokosumi/utils";
import {
  adminClient,
  inferAdditionalFields,
  inferOrgAdditionalFields,
  jwtClient,
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";

import { getEnvPublicConfig } from "@/config/env.public";

function getLastUsedLoginMethodCookieName(): string {
  const env = getEnvPublicConfig();

  return resolveBetterAuthCookieName(
    {
      network: env.NEXT_PUBLIC_NETWORK,
      vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
      vercelGitCommitRef: env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
    },
    "last_used_login_method",
  );
}

/** Plugin list shared by browser and server Better Auth clients. */
export function getAuthClientPlugins() {
  return [
    inferAdditionalFields({
      user: betterAuthUserAdditionalFields,
    }),
    adminClient(),
    apiKeyClient(),
    organizationClient({
      schema: inferOrgAdditionalFields({
        organization: {
          additionalFields: betterAuthOrganizationAdditionalFields,
        },
      }),
    }),
    passkeyClient(),
    magicLinkClient(),
    lastLoginMethodClient({
      cookieName: getLastUsedLoginMethodCookieName(),
    }),
    oauthProviderClient(),
    jwtClient(),
    stripeClient({
      subscription: true,
    }),
  ];
}

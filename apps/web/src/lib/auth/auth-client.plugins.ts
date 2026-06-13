import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { stripeClient } from "@better-auth/stripe/client";
import { resolveBetterAuthCookieName } from "@sokosumi/utils";
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

import type { auth } from "./auth";

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
    inferAdditionalFields<typeof auth>(),
    adminClient(),
    apiKeyClient(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
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

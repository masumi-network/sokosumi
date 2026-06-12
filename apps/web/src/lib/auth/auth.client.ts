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
  jwtClient,
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getEnvPublicConfig } from "@/config/env.public";
import { getBrowserCoreAuthBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

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

export const authClient = createAuthClient({
  // Auth traffic goes directly to core's Better Auth instance; cookies are
  // scoped to the shared parent domain so the web server can read sessions.
  baseURL: getBrowserCoreAuthBaseUrl(),
  plugins: [
    inferAdditionalFields({ user: betterAuthUserAdditionalFields }),
    adminClient(),
    apiKeyClient(),
    organizationClient({
      schema: {
        organization: {
          additionalFields: betterAuthOrganizationAdditionalFields,
        },
      },
    }),
    passkeyClient(),
    lastLoginMethodClient({
      cookieName: getLastUsedLoginMethodCookieName(),
    }),
    oauthProviderClient(),
    jwtClient(),
    stripeClient({
      subscription: true,
    }),
  ],
});

export const {
  signUp,
  signIn,
  signOut,
  requestPasswordReset,
  resetPassword,
  deleteUser,
  useSession,
  changeEmail,
  changePassword,
} = authClient;

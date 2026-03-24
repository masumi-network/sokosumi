import { apiKeyClient } from "@better-auth/api-key/client";
import { dashClient, sentinelClient } from "@better-auth/infra/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { stripeClient } from "@better-auth/stripe/client";
import {
  getBetterAuthCookieName,
  resolveBetterAuthCookiePrefix,
} from "@sokosumi/utils";
import {
  adminClient,
  inferAdditionalFields,
  inferOrgAdditionalFields,
  jwtClient,
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { auth } from "./auth";

function getLastUsedLoginMethodCookieName(): string {
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";

  return getBetterAuthCookieName(
    resolveBetterAuthCookiePrefix({
      baseUrl,
    }),
    "last_used_login_method",
  );
}

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    adminClient(),
    apiKeyClient(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
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
    dashClient(),
    sentinelClient(),
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

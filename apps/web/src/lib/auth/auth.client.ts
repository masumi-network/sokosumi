import { apiKeyClient } from "@better-auth/api-key/client";
import { dashClient, sentinelClient } from "@better-auth/infra/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { stripeClient } from "@better-auth/stripe/client";
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

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    adminClient(),
    apiKeyClient(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
    lastLoginMethodClient(),
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

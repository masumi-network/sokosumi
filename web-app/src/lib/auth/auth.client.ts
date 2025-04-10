import { stripeClient } from "@better-auth/stripe/client";
import {
  adminClient,
  multiSessionClient,
  organizationClient,
  passkeyClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    stripeClient({
      subscription: false,
    }),
    organizationClient(),
    twoFactorClient(),
    passkeyClient(),
    adminClient(),
    multiSessionClient(),
  ],
});

export const {
  signUp,
  signIn,
  signOut,
  useSession,
  organization,
  useListOrganizations,
  useActiveOrganization,
} = authClient;

import {
  adminClient,
  multiSessionClient,
  organizationClient,
  passkeyClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export type Session = typeof authClient.$Infer.Session;
export type User = typeof authClient.$Infer.Session.user;

export const authClient = createAuthClient({
  plugins: [
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

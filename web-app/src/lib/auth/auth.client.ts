import { apiKeyClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [apiKeyClient(), organizationClient()],
});

export type BetterAuthClientError = {
  code?: string | undefined;
  message?: string | undefined;
  status: number;
  statusText: string;
};

export const {
  signUp,
  signIn,
  signOut,
  forgetPassword,
  resetPassword,
  deleteUser,
  useSession,
  changeEmail,
  changePassword,
} = authClient;

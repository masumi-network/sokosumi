import { createAuthClient } from "better-auth/react";

import { getAuthClientPlugins } from "./auth-client.plugins";

export const authClient = createAuthClient({
  plugins: getAuthClientPlugins(),
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
  subscription,
} = authClient;

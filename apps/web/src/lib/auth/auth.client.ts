import { createAuthClient } from "better-auth/react";

import { getBrowserCoreAuthProxyBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

import { getAuthClientPlugins } from "./auth-client.plugins";

export const authClient = createAuthClient({
  baseURL: getBrowserCoreAuthProxyBaseUrl(),
  fetchOptions: {
    credentials: "include",
  },
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

import { createAuthClient } from "better-auth/react";

import { getBrowserCoreAuthBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

import { getAuthClientPlugins } from "./auth-client.plugins";

export const authClient = createAuthClient({
  baseURL: getBrowserCoreAuthBaseUrl(),
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

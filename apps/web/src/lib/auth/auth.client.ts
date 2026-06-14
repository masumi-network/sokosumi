import { createAuthClient } from "better-auth/react";

import { getEnvPublicConfig } from "@/config/env.public";
import { getBrowserCoreAuthBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

import { getAuthClientPlugins } from "./auth-client.plugins";

// `NEXT_PUBLIC_*` is inlined at build time — changing the flag requires a rebuild.
const useCoreAuthClient = getEnvPublicConfig().NEXT_PUBLIC_USE_CORE_AUTH_CLIENT;

export const authClient = createAuthClient({
  ...(useCoreAuthClient
    ? {
        baseURL: getBrowserCoreAuthBaseUrl(),
        // Keep default fetch plugins (unlike auth.server.client): they handle
        // browser redirects/cookies; server client disables them because
        // customFetchImpl replaces fetch entirely.
        fetchOptions: {
          credentials: "include",
        },
      }
    : {}),
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

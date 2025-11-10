import {
  apiKeyClient,
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import pTimeout from "p-timeout";

import { sleep } from "@/lib/utils";

import { auth, Session } from "./auth";

export const authClient = createAuthClient({
  plugins: [
    apiKeyClient(),
    inferAdditionalFields<typeof auth>(),
    organizationClient({
      schema: inferOrgAdditionalFields<typeof auth>(),
    }),
  ],
});

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

export const getSessionWithRetry = async (
  retryCount: number = 5,
  timeout: number = 5000, // in milliseconds
  retryDelay: number = 1000, // in milliseconds
): Promise<Session | null> => {
  const getSessionWithRetryInner = async (): Promise<Session | null> => {
    let currentRetryCount = 0;
    while (currentRetryCount < retryCount) {
      const session = await authClient.getSession();
      console.log("Try: ", currentRetryCount, session);
      if (!session || !session.data) {
        await sleep(retryDelay);
        currentRetryCount++;
      } else {
        return session.data;
      }
    }
    return null;
  };
  return pTimeout(getSessionWithRetryInner(), { milliseconds: timeout });
};

import {
  apiKeyClient,
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { auth } from "./auth";

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

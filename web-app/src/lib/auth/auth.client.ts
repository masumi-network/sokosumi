import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [],
});

export const { signUp, signIn, signOut, useSession } = authClient;

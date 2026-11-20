"use client";

import type { Session } from "@sokosumi/utils";
import { useContext } from "react";
import { useAuthSessionHydration } from "@/hooks/effects/use-auth-session-hydration";
import { AuthSessionIdentityContext } from "./auth-session-guard";

interface AuthSessionHydratorProps {
  session: Session;
}

/**
 * Seed after the hydration render so SSR HTML matches the first client
 * pass (`useSession` still pending). Layout effect runs before paint, so
 * subscribers see data on first paint without a Drive org-tab mismatch.
 *
 * Pass the full Core `/auth/get-session` JSON, including `session.token`.
 * A partial object would disagree with the background refetch. The client
 * infers extra plugin fields (for example `banned`) that the JSON still
 * carries.
 */
export function AuthSessionHydrator({ session }: AuthSessionHydratorProps) {
  const registerRenderedUser = useContext(AuthSessionIdentityContext);
  useAuthSessionHydration(session, registerRenderedUser);
  return null;
}

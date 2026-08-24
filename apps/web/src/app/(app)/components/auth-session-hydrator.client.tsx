"use client";

import type { Session } from "@sokosumi/utils";
import { authClient } from "@/lib/auth/auth.client";

interface AuthSessionHydratorProps {
  session: Session;
}

/**
 * `Session` is the Core `/auth/get-session` JSON web already uses. The
 * client infers extra plugin fields (for example `banned`) that the JSON
 * still carries.
 */
export function AuthSessionHydrator({ session }: AuthSessionHydratorProps) {
  authClient.hydrateSession(session as typeof authClient.$Infer.Session);
  return null;
}

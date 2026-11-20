"use client";

import type { Session } from "@sokosumi/utils";
import { useLayoutEffect } from "react";
import { authClient } from "@/lib/auth/auth.client";

/**
 * Seeds `authClient` and registers the rendered user before paint
 * (`useLayoutEffect`) so SSR HTML matches the first client hydration pass
 * while subscribers see session data on first paint.
 */
export function useAuthSessionHydration(
  session: Session,
  registerRenderedUser: ((userId: string) => void) | null,
): void {
  useLayoutEffect(() => {
    registerRenderedUser?.(session.user.id);
    authClient.hydrateSession(session as typeof authClient.$Infer.Session);
  }, [session, registerRenderedUser]);
}

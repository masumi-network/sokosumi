"use client";

import { useEffect, useRef } from "react";

import { NEWSLETTER_EMBED_PATH } from "@/config/document-security-headers";
import { RESET_PASSWORD_PATH } from "@/lib/reset-password-token";

export function isTelemetryBlockedPath(pathname: string): boolean {
  const isResetPasswordPath =
    pathname === RESET_PASSWORD_PATH ||
    pathname.startsWith(`${RESET_PASSWORD_PATH}/`);

  return isResetPasswordPath || NEWSLETTER_EMBED_PATH.test(pathname);
}

/**
 * Forces a full document reload when a document that has already mounted
 * telemetry navigates in-place (Browser Back/Forward or soft SPA nav) into a
 * telemetry-blocked route (`/reset-password`, `/n/<slug>/embed`).
 *
 * Unmounting `<GoogleTags>` / `<ClientAnalytics>` cannot unload scripts
 * already injected into `window`, and GA4/GTM listen to `popstate`
 * synchronously. Listening in the capture phase before third-party scripts
 * load stops propagation and reloads a clean document before GA4/GTM or
 * Vercel Analytics can report the blocked route.
 */
export function useTelemetryBoundaryGuard(isBlocked: boolean): void {
  const hadAllowedRouteRef = useRef(false);
  const reloadTriggeredRef = useRef(false);

  // Register once on mount so this listener sits ahead of third-party scripts
  // (gtm.js, gtag/js, Vercel Analytics) in window's popstate listener list,
  // and stays attached even if Next.js flushes a pathname transition to a
  // blocked route earlier in the same popstate dispatch.
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (
        !hadAllowedRouteRef.current ||
        !isTelemetryBlockedPath(window.location.pathname)
      ) {
        return;
      }
      event.stopImmediatePropagation();
      if (reloadTriggeredRef.current) {
        return;
      }
      reloadTriggeredRef.current = true;
      window.location.reload();
    };

    window.addEventListener("popstate", handlePopState, { capture: true });
    return () => {
      window.removeEventListener("popstate", handlePopState, {
        capture: true,
      });
    };
  }, []);

  useEffect(() => {
    if (!isBlocked) {
      hadAllowedRouteRef.current = true;
      return;
    }

    if (hadAllowedRouteRef.current && !reloadTriggeredRef.current) {
      reloadTriggeredRef.current = true;
      window.location.reload();
    }
  }, [isBlocked]);
}

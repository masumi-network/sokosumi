"use client";

import { useEffect } from "react";

import { NEWSLETTER_EMBED_PATH } from "@/config/document-security-headers";
import { getEnvPublicConfig } from "@/config/env.public";
import {
  denyConsentMode,
  hasLoadedGoogleTags,
  restorePersistedConsentMode,
  setGoogleAnalyticsDisabled,
} from "@/lib/analytics/consent";
import { RESET_PASSWORD_PATH } from "@/lib/reset-password-token";

// RootLayout mounts two TelemetryBoundary instances; share suppression state so
// entering or leaving a blocked route pushes a single consent update and never
// leaks across test cleanups once all boundaries unmount.
let activeBoundaryCount = 0;
let telemetrySuppressed = false;

export function isTelemetryBlockedPath(pathname: string): boolean {
  const isResetPasswordPath =
    pathname === RESET_PASSWORD_PATH ||
    pathname.startsWith(`${RESET_PASSWORD_PATH}/`);

  return isResetPasswordPath || NEWSLETTER_EMBED_PATH.test(pathname);
}

function suppressLoadedGoogleTags(gaId: string | undefined): void {
  if (telemetrySuppressed) return;
  telemetrySuppressed = true;
  setGoogleAnalyticsDisabled(gaId, true);
  denyConsentMode();
}

function restoreLoadedGoogleTags(gaId: string | undefined): void {
  if (!telemetrySuppressed) return;
  telemetrySuppressed = false;
  setGoogleAnalyticsDisabled(gaId, false);
  restorePersistedConsentMode();
}

/**
 * Suppresses already-loaded Google tags while a telemetry-blocked route
 * (`/reset-password*`, `/n/<slug>/embed`) is shown in the same document, and
 * restores persisted consent plus the GA disable flag when leaving.
 *
 * Unmounting `<GoogleTags>` cannot remove `gtm.js`/`gtag/js` once injected.
 * Updating `window['ga-disable-<gaId>']` and Consent Mode on both `popstate`
 * (without stopping propagation or reloading) and route transitions sets the
 * flag before GA's own history-change listener runs while preserving history
 * and form state.
 */
export function useBlockedRouteGoogleTelemetry(isBlocked: boolean): void {
  const gaId = getEnvPublicConfig().NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;

  useEffect(() => {
    activeBoundaryCount += 1;

    const handlePopState = () => {
      if (!hasLoadedGoogleTags()) {
        return;
      }
      if (isTelemetryBlockedPath(window.location.pathname)) {
        suppressLoadedGoogleTags(gaId);
      } else {
        restoreLoadedGoogleTags(gaId);
      }
    };

    window.addEventListener("popstate", handlePopState, { capture: true });
    return () => {
      window.removeEventListener("popstate", handlePopState, {
        capture: true,
      });
      activeBoundaryCount = Math.max(0, activeBoundaryCount - 1);
      if (activeBoundaryCount === 0) {
        telemetrySuppressed = false;
      }
    };
  }, [gaId]);

  useEffect(() => {
    if (!hasLoadedGoogleTags()) {
      return;
    }

    if (isBlocked) {
      suppressLoadedGoogleTags(gaId);
      return;
    }

    restoreLoadedGoogleTags(gaId);
  }, [isBlocked, gaId]);
}

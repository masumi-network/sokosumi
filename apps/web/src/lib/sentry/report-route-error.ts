import * as Sentry from "@sentry/nextjs";

import { CORE_AUTH_UNAVAILABLE_ERROR_DIGEST } from "@/lib/auth/errors";
import { isStaleDeploymentError } from "@/lib/utils/deployment-refresh";

/**
 * Route `error.tsx` files do not report on their own. Sentry's request hook
 * covers the server render; this covers the client boundary, including the
 * digest Next keeps after it masks the original error.
 */
export function shouldReportRouteError(
  error: Error & { digest?: string },
): boolean {
  if (error.digest === CORE_AUTH_UNAVAILABLE_ERROR_DIGEST) return false;
  return !isStaleDeploymentError(error.message ?? "");
}

export function reportRouteError(error: Error & { digest?: string }): boolean {
  if (!shouldReportRouteError(error)) return false;
  Sentry.captureException(error, {
    extra: error.digest ? { digest: error.digest } : undefined,
  });
  return true;
}

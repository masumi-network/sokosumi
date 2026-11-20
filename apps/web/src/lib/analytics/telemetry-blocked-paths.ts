import { NEWSLETTER_EMBED_PATH } from "@/config/document-security-headers";
import { RESET_PASSWORD_PATH } from "@/lib/reset-password-token";

/**
 * Routes where telemetry must not run. Crossing into or out of these paths
 * must use a full document load (`<a>` or `window.location.assign`), never a
 * Next.js soft navigation.
 */
export function isTelemetryBlockedPath(pathname: string): boolean {
  const normalized = pathname.split(/[?#]/, 1)[0] ?? pathname;
  return (
    normalized === RESET_PASSWORD_PATH ||
    normalized.startsWith(`${RESET_PASSWORD_PATH}/`) ||
    NEWSLETTER_EMBED_PATH.test(normalized)
  );
}

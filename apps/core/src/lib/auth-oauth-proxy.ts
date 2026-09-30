import { APIError } from "better-auth/api";
import type { EnvConfig } from "@/config/env";

/**
 * Only a preview completes a proxied sign-in. Anywhere else these endpoints
 * would turn a leaked OAUTH_PROXY_SECRET into a session for any email.
 *
 * `path` is Better Auth's route template, not the request path.
 */
export function refuseOAuthProxyCompletionOutsidePreview(
  path: string,
  vercelEnv: EnvConfig["VERCEL_ENV"],
): void {
  if (
    path !== "/callback/:id/oauth-proxy" &&
    path !== "/oauth-proxy-callback"
  ) {
    return;
  }
  if (vercelEnv !== "preview") {
    throw new APIError("NOT_FOUND");
  }
}

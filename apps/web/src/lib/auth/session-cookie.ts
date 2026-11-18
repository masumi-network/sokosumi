import { resolveBetterAuthCookiePrefix } from "@sokosumi/utils";
import { getSessionCookie } from "better-auth/cookies";

import { getEnvSecrets } from "@/config/env.secrets";

/**
 * Whether the request carries a session cookie. It does not check that the
 * session is valid. The proxy runs it on most requests, so keep its imports
 * light.
 */
export function hasSessionCookie(request: Request | Headers): boolean {
  const env = getEnvSecrets();
  const cookiePrefix = resolveBetterAuthCookiePrefix({
    network: env.NETWORK,
    vercelEnv: env.VERCEL_ENV,
    vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
  });
  return getSessionCookie(request, { cookiePrefix }) !== null;
}

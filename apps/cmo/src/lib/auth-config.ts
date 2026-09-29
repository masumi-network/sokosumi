import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";
import { withRelatedProject } from "@vercel/related-projects";

import type { CmoAuthConfig } from "./auth";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function vercelHostUrl(name: string): string | undefined {
  const host = process.env[name];
  return host ? `https://${host}` : undefined;
}

/**
 * Reads Sign in with Sokosumi's settings from env. On Vercel, CMO's origin
 * comes from the deployment (the branch alias on previews, which CI registers
 * as the preview callback) and Core's from the related Core mainnet project,
 * so a preview signs in against its own pull request's Core preview.
 */
export function readCmoAuthConfig(): CmoAuthConfig {
  const baseURL = resolveBetterAuthPublicBaseUrl({
    vercelEnv: process.env.VERCEL_ENV,
    // CI registers only the branch alias as a preview callback.
    vercelUrl: undefined,
    vercelBranchUrl: vercelHostUrl("VERCEL_BRANCH_URL"),
    vercelProductionUrl: vercelHostUrl("VERCEL_PROJECT_PRODUCTION_URL"),
    fallbackUrl: process.env.BETTER_AUTH_URL ?? "",
  });
  if (!baseURL) throw new Error("BETTER_AUTH_URL is not set");

  return {
    baseURL,
    coreBaseUrl: withRelatedProject({
      projectName: "sokosumi-core-mainnet",
      defaultHost: requireEnv("CORE_APP_BASE_URL"),
    }).replace(/\/+$/, ""),
    clientId: requireEnv("SOKOSUMI_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("SOKOSUMI_OAUTH_CLIENT_SECRET"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
  };
}

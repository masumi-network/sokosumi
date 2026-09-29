import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";

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
 * comes from the deployment (the branch alias on previews), and both
 * production and previews run the OAuth proxy against mainnet Core
 * (ADR 0045). Locally, CMO signs in directly against `CORE_APP_BASE_URL`.
 */
export function readCmoAuthConfig(): CmoAuthConfig {
  const vercelEnv = process.env.VERCEL_ENV;
  const productionURL = vercelHostUrl("VERCEL_PROJECT_PRODUCTION_URL");
  const baseURL = resolveBetterAuthPublicBaseUrl({
    vercelEnv,
    vercelUrl: undefined,
    vercelBranchUrl: vercelHostUrl("VERCEL_BRANCH_URL"),
    vercelProductionUrl: productionURL,
    fallbackUrl: process.env.BETTER_AUTH_URL ?? "",
  });
  if (!baseURL) throw new Error("BETTER_AUTH_URL is not set");

  const onVercel = vercelEnv === "production" || vercelEnv === "preview";
  if (onVercel && !productionURL) {
    throw new Error("VERCEL_PROJECT_PRODUCTION_URL is not set");
  }

  return {
    baseURL,
    coreBaseUrl: requireEnv("CORE_APP_BASE_URL").replace(/\/+$/, ""),
    clientId: requireEnv("SOKOSUMI_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("SOKOSUMI_OAUTH_CLIENT_SECRET"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    oauthProxy:
      onVercel && productionURL
        ? { productionURL, secret: requireEnv("OAUTH_PROXY_SECRET") }
        : undefined,
  };
}

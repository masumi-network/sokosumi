import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";

import type { CmoAuthConfig } from "./auth";
import { resolveCoreBaseUrl } from "./core-base-url";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function requireCoreBaseUrl(): string {
  const url = resolveCoreBaseUrl({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    CORE_APP_BASE_URL: process.env.CORE_APP_BASE_URL,
  });
  if (!url) throw new Error("CORE_APP_BASE_URL is not set");
  return url.replace(/\/+$/, "");
}

function vercelHostUrl(name: string): string | undefined {
  const host = process.env[name];
  return host ? `https://${host}` : undefined;
}

/**
 * Reads Sign in with Sokosumi's settings from env. On Vercel, CMO's origin
 * comes from the deployment (the branch alias on previews). Production runs
 * the OAuth proxy against mainnet Core (ADR 0045). A preview signs in
 * directly against its branch's Core preview, whose build registers the
 * preview's callback in its own database branch. Locally, CMO signs in
 * directly against `CORE_APP_BASE_URL`.
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
    coreBaseUrl: requireCoreBaseUrl(),
    clientId: requireEnv("SOKOSUMI_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("SOKOSUMI_OAUTH_CLIENT_SECRET"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    oauthProxy:
      vercelEnv === "production" && productionURL
        ? { productionURL, secret: requireEnv("OAUTH_PROXY_SECRET") }
        : undefined,
  };
}

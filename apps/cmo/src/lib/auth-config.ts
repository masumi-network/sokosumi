import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";

import type { CmoAuthConfig } from "./auth";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * CMO's production origin: the only callback Core's mainnet client registers.
 * Not `VERCEL_PROJECT_PRODUCTION_URL`, which names the project's
 * `*.preview.sokosumi.com` alias instead of cmo.xyz.
 */
const CMO_PRODUCTION_URL = "https://cmo.xyz";

function vercelHostUrl(name: string): string | undefined {
  const host = process.env[name];
  return host ? `https://${host}` : undefined;
}

/**
 * Reads Sign in with Sokosumi's settings from env. On Vercel, production runs
 * on cmo.xyz and previews on their branch alias; both run the OAuth proxy
 * against mainnet Core (ADR 0045). Locally, CMO signs in directly against
 * `CORE_APP_BASE_URL` on `BETTER_AUTH_URL`.
 */
export function readCmoAuthConfig(): CmoAuthConfig {
  const vercelEnv = process.env.VERCEL_ENV;
  const baseURL = resolveBetterAuthPublicBaseUrl({
    vercelEnv,
    vercelUrl: undefined,
    vercelBranchUrl: vercelHostUrl("VERCEL_BRANCH_URL"),
    vercelProductionUrl: CMO_PRODUCTION_URL,
    fallbackUrl: process.env.BETTER_AUTH_URL ?? "",
  });
  if (!baseURL) throw new Error("BETTER_AUTH_URL is not set");

  const onVercel = vercelEnv === "production" || vercelEnv === "preview";

  return {
    baseURL,
    coreBaseUrl: requireEnv("CORE_APP_BASE_URL").replace(/\/+$/, ""),
    clientId: requireEnv("SOKOSUMI_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("SOKOSUMI_OAUTH_CLIENT_SECRET"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    oauthProxy: onVercel
      ? {
          productionURL: CMO_PRODUCTION_URL,
          secret: requireEnv("OAUTH_PROXY_SECRET"),
        }
      : undefined,
  };
}

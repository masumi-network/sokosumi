import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";
import { withRelatedProject } from "@vercel/related-projects";

import type { CmoAuthConfig } from "./auth";

/** The Core project whose branch preview a CMO preview signs in against. */
const CORE_PREVIEW_PROJECT = "sokosumi-core-mainnet";

/** Core's preview deployment suffix; CMO's own previews use preview.cmo.xyz. */
const CORE_PREVIEW_DOMAIN = "preview.sokosumi.com";

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
 * A preview calls the same branch's Core preview, whose alias Vercel supplies
 * (truncated with a hash for a long branch). Never mainnet: Core only accepts
 * a preview's callback on a preview (ADR 0045).
 */
function readCoreBaseUrl(vercelEnv: string | undefined): string {
  if (vercelEnv !== "preview") return requireEnv("CORE_APP_BASE_URL");
  const relatedUrl = withRelatedProject({
    projectName: CORE_PREVIEW_PROJECT,
    defaultHost: "",
  });
  if (!relatedUrl) {
    throw new Error(`${CORE_PREVIEW_PROJECT} has no preview for this branch`);
  }
  // Vercel names the alias right but appends CMO's suffix, not Core's.
  const [alias] = new URL(relatedUrl).hostname.split(".");
  return `https://${alias}.${CORE_PREVIEW_DOMAIN}`;
}

/**
 * Reads Sign in with Sokosumi's settings from env. On Vercel, CMO's origin
 * comes from the deployment (the branch alias on previews), and a preview
 * signs in against its branch's Core preview. Production and local sign in
 * against `CORE_APP_BASE_URL`.
 */
export function readCmoAuthConfig(): CmoAuthConfig {
  const vercelEnv = process.env.VERCEL_ENV;
  const baseURL = resolveBetterAuthPublicBaseUrl({
    vercelEnv,
    vercelUrl: undefined,
    vercelBranchUrl: vercelHostUrl("VERCEL_BRANCH_URL"),
    vercelProductionUrl: vercelHostUrl("VERCEL_PROJECT_PRODUCTION_URL"),
    fallbackUrl: process.env.BETTER_AUTH_URL ?? "",
  });
  if (!baseURL) throw new Error("BETTER_AUTH_URL is not set");

  return {
    baseURL,
    coreBaseUrl: readCoreBaseUrl(vercelEnv).replace(/\/+$/, ""),
    clientId: requireEnv("SOKOSUMI_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("SOKOSUMI_OAUTH_CLIENT_SECRET"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
  };
}

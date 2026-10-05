import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";
import { withRelatedProject } from "@vercel/related-projects";

export interface CmoAuthConfig {
  /** CMO's own public origin, the base of its OAuth callback. */
  baseURL: string;
  /** Core's origin, for example `https://api.sokosumi.com`. */
  coreBaseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Encrypts CMO's session and token cookies. */
  secret: string;
}

/** The Core project whose branch preview a CMO preview signs in against. */
const CORE_PREVIEW_PROJECT = "sokosumi-core-mainnet";

/** The Sokosumi Web project beside that Core. */
const SOKOSUMI_APP_PREVIEW_PROJECT = "sokosumi-app-mainnet";

/** Sokosumi's preview deployment suffix; CMO's own previews use preview.cmo.xyz. */
const SOKOSUMI_PREVIEW_DOMAIN = "preview.sokosumi.com";

/** Sokosumi Web in production, when `SOKOSUMI_APP_BASE_URL` is unset. */
const SOKOSUMI_APP_PRODUCTION_URL = "https://app.sokosumi.com";

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
 * A Sokosumi project's preview of this branch, whose alias Vercel supplies
 * (truncated with a hash for a long branch), or undefined when it has none.
 */
function sokosumiPreviewUrl(projectName: string): string | undefined {
  const relatedUrl = withRelatedProject({ projectName, defaultHost: "" });
  if (!relatedUrl) return undefined;
  // Vercel names the alias right but appends CMO's suffix, not Sokosumi's.
  const [alias] = new URL(relatedUrl).hostname.split(".");
  return `https://${alias}.${SOKOSUMI_PREVIEW_DOMAIN}`;
}

/**
 * A preview calls the same branch's Core preview. Never mainnet: Core only
 * accepts a preview's callback on a preview (ADR 0045).
 */
function readCoreBaseUrl(vercelEnv: string | undefined): string {
  if (vercelEnv !== "preview") return requireEnv("CORE_APP_BASE_URL");
  const previewUrl = sokosumiPreviewUrl(CORE_PREVIEW_PROJECT);
  if (!previewUrl) {
    throw new Error(`${CORE_PREVIEW_PROJECT} has no preview for this branch`);
  }
  return previewUrl;
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

/**
 * Sokosumi Web's origin, where a person accepts invitations (ADR 0051): the
 * same branch's preview on a CMO preview, since its invitations live in that
 * branch's database, else `SOKOSUMI_APP_BASE_URL` or production. Kept out of
 * the auth config, so a missing Web never stops signing in.
 */
export function readSokosumiAppBaseUrl(): string {
  const configured =
    process.env.SOKOSUMI_APP_BASE_URL || SOKOSUMI_APP_PRODUCTION_URL;
  const url =
    (process.env.VERCEL_ENV === "preview" &&
      sokosumiPreviewUrl(SOKOSUMI_APP_PREVIEW_PROJECT)) ||
    configured;
  return url.replace(/\/+$/, "");
}

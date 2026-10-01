import { withRelatedProject } from "@vercel/related-projects";

const CORE_PROJECT = "sokosumi-core-mainnet";

export function previewBranchSegment(ref: string | undefined): string {
  return (ref ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Core's base URL. A preview talks to the same branch's Core preview (Vercel
 * related project, with the branch alias as fallback), so a PR's Core
 * changes and migrations are what its CMO preview runs against. Production
 * and local use `CORE_APP_BASE_URL`.
 */
export function resolveCoreBaseUrl(env: {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  CORE_APP_BASE_URL?: string;
}): string | undefined {
  const configured = env.CORE_APP_BASE_URL;
  if (env.VERCEL_ENV !== "preview") return configured;
  const segment = previewBranchSegment(env.VERCEL_GIT_COMMIT_REF);
  const branchHost = segment
    ? `https://${CORE_PROJECT}-git-${segment}.preview.sokosumi.com`
    : configured;
  if (!branchHost) return undefined;
  const host = withRelatedProject({
    projectName: CORE_PROJECT,
    defaultHost: branchHost,
  });
  return host.startsWith("http") ? host : `https://${host}`;
}

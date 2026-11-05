import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

export type SeoOwner = { kind: "audit" | "project"; id: string };
export const SEO_VIEWER_HEADER = "x-seo-viewer";
export const SEO_ORGANIZATION_HEADER = "x-seo-organization";
export const SEO_PERSONAL_ORGANIZATION = "personal";

export function seoViewerHeaders(
  userId: string | undefined,
  organizationId: string | null | undefined,
) {
  return {
    [SEO_VIEWER_HEADER]: userId ?? "",
    [SEO_ORGANIZATION_HEADER]:
      organizationId == null
        ? SEO_PERSONAL_ORGANIZATION
        : `organization:${organizationId}`,
  };
}

/** An optional work link never changes which audit owns these pages. */
export function seoWorkspaceOwner(
  data: Pick<ProjectSeoWorkspace, "auditId" | "projectId">,
): SeoOwner {
  if (data.auditId) return { kind: "audit", id: data.auditId };
  if (data.projectId) return { kind: "project", id: data.projectId };
  throw new Error("SEO response has no owner");
}

export function seoOwnerApiPath(owner: SeoOwner): string {
  return owner.kind === "audit"
    ? `/api/seo/audits/${encodeURIComponent(owner.id)}`
    : `/api/projects/${encodeURIComponent(owner.id)}/seo`;
}

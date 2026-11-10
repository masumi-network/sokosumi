/** The SEO page keeps the header's Project scope in `projectId`, as the other scoped pages do. */
export function seoIndexHref(projectId: string | null, cursor?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/seo?${query}` : "/seo";
}

/** An Audit opens in its own Project's scope, so the header names that Project. */
export function seoAuditHref(auditId: string, projectId: string | null) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  params.set("auditId", auditId);
  return `/seo?${params}`;
}

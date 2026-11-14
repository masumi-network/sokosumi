/** The SEO page keeps the header's Project scope in `projectId`, as the other scoped pages do. */
export function seoIndexHref(projectId: string | null, cursor?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/seo?${query}` : "/seo";
}

/** The audit list with its form for a new Audit open. */
export const SEO_ADD_PAGE_HREF = "/seo?add=1";

/** An Audit opens in its own Project's scope, so the header names that Project. */
export function seoAuditHref(auditId: string, projectId: string | null) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  params.set("auditId", auditId);
  return `/seo?${params}`;
}

/** The Project's own SEO workspace: the pages and reads its Soko Bot keeps outside any Audit. */
export function seoProjectHref(projectId: string) {
  return `/seo?${new URLSearchParams({ projectId, view: "project" })}`;
}

/** The same SEO URL without one query key. */
export function seoHrefWithout(
  query: Record<string, string | string[] | undefined>,
  key: string,
) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query))
    if (name !== key)
      for (const one of [value ?? []].flat()) params.append(name, one);
  return `/seo?${params}`;
}

/** The same SEO URL in another Project scope. Tabs, filters and the open Audit stay. */
export function seoRescopedHref(
  query: Record<string, string | string[] | undefined>,
  projectId: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  for (const [key, value] of Object.entries(query))
    if (key !== "projectId")
      for (const one of [value ?? []].flat()) params.append(key, one);
  return `/seo?${params}`;
}

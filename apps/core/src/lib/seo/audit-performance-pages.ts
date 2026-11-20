import type { SeoIndexedPage } from "@/schemas/project-seo.schema";
import { gscPropertyCovers } from "./native-gsc-property";

/** Google must confirm the exact seed or its www alias at the same path under the approved property. */
export function auditPerformancePage(
  property: string,
  pageUrl: string,
  inspection?: SeoIndexedPage,
) {
  const fallback = {
    pageUrl,
    measuredUrl: pageUrl,
    basis: "unverified" as const,
  };
  if (inspection?.pageUrl !== pageUrl || !inspection.googleCanonical)
    return fallback;
  const selected = new URL(pageUrl);
  const canonical = new URL(inspection.googleCanonical);
  if (canonical.href === selected.href)
    return { pageUrl, measuredUrl: pageUrl, basis: "selected" as const };
  if (
    !inspection.userCanonical ||
    !URL.canParse(inspection.userCanonical) ||
    new URL(inspection.userCanonical).href !== canonical.href ||
    canonical.username ||
    canonical.password ||
    canonical.hash ||
    canonical.protocol !== selected.protocol ||
    canonical.port !== selected.port ||
    canonical.pathname !== selected.pathname ||
    canonical.search !== selected.search ||
    !(
      canonical.hostname === "www." + selected.hostname ||
      selected.hostname === "www." + canonical.hostname
    ) ||
    !gscPropertyCovers(property, [pageUrl, canonical.href])
  )
    return fallback;
  return {
    pageUrl,
    measuredUrl: canonical.href,
    basis: "google_canonical" as const,
  };
}

import type { ProjectSeoObservation } from "@sokosumi/database";

import type {
  ProjectSeoWorkspace,
  SeoIndexedPage,
} from "@/schemas/project-seo.schema";
import { seoTaskIndexingResultSchema } from "@/schemas/seo-task-indexing.schema";
import { normalizeSeoUrl } from "./project-seo-store";

/** The newest verdict per selected page; observations arrive newest first. */
export function newestIndexStatus(
  sources: Array<{ at: Date; pages: SeoIndexedPage[] }>,
  selectedUrls: Set<string>,
): ProjectSeoWorkspace["indexStatus"] {
  const pages = new Map<string, SeoIndexedPage & { checkedAt: string }>();
  for (const source of sources)
    for (const page of source.pages) {
      const url = normalizeSeoUrl(page.pageUrl);
      if (selectedUrls.has(url) && !pages.has(url))
        pages.set(url, { ...page, checkedAt: source.at.toISOString() });
    }
  return pages.size ? { pages: [...pages.values()] } : null;
}

/** Only the requesting viewer's private rows are loaded by the workspace service. */
export function newestIndexTriage(
  observations: ProjectSeoObservation[],
  selectedUrls: Set<string>,
): ProjectSeoWorkspace["indexTriage"] {
  for (const row of observations) {
    if (
      row.kind !== "index_triage" ||
      row.visibility !== "PRIVATE" ||
      !row.ownerId
    )
      continue;
    const parsed = seoTaskIndexingResultSchema.safeParse(row.payload);
    if (!parsed.success || parsed.data.taskId !== row.sourceTaskId) continue;
    const assessments = parsed.data.assessments.filter((page) =>
      selectedUrls.has(normalizeSeoUrl(page.pageUrl)),
    );
    if (assessments.length)
      return {
        taskId: parsed.data.taskId,
        checkedAt: parsed.data.checkedAt,
        assessments,
      };
  }
  return null;
}

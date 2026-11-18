import type {
  SaveSeoAuditBriefRequest,
  SeoAuditBrief,
} from "@sokosumi/core-client";

export const SEO_BRIEF_OBJECTIVES = ["sales", "traffic", "support"] as const;
export const SEO_BRIEF_ROLES = [
  "guide",
  "product",
  "pricing",
  "support",
  "comparison",
  "other",
] as const;
export const SEO_BRIEF_ACTIONS = [
  "sign up",
  "buy",
  "contact sales",
  "book",
  "subscribe",
  "download",
  "call",
  "visit",
  "read",
  "none",
] as const;
export const SEO_BRIEF_INDEX_INTENTS = ["index", "exclude", "unknown"] as const;
export const SEO_BRIEF_PAGE_LIMIT = 10;
export const SEO_BRIEF_TEXT_LIMIT = 300;
export const SEO_BRIEF_CONSTRAINTS_LIMIT = 600;
export type BriefPage = SaveSeoAuditBriefRequest["pages"][number];

export function briefDraft({
  revision,
  audience,
  objective,
  outcome,
  constraints,
  pages,
}: SeoAuditBrief): SaveSeoAuditBriefRequest {
  return {
    expectedRevision: revision,
    audience,
    objective,
    outcome,
    constraints,
    pages,
  };
}

export function briefPage(pages: BriefPage[], pageId: string): BriefPage {
  return (
    pages.find((page) => page.pageId === pageId) ?? {
      pageId,
      role: null,
      job: null,
      action: null,
      indexIntent: "unknown",
    }
  );
}

export function changeBriefPage(pages: BriefPage[], page: BriefPage) {
  if (
    !page.role &&
    !page.job?.trim() &&
    !page.action &&
    page.indexIntent === "unknown"
  )
    return pages.filter((other) => other.pageId !== page.pageId);
  if (pages.some((other) => other.pageId === page.pageId))
    return pages.map((other) => (other.pageId === page.pageId ? page : other));
  return [...pages, page];
}

export function briefRequest(
  draft: SaveSeoAuditBriefRequest,
): SaveSeoAuditBriefRequest {
  const text = (value: string | null) => value?.trim() || null;
  return {
    ...draft,
    audience: text(draft.audience),
    outcome: text(draft.outcome),
    constraints: text(draft.constraints),
    pages: draft.pages.map((page) => ({ ...page, job: text(page.job) })),
  };
}

/** Only the explicit selections in this form belong to this run. Core resolves the private revision and validates them again. */
export function selectedBriefPages(
  form: FormData,
  brief: SeoAuditBrief | undefined,
  scopeIds: string[],
) {
  const pageIds = form.getAll("sharedGoalPage");
  if (!pageIds.length) return undefined;
  if (!brief || form.get("sharedBriefRevision") !== String(brief.revision))
    throw new Error("The brief changed");
  const eligible = brief.pages
    .filter((p) => scopeIds.includes(p.pageId) && (p.role || p.action))
    .map((p) => p.pageId);
  const selected = pageIds.map((id) => {
    if (typeof id !== "string" || !eligible.includes(id))
      throw new Error("Page is outside the audit");
    return id;
  });
  return { revision: brief.revision, pageIds: [...new Set(selected)] };
}

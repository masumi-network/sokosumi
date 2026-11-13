import type {
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
  RequestProjectSeoAnalysisRequest,
} from "@sokosumi/core-client";
import { SEO_MIN_AUDIT_USD, seoMaxCredits } from "@sokosumi/utils";
import type { SeoCommand } from "@/lib/actions/seo/types";
import type { SeoAnalysisLimits } from "./seo-analysis-summary";

/**
 * The target page of a keyword's choice. A keyword tracked from its check has no stored choice
 * (version 0): its first choice takes the page the check read, from the menu and from the edit dialog alike.
 */
export function seoKeywordTargetPageId(
  row: Pick<ProjectSeoKeyword, "version" | "targetPageId" | "pageUrl">,
  pages: readonly Pick<ProjectSeoWorkspace["pages"][number], "id" | "url">[],
): string | null {
  return row.version > 0
    ? row.targetPageId
    : (pages.find((page) => page.url === row.pageUrl)?.id ?? null);
}

export const SEO_COUNTRIES = [
  "US",
  "GB",
  "DE",
  "AT",
  "CH",
  "FR",
  "ES",
  "IT",
  "NL",
  "BR",
  "PT",
] as const;
export const SEO_ANALYSIS_KINDS = [
  "page_check",
  "rankings",
  "links",
  "audit_lite",
  "audit_full",
] as const satisfies RequestProjectSeoAnalysisRequest["kind"][];
export type SeoAnalysisKind = (typeof SEO_ANALYSIS_KINDS)[number];
/** Core accepts one optional target keyword for a full audit. */
export const SEO_FULL_AUDIT_KEYWORDS = 1;
export const SEO_ANALYSIS_MODULES = [
  "page.inspect",
  "keyword.refresh",
  "links.refresh",
] as const;
export function allowedSeoAnalysisKinds(paidSearchData: boolean) {
  return SEO_ANALYSIS_KINDS.filter(
    (kind) => paidSearchData || kind === "page_check" || kind === "audit_lite",
  );
}
export const SEO_MAX_MONITOR_RUNS = 31;
export const SEO_DEFAULT_MONITOR_RUNS = 4;
export const SEO_MAX_PAGES = 10;
export const SEO_NO_TARGET_PAGE = "no-target-page";
/** The "Related to" choice for a page that stands alone. A select item cannot hold an empty value. */
export const SEO_NO_RELATED_PAGE = "no-related-page";
export const SEO_MAX_KEYWORDS = 20;
export const SEO_MAX_KEYWORD_LENGTH = 80;
export const SEO_MAX_PROVIDER_CALLS = 100;
/** Core's bounds of a multi-page audit's USD limit (fullAuditLimits.usd); the minimum comes from utils. */
const SEO_MAX_AUDIT_USD = 50;
/** Core's bounds of a multi-page audit's time limit in whole seconds (fullAuditLimits.seconds). */
const SEO_MIN_AUDIT_SECONDS = 60;
const SEO_MAX_AUDIT_SECONDS = 5_400;
/**
 * The limits every multi-page full audit sends. The reader does not see them: the price shows in credits, and the
 * time limit only keeps a stuck check from running on (owner, 2026-11-13).
 */
export const SEO_FULL_AUDIT_LIMITS = { usd: 5, seconds: 5_400 } as const;
export const SEO_DEVICES = ["mobile", "desktop"] as const;
export type SeoDevice = (typeof SEO_DEVICES)[number];
const SEO_FULL_AUDIT_FIRST_PAGE_SECONDS = 960;
const SEO_FULL_AUDIT_RELATED_PAGE_SECONDS = 210;
const SEO_FULL_AUDIT_MAX_SECONDS = 3600;

/** Matches the SEO worker's site-audit default envelope. */
export function defaultFullAuditSeconds(pageCount: number) {
  return Math.min(
    SEO_FULL_AUDIT_MAX_SECONDS,
    SEO_FULL_AUDIT_FIRST_PAGE_SECONDS +
      Math.max(0, pageCount - 1) * SEO_FULL_AUDIT_RELATED_PAGE_SECONDS,
  );
}

export function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}
/** The data requests of a focused check: one per keyword and device, and one per own and competitor page. */
export function seoProviderCallsNeeded(
  needs: { wantsKeywords: boolean; wantsCompetitors: boolean },
  keywords: number,
  devices: number,
  pages: number,
  competitors: number,
) {
  return (
    (needs.wantsKeywords ? keywords * devices : 0) +
    (needs.wantsCompetitors ? pages + competitors : 0)
  );
}

export function formLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function seoAnalysisRequirements(
  kind: string,
  analyses: readonly string[],
) {
  const wantsKeywords =
    kind === "rankings" ||
    kind === "audit_full" ||
    (kind === "audit_lite" && analyses.includes("keyword.refresh"));
  const wantsCompetitors =
    kind === "links" ||
    (kind === "audit_lite" && analyses.includes("links.refresh"));
  return {
    wantsKeywords,
    wantsCompetitors,
    usesPaidData: wantsKeywords || wantsCompetitors,
  };
}

/** The first page of the selection: the page a default (a market, a statistics property) is read from. */
export function seoScopePage(
  workspace: Pick<ProjectSeoWorkspace, "pages" | "scope">,
) {
  return (
    workspace.pages.find((page) => workspace.scope.pageIds.includes(page.id)) ??
    workspace.pages[0]
  );
}

/** The page a new page relates to by default: the first page that stands alone. */
export function seoMainPageId(workspace: ProjectSeoWorkspace): string {
  const main =
    workspace.pages.find((page) => page.relationship === "primary") ??
    workspace.pages[0];
  return main?.id ?? SEO_NO_RELATED_PAGE;
}

export function editSeoCommand(
  kind:
    | "page"
    | "scope"
    | "edit_scope"
    | "keyword"
    | "edit_keyword"
    | "competitor",
  form: FormData,
  workspace: ProjectSeoWorkspace,
  originalKeyword?: ProjectSeoKeyword | null,
): Extract<SeoCommand, { body: unknown }> {
  if (kind === "page") {
    const related = formText(form, "relatedToPageId");
    const relatedToPageId = related === SEO_NO_RELATED_PAGE ? "" : related;
    return {
      kind: "add_page",
      body: {
        url: formText(form, "url"),
        label: formText(form, "label"),
        relationship: relatedToPageId ? "related" : "primary",
        ...(relatedToPageId ? { relatedToPageId } : {}),
      },
    };
  }
  if (kind === "scope" || kind === "edit_scope") {
    const body = {
      name: formText(form, "name"),
      pageIds: form.getAll("pageIds").map(String),
    };
    const scope = workspace.scopes.find(
      (item) => item.id === workspace.scope.id,
    );
    if (kind === "edit_scope" && scope)
      return {
        kind: "update_scope",
        scopeId: scope.id,
        body: { ...body, expectedVersion: scope.version },
      };
    return { kind: "create_scope", body };
  }
  if (kind === "competitor") {
    const url = formText(form, "url");
    const current = workspace.competitors.find(
      (row) => row.url === url && row.version > 0,
    );
    return {
      kind: "save_competitor",
      body: {
        url,
        confirmed: true,
        ...(current ? { expectedVersion: current.version } : {}),
      },
    };
  }
  if (kind === "edit_keyword" && !originalKeyword)
    throw new Error("The keyword to edit is unavailable");
  const selectedPage = formText(form, "pageId");
  const pageId =
    selectedPage === SEO_NO_TARGET_PAGE ? null : selectedPage || null;
  const original = kind === "edit_keyword" ? originalKeyword : null;
  const keyword = original?.keyword ?? formText(form, "keyword");
  const countryCode =
    original?.countryCode ?? formText(form, "countryCode").toUpperCase();
  const languageCode = original?.languageCode ?? formText(form, "languageCode");
  const current =
    original ??
    workspace.keywords.find(
      (row) =>
        row.keyword.normalize("NFKC").toLowerCase() ===
          keyword.normalize("NFKC").toLowerCase() &&
        row.countryCode === countryCode &&
        row.languageCode === languageCode &&
        row.version > 0,
    );
  const priority = formText(form, "priority");
  return {
    kind: "save_keyword",
    body: {
      keyword,
      countryCode,
      languageCode,
      pageId,
      saved: original?.saved ?? true,
      priority: priority === "high" || priority === "low" ? priority : "medium",
      ...(current && current.version > 0
        ? { expectedVersion: current.version }
        : {}),
    },
  };
}

export function analysisSeoBody(
  form: FormData,
  workspace: ProjectSeoWorkspace,
): Omit<RequestProjectSeoAnalysisRequest, "idempotencyKey"> {
  const kindText = formText(form, "kind");
  const paidSearchData =
    workspace.availableActions.canUsePaidSearchData === true;
  const kind = allowedSeoAnalysisKinds(paidSearchData).find(
    (item) => item === kindText,
  );
  const countryCode = SEO_COUNTRIES.find(
    (item) => item === formText(form, "countryCode"),
  );
  const analyses = form
    .getAll("analyses")
    .filter((value): value is (typeof SEO_ANALYSIS_MODULES)[number] =>
      SEO_ANALYSIS_MODULES.some((module) => module === value),
    );
  const { wantsKeywords, wantsCompetitors, usesPaidData } =
    seoAnalysisRequirements(kindText, analyses);
  const keywords = wantsKeywords ? formLines(formText(form, "keywords")) : [];
  const devices = form
    .getAll("devices")
    .filter(
      (value): value is "mobile" | "desktop" =>
        value === "mobile" || value === "desktop",
    );
  if (
    !workspace.availableActions.canRequestAnalysis ||
    !kind ||
    (!paidSearchData && usesPaidData) ||
    !countryCode ||
    !devices.length ||
    (kind === "audit_lite" && analyses.length === 0) ||
    (wantsKeywords && kind !== "audit_full" && keywords.length === 0) ||
    !workspace.scope.pageIds.length ||
    workspace.scope.pageIds.length > SEO_MAX_PAGES ||
    keywords.length > SEO_MAX_KEYWORDS ||
    keywords.some((word) => word.length > SEO_MAX_KEYWORD_LENGTH) ||
    (kind === "audit_full" &&
      (keywords.length > SEO_FULL_AUDIT_KEYWORDS || devices.length !== 2))
  )
    throw new Error("Invalid SEO analysis selection");
  const competitorUrls = wantsCompetitors
    ? formLines(formText(form, "competitorUrls"))
    : [];
  // The reader sets no request limit: a focused check asks for exactly the requests it makes.
  const maxProviderCalls = seoProviderCallsNeeded(
    { wantsKeywords, wantsCompetitors },
    keywords.length,
    devices.length,
    workspace.scope.pageIds.length,
    competitorUrls.length,
  );
  if (kind !== "audit_full" && maxProviderCalls > SEO_MAX_PROVIDER_CALLS)
    throw new RangeError("The selected checks exceed the data request limit");
  return {
    kind,
    ...(workspace.scope.id
      ? {
          scopeId: workspace.scope.id,
          expectedScopeVersion: workspace.scope.version,
        }
      : { pageIds: workspace.scope.pageIds }),
    keywords,
    countryCode,
    languageCode: formText(form, "languageCode"),
    devices,
    competitorUrls,
    ...(kind === "audit_lite" ? { analyses } : {}),
    ...(kind === "audit_full" && workspace.scope.pageIds.length > 1
      ? {
          fullAuditLimits: { ...SEO_FULL_AUDIT_LIMITS },
        }
      : kind === "audit_full"
        ? {}
        : { maxProviderCalls }),
  };
}

/**
 * The most the check can charge, in whole credits, as Core and the check service compute it (seoMaxCredits).
 * Null while a limit field holds a value Core refuses.
 */
export function seoAnalysisMaxCredits(
  limits: SeoAnalysisLimits,
): number | null {
  if (limits.kind === "free") return 0;
  if (limits.kind === "standard")
    return seoMaxCredits({ kind: "audit_full", pages: 1 });
  if (limits.kind === "full")
    // "full" is the multi-page audit; any page count above one reads the USD limit.
    return limits.usd >= SEO_MIN_AUDIT_USD &&
      limits.usd <= SEO_MAX_AUDIT_USD &&
      Number.isInteger(limits.seconds) &&
      limits.seconds >= SEO_MIN_AUDIT_SECONDS &&
      limits.seconds <= SEO_MAX_AUDIT_SECONDS
      ? seoMaxCredits({ kind: "audit_full", pages: 2, usd: limits.usd })
      : null;
  return Number.isSafeInteger(limits.count) &&
    limits.count >= 0 &&
    limits.count <= SEO_MAX_PROVIDER_CALLS
    ? seoMaxCredits({ kind: "focused", providerCalls: limits.count })
    : null;
}

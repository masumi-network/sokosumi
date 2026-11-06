import type {
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
  RequestProjectSeoAnalysisRequest,
} from "@sokosumi/core-client";
import type { SeoCommand } from "@/lib/actions/seo/types";

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
export const SEO_ANALYSIS_MODULES = [
  "page.inspect",
  "keyword.refresh",
  "links.refresh",
] as const;
export function allowedSeoAnalysisKinds(
  paidSearchData: boolean,
  monitor = false,
) {
  return SEO_ANALYSIS_KINDS.filter(
    (kind) =>
      (!monitor || kind !== "audit_full") &&
      (paidSearchData || kind === "page_check" || kind === "audit_lite"),
  );
}
export const SEO_MAX_MONITOR_RUNS = 31;
export const SEO_DEFAULT_MONITOR_RUNS = 4;
export const SEO_MAX_PAGES = 10;
export const SEO_NO_TARGET_PAGE = "no-target-page";
export const SEO_MAX_KEYWORDS = 20;
export const SEO_MAX_KEYWORD_LENGTH = 80;
export const SEO_MAX_PROVIDER_CALLS = 100;
export const SEO_DEFAULT_PROVIDER_CALLS = 20;
export const SEO_DEFAULT_FULL_AUDIT_USD = 3;
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

export function seoMonitorRunCount(form: FormData) {
  const count = Number(formText(form, "targetRunCount"));
  if (!Number.isInteger(count) || count < 1 || count > SEO_MAX_MONITOR_RUNS)
    throw new Error("Invalid SEO monitor run count");
  return count;
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
): SeoCommand {
  if (kind === "page") {
    const relatedToPageId = formText(form, "relatedToPageId");
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
    (kind === "audit_full" && (keywords.length > 1 || devices.length !== 2))
  )
    throw new Error("Invalid SEO analysis selection");
  const competitorUrls = wantsCompetitors
    ? formLines(formText(form, "competitorUrls"))
    : [];
  const maxProviderCalls = usesPaidData
    ? Number(formText(form, "maxProviderCalls"))
    : 0;
  if (kind !== "audit_full") {
    if (
      !Number.isInteger(maxProviderCalls) ||
      maxProviderCalls < 0 ||
      maxProviderCalls > SEO_MAX_PROVIDER_CALLS
    )
      throw new RangeError("Invalid SEO data request limit");
    const neededCalls =
      (wantsKeywords ? keywords.length * devices.length : 0) +
      (wantsCompetitors
        ? workspace.scope.pageIds.length + competitorUrls.length
        : 0);
    if (neededCalls > maxProviderCalls)
      throw new RangeError("The selected checks exceed the data request limit");
  }
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
          fullAuditLimits: {
            usd: Number(formText(form, "usd")),
            seconds: Number(formText(form, "seconds")),
          },
        }
      : kind === "audit_full"
        ? {}
        : { maxProviderCalls }),
  };
}

import type {
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
export const SEO_MAX_MONITOR_RUNS = 31;
export const SEO_DEFAULT_MONITOR_RUNS = 4;
export const SEO_MAX_PAGES = 10;
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

export function editSeoCommand(
  kind: "page" | "scope" | "edit_scope" | "keyword" | "competitor",
  form: FormData,
  workspace: ProjectSeoWorkspace,
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
  const pageId = formText(form, "pageId") || null;
  const keyword = formText(form, "keyword");
  const countryCode = formText(form, "countryCode").toUpperCase();
  const languageCode = formText(form, "languageCode");
  const pageUrl =
    workspace.pages.find((page) => page.id === pageId)?.url ?? null;
  const current = workspace.keywords.find(
    (row) =>
      row.keyword.toLocaleLowerCase() === keyword.toLocaleLowerCase() &&
      row.countryCode === countryCode &&
      row.languageCode === languageCode &&
      row.pageUrl === pageUrl &&
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
      saved: true,
      priority: priority === "high" || priority === "low" ? priority : "medium",
      ...(current ? { expectedVersion: current.version } : {}),
    },
  };
}

export function analysisSeoBody(
  form: FormData,
  workspace: ProjectSeoWorkspace,
): Omit<RequestProjectSeoAnalysisRequest, "idempotencyKey"> {
  const kindText = formText(form, "kind");
  const kind = SEO_ANALYSIS_KINDS.find((item) => item === kindText);
  const countryCode = SEO_COUNTRIES.find(
    (item) => item === formText(form, "countryCode"),
  );
  const analyses = form
    .getAll("analyses")
    .filter((value): value is (typeof SEO_ANALYSIS_MODULES)[number] =>
      SEO_ANALYSIS_MODULES.some((module) => module === value),
    );
  const wantsKeywords =
    kind === "rankings" ||
    kind === "audit_full" ||
    (kind === "audit_lite" && analyses.includes("keyword.refresh"));
  const wantsCompetitors =
    kind === "links" ||
    (kind === "audit_lite" && analyses.includes("links.refresh"));
  const keywords = wantsKeywords ? formLines(formText(form, "keywords")) : [];
  const devices = form
    .getAll("devices")
    .filter(
      (value): value is "mobile" | "desktop" =>
        value === "mobile" || value === "desktop",
    );
  if (
    !kind ||
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
  if (kind !== "audit_full") {
    const neededCalls =
      (wantsKeywords ? keywords.length * devices.length : 0) +
      (wantsCompetitors
        ? workspace.scope.pageIds.length + competitorUrls.length
        : 0);
    if (neededCalls > Number(formText(form, "maxProviderCalls")))
      throw new RangeError("The selected checks exceed the data request limit");
  }
  const coworkerId = formText(form, "coworkerId");
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
        : { maxProviderCalls: Number(formText(form, "maxProviderCalls")) }),
    ...(coworkerId ? { coworkerId } : {}),
  };
}

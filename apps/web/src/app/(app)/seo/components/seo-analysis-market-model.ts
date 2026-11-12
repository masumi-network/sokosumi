import type {
  ProjectSeoKeyword,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { formLines, SEO_COUNTRIES, seoScopePage } from "./seo-form-model";
import { seoKeywordOwn } from "./seo-keyword-rows-model";

export type SeoAnalysisSavedKeyword = Pick<
  ProjectSeoKeyword,
  "keyword" | "saved" | "countryCode" | "languageCode" | "version"
>;
export interface SeoAnalysisMarketState {
  countryCode: string;
  languageCode: string;
  drafts: ReadonlyMap<string, string>;
}

function marketKey(
  state: Pick<SeoAnalysisMarketState, "countryCode" | "languageCode">,
) {
  return JSON.stringify([state.countryCode, state.languageCode]);
}

export type SeoMarket = Pick<
  SeoAnalysisMarketState,
  "countryCode" | "languageCode"
>;
const SEO_FALLBACK_MARKET: SeoMarket = {
  countryCode: "US",
  languageCode: "en",
};
/** The market a country domain names. A site on another domain gets the last check's market or the fallback. */
const SEO_DOMAIN_MARKETS: Record<string, SeoMarket> = {
  de: { countryCode: "DE", languageCode: "de" },
  at: { countryCode: "AT", languageCode: "de" },
  ch: { countryCode: "CH", languageCode: "de" },
  fr: { countryCode: "FR", languageCode: "fr" },
  es: { countryCode: "ES", languageCode: "es" },
  it: { countryCode: "IT", languageCode: "it" },
  nl: { countryCode: "NL", languageCode: "nl" },
  br: { countryCode: "BR", languageCode: "pt" },
  pt: { countryCode: "PT", languageCode: "pt" },
  uk: { countryCode: "GB", languageCode: "en" },
};

/**
 * The market a check opens on when no saved keyword names one, so the reader
 * does not have to choose: the newest check's market, then the country of the
 * first selected page's domain, then US English.
 */
export function seoDefaultMarket(
  workspace: Pick<ProjectSeoWorkspace, "observations" | "pages" | "scope">,
): SeoMarket {
  let last: SeoMarket | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const row of workspace.observations) {
    const at = new Date(row.observedAt).getTime();
    if (
      at > lastAt &&
      row.languageCode &&
      SEO_COUNTRIES.some((country) => country === row.countryCode)
    ) {
      last = {
        countryCode: row.countryCode ?? "",
        languageCode: row.languageCode,
      };
      lastAt = at;
    }
  }
  if (last) return last;
  let domain = "";
  try {
    domain =
      new URL(seoScopePage(workspace)?.url ?? "").hostname.split(".").at(-1) ??
      "";
  } catch {
    // A page without a readable address names no country.
  }
  return SEO_DOMAIN_MARKETS[domain] ?? SEO_FALLBACK_MARKET;
}

export function initialSeoAnalysisMarket(
  keywords: readonly SeoAnalysisSavedKeyword[],
  fallback: SeoMarket = { countryCode: "", languageCode: "" },
): SeoAnalysisMarketState {
  // Only the reader's own keywords: the keywords a check tracks from the start never fill a check
  // by themselves, or every check would grow with the last one.
  const first = keywords.find(seoKeywordOwn);
  return {
    countryCode: first?.countryCode ?? fallback.countryCode,
    languageCode: first?.languageCode ?? fallback.languageCode,
    drafts: new Map(),
  };
}

/**
 * Same identity as Core's analysis validation. Keep the first saved display text.
 * A check type that takes fewer keywords gets the first saved ones; the reader's own text stays as typed.
 */
export function seoAnalysisKeywordDraft(
  state: SeoAnalysisMarketState,
  keywords: readonly SeoAnalysisSavedKeyword[],
  limit = Number.POSITIVE_INFINITY,
): string {
  const draft = state.drafts.get(marketKey(state));
  if (draft !== undefined) return draft;
  const seen = new Set<string>();
  return formLines(
    keywords
      .filter(
        (row) =>
          seoKeywordOwn(row) &&
          row.countryCode === state.countryCode &&
          row.languageCode === state.languageCode,
      )
      .map((row) => row.keyword)
      .join("\n"),
  )
    .filter((keyword) => {
      const identity = keyword
        .normalize("NFC")
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, limit)
    .join("\n");
}

export function changeSeoAnalysisMarket(
  state: SeoAnalysisMarketState,
  market: Partial<Pick<SeoAnalysisMarketState, "countryCode" | "languageCode">>,
): SeoAnalysisMarketState {
  return { ...state, ...market };
}

export function editSeoAnalysisKeywords(
  state: SeoAnalysisMarketState,
  value: string,
): SeoAnalysisMarketState {
  const drafts = new Map(state.drafts);
  drafts.set(marketKey(state), value);
  return { ...state, drafts };
}

import type { ProjectSeoKeyword } from "@sokosumi/core-client";
import { formLines } from "./seo-form-model";

export type SeoAnalysisSavedKeyword = Pick<
  ProjectSeoKeyword,
  "keyword" | "saved" | "countryCode" | "languageCode"
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

export function initialSeoAnalysisMarket(
  keywords: readonly SeoAnalysisSavedKeyword[],
): SeoAnalysisMarketState {
  const first = keywords.find((row) => row.saved);
  return {
    countryCode: first?.countryCode ?? "",
    languageCode: first?.languageCode ?? "",
    drafts: new Map(),
  };
}

/** Same identity as Core's analysis validation. Keep the first saved display text. */
export function seoAnalysisKeywordDraft(
  state: SeoAnalysisMarketState,
  keywords: readonly SeoAnalysisSavedKeyword[],
): string {
  const draft = state.drafts.get(marketKey(state));
  if (draft !== undefined) return draft;
  const seen = new Set<string>();
  return formLines(
    keywords
      .filter(
        (row) =>
          row.saved &&
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

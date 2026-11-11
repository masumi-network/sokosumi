"use client";

import { useState } from "react";
import {
  changeSeoAnalysisMarket,
  editSeoAnalysisKeywords,
  initialSeoAnalysisMarket,
  type SeoAnalysisSavedKeyword,
  seoAnalysisKeywordDraft,
} from "./seo-analysis-market-model";

export function useSeoAnalysisMarket(
  keywords: readonly SeoAnalysisSavedKeyword[],
  /** The most saved keywords the chosen check type takes. */
  limit?: number,
) {
  const [state, setState] = useState(() => initialSeoAnalysisMarket(keywords));
  return {
    countryCode: state.countryCode,
    languageCode: state.languageCode,
    keywords: seoAnalysisKeywordDraft(state, keywords, limit),
    setCountryCode: (countryCode: string) =>
      setState((previous) =>
        changeSeoAnalysisMarket(previous, { countryCode }),
      ),
    setLanguageCode: (languageCode: string) =>
      setState((previous) =>
        changeSeoAnalysisMarket(previous, { languageCode }),
      ),
    setKeywords: (value: string) =>
      setState((previous) => editSeoAnalysisKeywords(previous, value)),
  };
}
